const GoodsReturnNote = require('../models/GoodsReturnNote');
const StockEntry = require('../models/StockEntry');
const Product = require('../models/Product');
const BusinessDetails = require('../models/BusinessDetails');

const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildReturnNumber = async () => {
    const biz = await BusinessDetails.findOne();
    const prefix = (biz?.goodsReturnPrefix || 'GRN').toUpperCase();
    const digits = Number(biz?.goodsReturnDigits || 5);
    const count = await GoodsReturnNote.countDocuments();
    return `${prefix}${String(count + 1).padStart(digits, '0')}`;
};

exports.getSourceDocument = async (req, res) => {
    try {
        const supplierInvoiceNumber = (req.query.supplierInvoiceNumber || '').trim().toUpperCase();
        const supplierDeliveryNumber = (req.query.supplierDeliveryNumber || '').trim().toUpperCase();

        if (!supplierInvoiceNumber && !supplierDeliveryNumber) {
            return res.status(400).json({
                success: false,
                message: 'Enter a supplier invoice number or supplier delivery number',
            });
        }

        if (supplierDeliveryNumber === 'N/A') {
            return res.status(400).json({
                success: false,
                message: 'N/A cannot be used as a delivery note lookup. Use the supplier invoice number instead.',
            });
        }

        const sourceType = supplierInvoiceNumber ? 'supplier_invoice' : 'supplier_delivery';
        const sourceNumber = supplierInvoiceNumber || supplierDeliveryNumber;
        const field = supplierInvoiceNumber ? 'supplierInvoiceNumber' : 'supplierDeliveryNumber';

        const entries = await StockEntry.find({
            [field]: new RegExp(`^${escapeRegex(sourceNumber)}$`, 'i'),
            quantity: { $gt: 0 },
        })
            .populate('product', 'name productId')
            .populate('supplierRef', 'name supplierId telephoneNumber address emailAddress')
            .sort({ createdAt: 1 });

        if (!entries.length) {
            return res.status(404).json({
                success: false,
                message: `No stock found for this ${sourceType === 'supplier_invoice' ? 'supplier invoice' : 'supplier delivery'} number. Add stock with this number first.`,
            });
        }

        const supplierFromEntries = entries.find((e) => e.supplierRef)?.supplierRef || null;

        const items = entries.map((entry) => ({
            sourceItemKey: String(entry._id),
            stockEntryId: entry._id,
            productRef: entry.product
                ? { _id: entry.product._id, name: entry.product.name, productId: entry.product.productId }
                : null,
            productName: entry.product?.name || 'Item',
            batchRef: entry.batchRef,
            location: entry.location || '',
            unitCost: Number(entry.buyingPrice || 0),
            maxReturnableQty: Number(entry.quantity || 0),
            serialNumbers: (entry.serialNumbers || []).map((s) => String(s).toUpperCase()),
            hasSerialNumbers: !!entry.hasSerialNumbers && (entry.serialNumbers || []).length > 0,
        }));

        res.status(200).json({
            success: true,
            data: {
                sourceType,
                sourceNumber,
                supplierRef: supplierFromEntries,
                items,
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getGoodsReturns = async (req, res) => {
    try {
        const notes = await GoodsReturnNote.find()
            .populate('supplierRef', 'name supplierId')
            .populate('items.productRef', 'name productId')
            .populate('createdBy', 'firstName lastName username name')
            .populate('statusHistory.editedBy', 'firstName lastName')
            .populate('cancelledBy', 'firstName lastName')
            .sort({ createdAt: -1 });

        res.status(200).json({ success: true, data: notes });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.createGoodsReturn = async (req, res) => {
    try {
        const {
            sourceType,
            sourceNumber,
            items,
            reason,
            terms,
            notes,
            supplierRef,
        } = req.body;

        if (!['supplier_invoice', 'supplier_delivery'].includes(sourceType)) {
            return res.status(400).json({ success: false, message: 'Invalid source type' });
        }
        if (!sourceNumber || !String(sourceNumber).trim()) {
            return res.status(400).json({ success: false, message: 'Source number is required' });
        }
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, message: 'Select at least one item to return' });
        }

        const normalizedSource = String(sourceNumber).trim().toUpperCase();
        const field = sourceType === 'supplier_invoice' ? 'supplierInvoiceNumber' : 'supplierDeliveryNumber';
        const returnItems = [];
        let returnAmount = 0;
        let resolvedSupplier = supplierRef || null;
        let supplierName = '';

        for (const reqItem of items) {
            const stockEntryId = reqItem.sourceItemKey || reqItem.stockEntryId;
            const quantity = Number(reqItem.quantity || 0);
            const reqSerials = (reqItem.serialNumbers || []).map((s) => String(s).toUpperCase());

            if (!stockEntryId || quantity <= 0) {
                return res.status(400).json({ success: false, message: 'Each return item needs a valid stock batch and quantity' });
            }

            const entry = await StockEntry.findById(stockEntryId).populate('product', 'name productId').populate('supplierRef', 'name');
            if (!entry) {
                return res.status(404).json({ success: false, message: 'Stock batch not found' });
            }

            const entrySource = String(entry[field] || '').toUpperCase();
            if (entrySource !== normalizedSource) {
                return res.status(400).json({
                    success: false,
                    message: `Batch ${entry.batchRef} does not belong to ${normalizedSource}`,
                });
            }

            if (quantity > Number(entry.quantity || 0)) {
                return res.status(400).json({
                    success: false,
                    message: `Return qty exceeds available stock for ${entry.product?.name || entry.batchRef}`,
                });
            }

            const entrySerials = (entry.serialNumbers || []).map((s) => String(s).toUpperCase());
            if (entrySerials.length > 0) {
                if (reqSerials.length === 0) {
                    return res.status(400).json({
                        success: false,
                        message: `Select serial numbers for ${entry.product?.name || entry.batchRef}`,
                    });
                }
                if (reqSerials.length !== quantity) {
                    return res.status(400).json({
                        success: false,
                        message: 'Returned quantity must match selected serial count',
                    });
                }
                const missing = reqSerials.filter((s) => !entrySerials.includes(s));
                if (missing.length > 0) {
                    return res.status(400).json({
                        success: false,
                        message: `Serial(s) not in batch: ${missing.join(', ')}`,
                    });
                }
            }

            const unitCost = Number(entry.buyingPrice || 0);
            const lineTotal = unitCost * quantity;
            returnAmount += lineTotal;

            if (!resolvedSupplier && entry.supplierRef) {
                resolvedSupplier = entry.supplierRef._id || entry.supplierRef;
                supplierName = entry.supplierRef.name || '';
            }

            returnItems.push({
                stockEntryRef: entry._id,
                productRef: entry.product?._id || entry.product || null,
                productName: entry.product?.name || '',
                batchRef: entry.batchRef,
                quantity,
                unitCost,
                lineTotal,
                serialNumbers: reqSerials,
                _entry: entry,
                _reqSerials: reqSerials,
            });
        }

        if (!supplierName && resolvedSupplier) {
            const Supplier = require('../models/Supplier');
            const supplier = await Supplier.findById(resolvedSupplier).select('name');
            supplierName = supplier?.name || '';
        }

        const returnNumber = await buildReturnNumber();

        for (const item of returnItems) {
            const entry = item._entry;
            if (item._reqSerials.length > 0) {
                entry.serialNumbers = (entry.serialNumbers || []).filter(
                    (s) => !item._reqSerials.includes(String(s).toUpperCase()),
                );
                entry.hasSerialNumbers = entry.serialNumbers.length > 0;
            }
            entry.quantity = Math.max(0, Number(entry.quantity || 0) - Number(item.quantity));
            await entry.save();

            if (item.productRef) {
                await Product.findByIdAndUpdate(item.productRef, {
                    $inc: { quantity: -Number(item.quantity) },
                });
            }
        }

        const note = await GoodsReturnNote.create({
            returnNumber,
            sourceType,
            sourceNumber: normalizedSource,
            supplierRef: resolvedSupplier || null,
            supplierName: supplierName || '',
            items: returnItems.map(({ _entry, _reqSerials, ...rest }) => rest),
            reason: reason || '',
            terms: terms || '',
            notes: notes || '',
            returnAmount,
            statusHistory: [{
                status: 'Processed',
                note: 'Goods return created',
                editedBy: req.user._id,
                editedAt: new Date(),
            }],
            createdBy: req.user._id,
        });

        const populated = await GoodsReturnNote.findById(note._id)
            .populate('supplierRef', 'name supplierId telephoneNumber address emailAddress')
            .populate('items.productRef', 'name productId')
            .populate('createdBy', 'firstName lastName username name')
            .populate('statusHistory.editedBy', 'firstName lastName');

        res.status(201).json({ success: true, data: populated });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

const EDIT_DELETE_WINDOW_DAYS = 30;
const isWithinEditWindow = (createdAt) => {
    const diffDays = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24);
    return diffDays <= EDIT_DELETE_WINDOW_DAYS;
};

const restoreGoodsReturnStock = async (note) => {
    for (const item of note.items || []) {
        const qty = Number(item.quantity || 0);
        if (qty <= 0) continue;
        const serials = (item.serialNumbers || []).map((s) => String(s).toUpperCase());

        let entry = item.stockEntryRef
            ? await StockEntry.findById(item.stockEntryRef)
            : null;

        if (!entry && item.productRef) {
            entry = await StockEntry.findOne({
                product: item.productRef,
                batchRef: item.batchRef || undefined,
            }).sort({ createdAt: -1 });
        }

        if (entry) {
            if (serials.length > 0) {
                entry.serialNumbers = [...new Set([
                    ...(entry.serialNumbers || []).map((s) => String(s).toUpperCase()),
                    ...serials,
                ])];
                entry.hasSerialNumbers = entry.serialNumbers.length > 0;
            }
            entry.quantity = Number(entry.quantity || 0) + qty;
            await entry.save();
        }

        if (item.productRef) {
            await Product.findByIdAndUpdate(item.productRef, { $inc: { quantity: qty } });
        }
    }
};

exports.cancelGoodsReturn = async (req, res) => {
    try {
        const note = await GoodsReturnNote.findById(req.params.id);
        if (!note) return res.status(404).json({ success: false, message: 'Goods return not found' });
        if (note.status === 'Cancelled') {
            return res.status(400).json({ success: false, message: 'Goods return is already cancelled' });
        }
        if (!isWithinEditWindow(note.createdAt)) {
            return res.status(403).json({ success: false, message: 'Goods return can only be cancelled within 30 days of creation' });
        }

        const trimmedReason = (req.body?.reason || '').trim();
        if (!trimmedReason) {
            return res.status(400).json({ success: false, message: 'Cancellation reason is required' });
        }

        await restoreGoodsReturnStock(note);

        note.status = 'Cancelled';
        note.cancelledBy = req.user._id;
        note.cancellationNote = trimmedReason;
        note.statusHistory = [
            ...(note.statusHistory || []),
            {
                status: 'Cancelled',
                note: `Goods return cancelled. Reason: ${trimmedReason}`,
                editedBy: req.user._id,
                editedAt: new Date(),
            },
        ];
        await note.save();

        const populated = await GoodsReturnNote.findById(note._id)
            .populate('supplierRef', 'name supplierId')
            .populate('items.productRef', 'name productId')
            .populate('createdBy', 'firstName lastName username name')
            .populate('statusHistory.editedBy', 'firstName lastName')
            .populate('cancelledBy', 'firstName lastName');

        res.status(200).json({ success: true, message: 'Goods return cancelled.', data: populated });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.editGoodsReturn = async (req, res) => {
    try {
        const note = await GoodsReturnNote.findById(req.params.id);
        if (!note) return res.status(404).json({ success: false, message: 'Goods return not found' });
        if (note.status === 'Cancelled') {
            return res.status(400).json({ success: false, message: 'Cannot edit a cancelled goods return' });
        }
        if (!isWithinEditWindow(note.createdAt)) {
            return res.status(403).json({ success: false, message: 'Goods return can only be edited within 30 days of creation' });
        }

        const editNote = (req.body.editNote || '').trim();
        if (!editNote) {
            return res.status(400).json({ success: false, message: 'Edit reason is required' });
        }

        if (req.body.reason !== undefined) note.reason = req.body.reason;
        if (req.body.terms !== undefined) note.terms = req.body.terms;
        if (req.body.notes !== undefined) note.notes = req.body.notes;

        note.statusHistory = [
            ...(note.statusHistory || []),
            {
                status: 'Processed',
                note: `Edited. Reason: ${editNote}`,
                editedBy: req.user._id,
                editedAt: new Date(),
            },
        ];
        await note.save();

        const populated = await GoodsReturnNote.findById(note._id)
            .populate('supplierRef', 'name supplierId')
            .populate('items.productRef', 'name productId')
            .populate('createdBy', 'firstName lastName username name')
            .populate('statusHistory.editedBy', 'firstName lastName');

        res.status(200).json({ success: true, message: 'Goods return updated.', data: populated });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};
