const DeliveryNote = require('../models/DeliveryNote');
const BusinessDetails = require('../models/BusinessDetails');
const { enrichItemsWithUnitCost } = require('../utils/stockCost');
const StockEntry = require('../models/StockEntry');
const Product = require('../models/Product');
const Warranty = require('../models/Warranty');

const applyStockDeductions = async (items, creationMethod) => {
    console.log('[applyStockDeductions] items:', JSON.stringify(items));
    console.log('[applyStockDeductions] creationMethod:', creationMethod);
    for (const item of items) {
        if (!item.productRef) {
            console.log('[applyStockDeductions] SKIP item — no productRef');
            continue;
        }
        let remainingQty = item.quantity;
        const hasSerials = item.serialNumbers && item.serialNumbers.length > 0;
        console.log(`[applyStockDeductions] processing product ${item.productRef}, qty=${remainingQty}, hasSerials=${hasSerials}, serials=`, item.serialNumbers);

        const stockEntries = await StockEntry.find({
            product: item.productRef,
            quantity: { $gt: 0 }
        }).sort({ createdAt: 1 });
        console.log(`[applyStockDeductions] found ${stockEntries.length} stock entries`);

        for (const entry of stockEntries) {
            console.log(`[applyStockDeductions] entry ${entry._id}: qty=${entry.quantity}, serials=${entry.serialNumbers}`);
            let serialsRemovedFromEntry = 0;
            if (hasSerials) {
                const serialsToRemove = item.serialNumbers.filter(sn =>
                    entry.serialNumbers.map(s => s.toUpperCase()).includes(sn.toUpperCase())
                );
                serialsRemovedFromEntry = serialsToRemove.length;
                console.log(`[applyStockDeductions] matching serials to remove:`, serialsToRemove);
                if (serialsRemovedFromEntry > 0) {
                    entry.serialNumbers = entry.serialNumbers.filter(
                        sn => !serialsToRemove.map(s => s.toUpperCase()).includes(sn.toUpperCase())
                    );
                }
            }

            if (remainingQty > 0) {
                if (creationMethod === 'manual' && hasSerials) {
                    const deductQty = Math.min(serialsRemovedFromEntry || remainingQty, entry.quantity);
                    entry.quantity -= deductQty;
                    remainingQty -= deductQty;
                    console.log(`[applyStockDeductions] manual mode: deducted ${deductQty}, remainingQty now ${remainingQty}`);
                } else if (creationMethod === 'automatic') {
                    const reduceQty = Math.min(remainingQty, entry.quantity);
                    entry.quantity -= reduceQty;
                    remainingQty -= reduceQty;
                    console.log(`[applyStockDeductions] auto mode: deducted ${reduceQty}, remainingQty now ${remainingQty}`);
                }
            }

            console.log(`[applyStockDeductions] saving entry ${entry._id}: qty=${entry.quantity}, serials=${entry.serialNumbers}`);
            if (entry.quantity <= 0) {
                await StockEntry.findByIdAndDelete(entry._id);
                console.log(`[applyStockDeductions] deleted entry ${entry._id}`);
            } else {
                await entry.save();
            }
        }

        if (creationMethod === 'automatic') {
            await Product.findByIdAndUpdate(item.productRef, {
                $inc: { quantity: -item.quantity }
            });
        } else if (creationMethod === 'manual' && hasSerials) {
            await Product.findByIdAndUpdate(item.productRef, {
                $inc: { quantity: -item.serialNumbers.length }
            });
        }
    }
    console.log('[applyStockDeductions] done');
};

const registerWarranties = async (deliveryNote, userId) => {
    const bizDetails = await BusinessDetails.findOne();
    const defaultPeriod = bizDetails?.defaultWarrantyPeriod || '1 year';
    console.log('[registerWarranties] DN items:', JSON.stringify(deliveryNote.items));

    for (const item of deliveryNote.items) {
        if (!item.serialNumbers || item.serialNumbers.length === 0) {
            console.log('[registerWarranties] SKIP item — no serials');
            continue;
        }
        console.log(`[registerWarranties] item serials:`, item.serialNumbers);

        const product = item.productRef
            ? await Product.findById(item.productRef)
            : null;
        const productPeriod = product?.warrantyPeriod || '';

        for (const serial of item.serialNumbers) {
            const exists = await Warranty.findOne({
                serialNumber: serial.toUpperCase(),
                productRef: item.productRef
            });
            if (exists) {
                console.log(`[registerWarranties] SKIP serial ${serial} — warranty already exists`);
                continue;
            }

            let stockEntryPeriod = '';
            if (item.productRef) {
                const entry = await StockEntry.findOne({
                    product: item.productRef,
                    serialNumbers: { $in: [serial.toUpperCase()] }
                }).select('warrantyPeriod');
                if (entry?.warrantyPeriod) stockEntryPeriod = entry.warrantyPeriod;
            }

            const warrantyPeriod = stockEntryPeriod || productPeriod || defaultPeriod;
            const startDate = new Date();
            const expiryDate = calculateWarrantyExpiry(startDate, warrantyPeriod);
            console.log(`[registerWarranties] creating warranty for serial ${serial}, period=${warrantyPeriod}, expiry=${expiryDate}`);
            try {
                await Warranty.create({
                    invoiceRef: deliveryNote._id,
                    clientRef: deliveryNote.clientRef || undefined,
                    projectRef: deliveryNote.projectId || undefined,
                    productRef: item.productRef || undefined,
                    serialNumber: serial.toUpperCase(),
                    warrantyPeriod,
                    startDate,
                    expiryDate,
                    status: 'active'
                });
                console.log(`[registerWarranties] warranty created for serial ${serial}`);
            } catch (err) {
                console.error(`[registerWarranties] Warranty creation failed for serial ${serial}:`, err.message);
            }
        }
    }
    console.log('[registerWarranties] done');
};

const calculateWarrantyExpiry = (startDate, warrantyPeriod) => {
    if (!warrantyPeriod || warrantyPeriod.trim() === '') return null;
    const parts = warrantyPeriod.trim().split(/\s+/);
    let duration = 0;
    let unit = 'months';
    for (const part of parts) {
        const num = parseInt(part, 10);
        if (!isNaN(num)) duration = num;
        else {
            const lower = part.toLowerCase();
            if (lower.startsWith('year') || lower.startsWith('yr')) unit = 'years';
            else if (lower.startsWith('month') || lower.startsWith('mo')) unit = 'months';
            else if (lower.startsWith('week') || lower.startsWith('wk')) unit = 'weeks';
            else if (lower.startsWith('day') || lower.startsWith('d')) unit = 'days';
        }
    }
    if (duration === 0) return null;
    const expiry = new Date(startDate);
    switch (unit) {
        case 'years': expiry.setFullYear(expiry.getFullYear() + duration); break;
        case 'months': expiry.setMonth(expiry.getMonth() + duration); break;
        case 'weeks': expiry.setDate(expiry.getDate() + (duration * 7)); break;
        case 'days': expiry.setDate(expiry.getDate() + duration); break;
    }
    return expiry;
};

const reverseDeliveryNoteStock = async (deliveryNote) => {
    for (const item of deliveryNote.items) {
        if (!item.productRef) continue;
        const hasSerials = item.serialNumbers && item.serialNumbers.length > 0;

        let entry = await StockEntry.findOne({ product: item.productRef }).sort({ createdAt: -1 });

        if (hasSerials) {
            const upperSerials = item.serialNumbers.map(s => s.toUpperCase());

            if (entry) {
                const newSerials = [...new Set([...entry.serialNumbers, ...upperSerials])];
                entry.serialNumbers = newSerials;
                if (deliveryNote.creationMethod === 'manual') {
                    entry.quantity += item.serialNumbers.length;
                }
                await entry.save();
            } else {
                const product = await Product.findById(item.productRef).select('productId name');
                await StockEntry.create({
                    product: item.productRef,
                    batchRef: `${product?.productId || 'STOCK'}-RESTORED-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    quantity: item.serialNumbers.length,
                    serialNumbers: upperSerials,
                    hasSerialNumbers: true,
                    notes: `Restored from delivery note ${deliveryNote.deliveryNoteNumber || ''}`,
                    addedBy: deliveryNote.createdBy
                });
            }
        }

        if (deliveryNote.creationMethod === 'automatic') {
            await Product.findByIdAndUpdate(item.productRef, {
                $inc: { quantity: item.quantity }
            });
            if (entry) {
                entry.quantity += item.quantity;
                await entry.save();
            }
        } else if (deliveryNote.creationMethod === 'manual' && hasSerials) {
            await Product.findByIdAndUpdate(item.productRef, {
                $inc: { quantity: item.serialNumbers.length }
            });
        }
    }

    await Warranty.deleteMany({ invoiceRef: deliveryNote._id });
};

exports.createDeliveryNote = async (req, res) => {
    try {
        const bizDetails = await BusinessDetails.findOne();
        const prefix = bizDetails?.deliveryNotePrefix || 'DN';
        const digits = bizDetails?.deliveryNoteDigits || 5;

        const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const latest = await DeliveryNote.findOne({
            deliveryNoteNumber: new RegExp('^' + escapedPrefix)
        }).sort({ createdAt: -1 });

        let sequence = 1;
        if (latest && latest.deliveryNoteNumber) {
            const suffixStr = latest.deliveryNoteNumber.substring(prefix.length);
            const num = parseInt(suffixStr, 10);
            if (!isNaN(num)) sequence = num + 1;
        }
        const deliveryNoteNumber = `${prefix}${sequence.toString().padStart(digits, '0')}`;

        let payload = { ...req.body };
        if (payload.clientRef === '') payload.clientRef = undefined;
        if (payload.projectId === '') payload.projectId = undefined;
        if (payload.items) {
            payload.items = payload.items.map(i => {
                if (i.productRef === '') i.productRef = undefined;
                return i;
            });
        }

        const deliveryNote = await DeliveryNote.create({
            ...payload,
            deliveryNoteNumber,
            status: 'Draft',
            createdBy: req.user._id,
            history: [{
                action: 'Created',
                changes: 'Delivery note created',
                editedBy: req.user._id,
                editedAt: new Date()
            }]
        });

        const populated = await DeliveryNote.findById(deliveryNote._id)
            .populate('clientRef')
            .populate('items.productRef')
            .populate('createdBy', 'firstName lastName')
            .populate('history.editedBy', 'firstName lastName');

        res.status(201).json({ success: true, data: populated });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.deliverDeliveryNote = async (req, res) => {
    try {
        const deliveryNote = await DeliveryNote.findById(req.params.id);
        if (!deliveryNote) return res.status(404).json({ success: false, message: 'Delivery note not found' });
        if (deliveryNote.status === 'Delivered') {
            return res.status(400).json({ success: false, message: 'Already delivered' });
        }

        deliveryNote.history.push({
            action: 'Delivered',
            changes: 'Status changed from Draft to Delivered. Stock deducted and warranties registered.',
            from: 'Draft',
            to: 'Delivered',
            editedBy: req.user._id,
            editedAt: new Date()
        });

        const enrichedItems = await enrichItemsWithUnitCost(
            deliveryNote.items,
            deliveryNote.creationMethod
        );
        deliveryNote.items = enrichedItems;
        deliveryNote.status = 'Delivered';
        await deliveryNote.save();

        await applyStockDeductions(enrichedItems, deliveryNote.creationMethod);
        await registerWarranties(deliveryNote, req.user._id);

        const populated = await DeliveryNote.findById(deliveryNote._id)
            .populate('clientRef')
            .populate('items.productRef')
            .populate('createdBy', 'firstName lastName')
            .populate('history.editedBy', 'firstName lastName');

        res.status(200).json({ success: true, data: populated });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.getDeliveryNotes = async (req, res) => {
    try {
        const deliveryNotes = await DeliveryNote.find()
            .populate('clientRef')
            .populate('items.productRef')
            .populate('createdBy', 'firstName lastName')
            .populate('history.editedBy', 'firstName lastName')
            .sort({ createdAt: -1 });
        res.status(200).json({ success: true, data: deliveryNotes });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.getDeliveryNoteById = async (req, res) => {
    try {
        const deliveryNote = await DeliveryNote.findById(req.params.id)
            .populate('clientRef')
            .populate('items.productRef')
            .populate('createdBy', 'firstName lastName')
            .populate('history.editedBy', 'firstName lastName');
        if (!deliveryNote) return res.status(404).json({ success: false, message: 'Delivery note not found' });
        res.status(200).json({ success: true, data: deliveryNote });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.updateDeliveryNote = async (req, res) => {
    try {
        const existing = await DeliveryNote.findById(req.params.id);
        if (!existing) return res.status(404).json({ success: false, message: 'Delivery note not found' });
        if (existing.status === 'Delivered') {
            return res.status(400).json({ success: false, message: 'Cannot modify a delivered delivery note' });
        }

        const changedFields = [];
        const tracked = ['deliveryType', 'selectedStoreRef', 'deliveryAddress', 'customerPORef', 'terms', 'notes', 'deliveryDate'];
        for (const field of tracked) {
            if (req.body[field] !== undefined && String(req.body[field]) !== String(existing[field] || '')) {
                changedFields.push(field.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()));
            }
        }
        if (req.body.clientRef && String(req.body.clientRef) !== String(existing.clientRef?._id || existing.clientRef || '')) {
            changedFields.push('Client');
        }
        if (req.body.projectId && String(req.body.projectId) !== String(existing.projectId?._id || existing.projectId || '')) {
            changedFields.push('Project');
        }
        if (req.body.items && JSON.stringify(req.body.items) !== JSON.stringify(existing.items)) {
            changedFields.push('Items');
        }

        const historyEntry = {
            action: 'Edited',
            changes: changedFields.length > 0 ? `Changed: ${changedFields.join(', ')}` : 'Updated delivery note',
            editedBy: req.user._id,
            editedAt: new Date()
        };

        const deliveryNote = await DeliveryNote.findByIdAndUpdate(
            req.params.id,
            { ...req.body, $push: { history: historyEntry } },
            { new: true, runValidators: true }
        )
            .populate('clientRef')
            .populate('items.productRef')
            .populate('createdBy', 'firstName lastName')
            .populate('history.editedBy', 'firstName lastName');
        res.status(200).json({ success: true, data: deliveryNote });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.deleteDeliveryNote = async (req, res) => {
    try {
        const deliveryNote = await DeliveryNote.findById(req.params.id);
        if (!deliveryNote) return res.status(404).json({ success: false, message: 'Delivery note not found' });
        if (deliveryNote.status === 'Delivered') {
            return res.status(400).json({ success: false, message: 'Cannot delete a delivered delivery note' });
        }
        await DeliveryNote.findByIdAndDelete(req.params.id);
        res.status(200).json({ success: true, message: 'Delivery note deleted.' });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.getDeliveryNoteForInvoice = async (req, res) => {
    try {
        const deliveryNote = await DeliveryNote.findById(req.params.id)
            .populate('clientRef')
            .populate('items.productRef')
            .populate('projectId')
            .populate('createdBy', 'firstName lastName');
        if (!deliveryNote) return res.status(404).json({ success: false, message: 'Delivery note not found' });

        const data = {
            deliveryNoteId: deliveryNote._id,
            deliveryNoteNumber: deliveryNote.deliveryNoteNumber,
            customerPORef: deliveryNote.customerPORef,
            customerPO: deliveryNote.customerPORef || '',
            clientRef: deliveryNote.clientRef?._id || null,
            manualClientDetails: deliveryNote.manualClientDetails,
            projectId: deliveryNote.projectId?._id || null,
            deliveryAddress: deliveryNote.deliveryAddress,
            items: deliveryNote.items.map(item => ({
                productRef: item.productRef?._id || null,
                manualName: item.manualName || (item.productRef?.name || ''),
                quantity: item.quantity,
                serialNumbers: item.serialNumbers || [],
                unitPrice: item.productRef?.price || 0,
                unitCost: item.unitCost || 0,
                lineTotal: (item.productRef?.price || 0) * item.quantity
            }))
        };

        res.status(200).json({ success: true, data });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};
