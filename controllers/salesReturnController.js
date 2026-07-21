const SalesReturnNote = require('../models/SalesReturnNote');
const Invoice = require('../models/Invoice');
const DeliveryNote = require('../models/DeliveryNote');
const Product = require('../models/Product');
const StockEntry = require('../models/StockEntry');
const Warranty = require('../models/Warranty');
const BusinessDetails = require('../models/BusinessDetails');
const { getEstimatedUnitCost } = require('../utils/stockCost');

const toObjectIdString = (value) => (value ? String(value) : '');

const buildSourceItemKey = (item) => {
    const productKey = item.productRef ? toObjectIdString(item.productRef._id || item.productRef) : `manual:${item.manualName || ''}`;
    const unitPrice = Number(item.unitPrice || 0);
    return `${productKey}|${item.manualName || ''}|${unitPrice}`;
};

const normalizeDocItems = (items = []) => items.map((item) => ({
    sourceItemKey: buildSourceItemKey(item),
    productRef: item.productRef?._id || item.productRef || null,
    manualName: item.manualName || item.productRef?.name || '',
    quantity: Number(item.quantity || 0),
    unitPrice: Number(item.unitPrice || item.productRef?.price || 0),
    lineTotal: Number(item.lineTotal || 0),
    unitCost: Number(item.unitCost || 0),
    serialNumbers: (item.serialNumbers || []).map((s) => String(s).toUpperCase()),
}));

const getClientPayload = (doc) => ({
    clientRef: doc.clientRef?._id || doc.clientRef || null,
    manualClientDetails: doc.manualClientDetails || {},
});

const resolveReturnStockMeta = async (item, sourceItem, sourceDoc) => {
    let buyingPrice = Number(sourceItem?.unitCost || 0);
    let warrantyPeriod = '';

    const serials = (item.serialNumbers || []).map((s) => s.toUpperCase());

    if (serials.length > 0 && sourceDoc?._id) {
        const warranties = await Warranty.find({
            productRef: item.productRef,
            serialNumber: { $in: serials },
            invoiceRef: sourceDoc._id,
        }).select('warrantyPeriod');

        if (warranties.length > 0) {
            warrantyPeriod = warranties.find((w) => w.warrantyPeriod)?.warrantyPeriod || warranties[0].warrantyPeriod || '';
        }

        for (const serial of serials) {
            const entry = await StockEntry.findOne({
                product: item.productRef,
                serialNumbers: serial,
            }).select('buyingPrice warrantyPeriod');

            if (entry) {
                if (Number(entry.buyingPrice) > 0) buyingPrice = Number(entry.buyingPrice);
                if (entry.warrantyPeriod) warrantyPeriod = entry.warrantyPeriod;
                break;
            }
        }
    }

    if (!buyingPrice && item.productRef) {
        buyingPrice = await getEstimatedUnitCost(item.productRef);
    }

    if (!warrantyPeriod && item.productRef) {
        const product = await Product.findById(item.productRef).select('warrantyPeriod');
        warrantyPeriod = product?.warrantyPeriod || '';
        if (!warrantyPeriod) {
            const biz = await BusinessDetails.findOne().select('defaultWarrantyPeriod');
            warrantyPeriod = biz?.defaultWarrantyPeriod || '';
        }
    }

    return {
        buyingPrice: buyingPrice || 0,
        warrantyPeriod: warrantyPeriod || '',
    };
};

const restoreStockForReturnItem = async (item, userId, location = '', returnNumber = '', stockMeta = {}) => {
    if (!item.productRef) return;

    const serials = (item.serialNumbers || []).map((s) => s.toUpperCase());
    const qty = Number(item.quantity || 0);
    if (qty <= 0) return;

    const product = await Product.findById(item.productRef).select('productId name');
    const batchCount = await StockEntry.countDocuments({ product: item.productRef });
    const batchRef = `${product?.productId || 'STOCK'}-SRN-${(batchCount + 1).toString().padStart(3, '0')}`;

    const buyingPrice = Number(stockMeta.buyingPrice || 0);
    const warrantyPeriod = stockMeta.warrantyPeriod || '';

    await StockEntry.create({
        product: item.productRef,
        batchRef,
        location: location || '',
        buyingPrice,
        warrantyPeriod,
        quantity: qty,
        serialNumbers: serials,
        hasSerialNumbers: serials.length > 0,
        notes: returnNumber
            ? `Sales return ${returnNumber} — restored stock (buy: ${buyingPrice}, warranty: ${warrantyPeriod || 'N/A'})`
            : 'Restored from sales return note',
        addedBy: userId,
    });

    await Product.findByIdAndUpdate(item.productRef, { $inc: { quantity: qty } });
};

const allocateReturnAgainstItem = (sourceItem, requestItem) => {
    const sourceSerials = (sourceItem.serialNumbers || []).map((s) => s.toUpperCase());
    const reqSerials = (requestItem.serialNumbers || []).map((s) => s.toUpperCase());
    const requestedQty = Number(requestItem.quantity || 0);

    if (reqSerials.length > 0) {
        const missing = reqSerials.filter((s) => !sourceSerials.includes(s));
        if (missing.length > 0) {
            throw new Error(`Serial(s) not found in source: ${missing.join(', ')}`);
        }
        if (reqSerials.length !== requestedQty) {
            throw new Error('Returned quantity must match serial count for serialized item');
        }
    }

    if (requestedQty <= 0) throw new Error('Return quantity must be greater than zero');
    if (requestedQty > Number(sourceItem.quantity || 0)) {
        throw new Error(`Return quantity exceeds sold quantity for ${sourceItem.manualName || 'item'}`);
    }

    const lineUnitPrice = Number(sourceItem.unitPrice || 0);
    return {
        sourceItemKey: sourceItem.sourceItemKey,
        productRef: sourceItem.productRef || null,
        manualName: sourceItem.manualName || '',
        quantity: requestedQty,
        unitPrice: lineUnitPrice,
        lineTotal: lineUnitPrice * requestedQty,
        unitCost: Number(sourceItem.unitCost || 0),
        serialNumbers: reqSerials.length > 0 ? reqSerials : [],
    };
};

const buildInvoiceNumber = async () => {
    const bizDetails = await BusinessDetails.findOne();
    const prefix = bizDetails?.invoicePrefix || 'INV';
    const digits = bizDetails?.invoiceDigits || 5;
    const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const latestInvoice = await Invoice.findOne({
        invoiceNumber: new RegExp(`^${escapedPrefix}`),
    }).sort({ createdAt: -1 });

    let sequence = 1;
    if (latestInvoice?.invoiceNumber) {
        const num = parseInt(latestInvoice.invoiceNumber.substring(prefix.length), 10);
        if (!Number.isNaN(num)) sequence = num + 1;
    }
    return `${prefix}${sequence.toString().padStart(digits, '0')}`;
};

const addValidityPeriod = (startDate, duration, unit) => {
    const expiry = new Date(startDate);
    const amount = Number(duration) || 0;
    switch (unit) {
        case 'years':
            expiry.setFullYear(expiry.getFullYear() + amount);
            break;
        case 'months':
            expiry.setMonth(expiry.getMonth() + amount);
            break;
        case 'weeks':
            expiry.setDate(expiry.getDate() + (amount * 7));
            break;
        default:
            expiry.setDate(expiry.getDate() + amount);
    }
    return expiry;
};

const getSourceReferenceDate = async (sourceType, sourceDoc) => {
    if (sourceType === 'invoice') {
        return sourceDoc.invoiceDate || sourceDoc.createdAt;
    }
    const linkedInvoice = await Invoice.findOne({ deliveryNoteRef: sourceDoc._id })
        .select('invoiceDate createdAt');
    return linkedInvoice?.invoiceDate
        || linkedInvoice?.createdAt
        || sourceDoc.deliveryDate
        || sourceDoc.createdAt;
};

const evaluateReturnValidity = async (sourceType, sourceDoc) => {
    const bizDetails = await BusinessDetails.findOne();
    const duration = bizDetails?.salesReturnValidityDuration ?? 30;
    const unit = bizDetails?.salesReturnValidityUnit || 'days';
    const referenceDate = await getSourceReferenceDate(sourceType, sourceDoc);
    const expiresAt = addValidityPeriod(referenceDate, duration, unit);
    const now = new Date();
    const msRemaining = expiresAt.getTime() - now.getTime();
    const daysRemaining = Math.max(0, Math.ceil(msRemaining / (1000 * 60 * 60 * 24)));

    return {
        valid: now <= expiresAt,
        referenceDate,
        expiresAt,
        duration,
        unit,
        daysRemaining,
    };
};

const buildReturnNumber = async () => {
    const bizDetails = await BusinessDetails.findOne();
    const prefix = bizDetails?.salesReturnPrefix || 'SRN';
    const digits = bizDetails?.salesReturnDigits || 5;
    const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const latest = await SalesReturnNote.findOne({
        returnNumber: new RegExp(`^${escapedPrefix}`),
    }).sort({ createdAt: -1 });

    let sequence = 1;
    if (latest?.returnNumber) {
        const num = parseInt(latest.returnNumber.substring(prefix.length), 10);
        if (!Number.isNaN(num)) sequence = num + 1;
    }
    return `${prefix}${sequence.toString().padStart(digits, '0')}`;
};

exports.getSourceDocument = async (req, res) => {
    try {
        const invoiceNumber = (req.query.invoiceNumber || '').trim().toUpperCase();
        const deliveryNoteNumber = (req.query.deliveryNoteNumber || '').trim().toUpperCase();

        if (!invoiceNumber && !deliveryNoteNumber) {
            return res.status(400).json({ success: false, message: 'Provide invoiceNumber or deliveryNoteNumber' });
        }

        let sourceType = 'invoice';
        let sourceDoc;
        if (invoiceNumber) {
            sourceDoc = await Invoice.findOne({ invoiceNumber })
                .populate('clientRef')
                .populate('items.productRef', 'name productId');
        } else {
            sourceType = 'delivery_note';
            sourceDoc = await DeliveryNote.findOne({ deliveryNoteNumber })
                .populate('clientRef')
                .populate('items.productRef', 'name productId price');
        }

        if (!sourceDoc) {
            return res.status(404).json({ success: false, message: 'Source document not found' });
        }

        if (sourceType === 'invoice' && sourceDoc.status === 'Cancelled') {
            return res.status(403).json({
                success: false,
                message: 'Cannot load a cancelled invoice for sales return.',
            });
        }

        const validity = await evaluateReturnValidity(sourceType, sourceDoc);
        const isSuperRoot = req.user.role === 'root';
        if (!validity.valid && !isSuperRoot) {
            return res.status(403).json({
                success: false,
                message: `Return window expired. Returns are allowed only within ${validity.duration} ${validity.unit} from the invoice date. Contact Super Admin for special requirements.`,
                validity,
            });
        }

        const sourceItems = normalizeDocItems(sourceDoc.items || []);
        const previousReturns = await SalesReturnNote.find({
            ...(sourceType === 'invoice'
                ? { sourceInvoiceRef: sourceDoc._id }
                : { sourceDeliveryNoteRef: sourceDoc._id }),
            status: { $ne: 'Cancelled' },
        }).select('items');

        const returnedByKey = new Map();
        previousReturns.forEach((ret) => {
            (ret.items || []).forEach((item) => {
                const key = item.sourceItemKey || buildSourceItemKey(item);
                const qty = Number(item.quantity || 0);
                returnedByKey.set(key, (returnedByKey.get(key) || 0) + qty);
            });
        });

        const enrichedItems = sourceItems.map((item) => {
            const returnedQty = returnedByKey.get(item.sourceItemKey) || 0;
            return { ...item, alreadyReturnedQty: returnedQty, maxReturnableQty: Math.max(0, item.quantity - returnedQty) };
        });

        res.status(200).json({
            success: true,
            data: {
                sourceType,
                sourceId: sourceDoc._id,
                sourceNumber: sourceType === 'invoice' ? sourceDoc.invoiceNumber : sourceDoc.deliveryNoteNumber,
                paymentMethod: sourceDoc.paymentMethod || 'unknown',
                invoiceDate: sourceDoc.invoiceDate || sourceDoc.createdAt,
                referenceDate: validity.referenceDate,
                validityExpiresAt: validity.expiresAt,
                validityDuration: validity.duration,
                validityUnit: validity.unit,
                validityDaysRemaining: validity.daysRemaining,
                validityExpired: !validity.valid,
                allowSpecialOverride: isSuperRoot && !validity.valid,
                clientRef: sourceDoc.clientRef || null,
                manualClientDetails: sourceDoc.manualClientDetails || {},
                items: enrichedItems,
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getSalesReturns = async (req, res) => {
    try {
        const notes = await SalesReturnNote.find()
            .populate('clientRef')
            .populate('createdBy', 'firstName lastName')
            .populate('sourceInvoiceRef', 'invoiceNumber invoiceDate paymentMethod status')
            .populate('sourceDeliveryNoteRef', 'deliveryNoteNumber createdAt status')
            .populate('replacementInvoiceRef', 'invoiceNumber invoiceDate status')
            .populate('items.productRef', 'name productId')
            .populate('statusHistory.editedBy', 'firstName lastName')
            .populate('cancelledBy', 'firstName lastName')
            .sort({ createdAt: -1 });

        res.status(200).json({ success: true, data: notes });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.createSalesReturn = async (req, res) => {
    try {
        const {
            sourceType,
            sourceId,
            items,
            returnStockLocation,
            reason,
            terms,
            notes,
            specialOverride,
        } = req.body;

        if (!sourceType || !['invoice', 'delivery_note'].includes(sourceType)) {
            return res.status(400).json({ success: false, message: 'Invalid source type' });
        }
        if (!sourceId) {
            return res.status(400).json({ success: false, message: 'Source document is required' });
        }
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, message: 'At least one return item is required' });
        }

        const sourceDoc = sourceType === 'invoice'
            ? await Invoice.findById(sourceId).populate('clientRef')
            : await DeliveryNote.findById(sourceId).populate('clientRef');

        if (!sourceDoc) {
            return res.status(404).json({ success: false, message: 'Source document not found' });
        }

        if (sourceType === 'invoice' && sourceDoc.status === 'Cancelled') {
            return res.status(403).json({
                success: false,
                message: 'Cannot process return for a cancelled invoice.',
            });
        }

        const validity = await evaluateReturnValidity(sourceType, sourceDoc);
        const isSuperRoot = req.user.role === 'root';
        if (!validity.valid) {
            if (!isSuperRoot || !specialOverride) {
                return res.status(403).json({
                    success: false,
                    message: isSuperRoot
                        ? 'Return window expired. Enable Special Requirement override to proceed.'
                        : `Return window expired. Returns are allowed only within ${validity.duration} ${validity.unit} from the invoice date. Contact Super Admin for special requirements.`,
                    validity,
                });
            }
        }

        const sourceItems = normalizeDocItems(sourceDoc.items || []);
        const sourceByKey = new Map(sourceItems.map((item) => [item.sourceItemKey, item]));
        const previousReturns = await SalesReturnNote.find({
            ...(sourceType === 'invoice'
                ? { sourceInvoiceRef: sourceDoc._id }
                : { sourceDeliveryNoteRef: sourceDoc._id }),
            status: { $ne: 'Cancelled' },
        }).select('items');
        const alreadyReturned = new Map();
        previousReturns.forEach((ret) => {
            (ret.items || []).forEach((item) => {
                const key = item.sourceItemKey || buildSourceItemKey(item);
                alreadyReturned.set(key, (alreadyReturned.get(key) || 0) + Number(item.quantity || 0));
            });
        });

        const returnItems = [];
        for (const reqItem of items) {
            const key = reqItem.sourceItemKey || '';
            const sourceItem = sourceByKey.get(key);
            if (!sourceItem) {
                return res.status(400).json({ success: false, message: 'Invalid source item in return request' });
            }
            const remainingQty = Number(sourceItem.quantity || 0) - (alreadyReturned.get(key) || 0);
            if (Number(reqItem.quantity || 0) > remainingQty) {
                return res.status(400).json({
                    success: false,
                    message: `Return quantity exceeds remaining returnable quantity for ${sourceItem.manualName || 'item'}`,
                });
            }
            returnItems.push(allocateReturnAgainstItem(sourceItem, reqItem));
        }

        const returnNumber = await buildReturnNumber();

        for (const item of returnItems) {
            const sourceItem = sourceByKey.get(item.sourceItemKey);
            const stockMeta = await resolveReturnStockMeta(item, sourceItem, sourceDoc);
            await restoreStockForReturnItem(item, req.user._id, returnStockLocation || '', returnNumber, stockMeta);

            if (item.productRef && (item.serialNumbers || []).length > 0) {
                await Warranty.deleteMany({
                    productRef: item.productRef,
                    serialNumber: { $in: item.serialNumbers.map((s) => s.toUpperCase()) },
                    ...(sourceType === 'invoice' ? { invoiceRef: sourceDoc._id } : {}),
                });
            }
        }

        let originalInvoiceCancelled = false;
        let replacementInvoice = null;

        if (sourceType === 'invoice') {
            const returnQtyByKey = new Map();
            returnItems.forEach((item) => {
                returnQtyByKey.set(item.sourceItemKey, (returnQtyByKey.get(item.sourceItemKey) || 0) + Number(item.quantity || 0));
            });

            const remainingItems = [];
            let remainingSubTotal = 0;
            let originalSubTotal = 0;

            sourceItems.forEach((item) => {
                const returned = returnQtyByKey.get(item.sourceItemKey) || 0;
                const remainQty = Math.max(0, Number(item.quantity || 0) - returned);
                originalSubTotal += Number(item.lineTotal || 0);
                if (remainQty > 0) {
                    const unitPrice = Number(item.unitPrice || 0);
                    const sourceSerials = item.serialNumbers || [];
                    const returnedSerials = returnItems
                        .filter((r) => r.sourceItemKey === item.sourceItemKey)
                        .flatMap((r) => r.serialNumbers || []);
                    const remainingSerials = sourceSerials.filter((s) => !returnedSerials.includes(s));
                    const lineTotal = unitPrice * remainQty;
                    remainingItems.push({
                        productRef: item.productRef || null,
                        manualName: item.manualName || '',
                        quantity: remainQty,
                        unitPrice,
                        unitCost: item.unitCost || 0,
                        lineTotal,
                        serialNumbers: remainingSerials,
                    });
                    remainingSubTotal += lineTotal;
                }
            });

            sourceDoc.status = 'Cancelled';
            sourceDoc.cancelledBy = req.user._id;
            sourceDoc.cancellationNote = `Cancelled by sales return`;
            sourceDoc.statusHistory = [
                ...(sourceDoc.statusHistory || []),
                {
                    status: 'Cancelled',
                    note: 'Cancelled due to sales return processing',
                    editedBy: req.user._id,
                    editedAt: new Date(),
                },
            ];
            await sourceDoc.save();
            originalInvoiceCancelled = true;

            if (remainingItems.length > 0) {
                const discountRatio = originalSubTotal > 0 ? Number(sourceDoc.discountTotal || 0) / originalSubTotal : 0;
                const taxRatio = originalSubTotal > 0 ? Number(sourceDoc.taxTotal || 0) / originalSubTotal : 0;
                const discountTotal = Math.max(0, Number((remainingSubTotal * discountRatio).toFixed(2)));
                const taxTotal = Math.max(0, Number((remainingSubTotal * taxRatio).toFixed(2)));
                const finalTotal = Math.max(0, Number((remainingSubTotal - discountTotal + taxTotal).toFixed(2)));

                const newInvoiceNumber = await buildInvoiceNumber();
                replacementInvoice = await Invoice.create({
                    invoiceNumber: newInvoiceNumber,
                    invoiceDate: sourceDoc.invoiceDate || sourceDoc.createdAt,
                    creationMethod: sourceDoc.creationMethod,
                    clientRef: sourceDoc.clientRef || undefined,
                    manualClientDetails: sourceDoc.manualClientDetails || {},
                    projectId: sourceDoc.projectId || undefined,
                    paymentMethod: sourceDoc.paymentMethod || 'credit',
                    creditPeriod: sourceDoc.creditPeriod || { duration: 0, unit: 'days' },
                    deliveryAddress: sourceDoc.deliveryAddress || '',
                    customerPO: sourceDoc.customerPO || '',
                    items: remainingItems,
                    subTotal: remainingSubTotal,
                    appliedDiscounts: sourceDoc.appliedDiscounts || [],
                    discountTotal,
                    hasTax: sourceDoc.hasTax || false,
                    appliedTaxes: sourceDoc.appliedTaxes || [],
                    taxTotal,
                    finalTotal,
                    currency: sourceDoc.currency || 'primary',
                    status: sourceDoc.paymentMethod === 'cash' ? 'Paid' : 'Unpaid',
                    statusHistory: [{
                        status: sourceDoc.paymentMethod === 'cash' ? 'Paid' : 'Unpaid',
                        note: `Backdated replacement generated from ${sourceDoc.invoiceNumber} after sales return`,
                        editedBy: req.user._id,
                        editedAt: new Date(),
                    }],
                    originalInvoiceRef: sourceDoc._id,
                    createdBy: req.user._id,
                });
            }
        }

        const returnAmount = returnItems.reduce((sum, item) => sum + Number(item.lineTotal || 0), 0);
        const clientPayload = getClientPayload(sourceDoc);

        const note = await SalesReturnNote.create({
            returnNumber,
            sourceType,
            sourceInvoiceRef: sourceType === 'invoice' ? sourceDoc._id : null,
            sourceDeliveryNoteRef: sourceType === 'delivery_note' ? sourceDoc._id : null,
            sourceNumber: sourceType === 'invoice' ? sourceDoc.invoiceNumber : sourceDoc.deliveryNoteNumber,
            ...clientPayload,
            paymentMethodAtSale: sourceDoc.paymentMethod || 'unknown',
            items: returnItems,
            returnStockLocation: returnStockLocation || '',
            reason: reason || '',
            terms: terms || '',
            notes: notes || '',
            returnAmount,
            originalInvoiceCancelled,
            replacementInvoiceRef: replacementInvoice?._id || null,
            statusHistory: [{
                status: 'Processed',
                note: 'Sales return created',
                editedBy: req.user._id,
                editedAt: new Date(),
            }],
            createdBy: req.user._id,
        });

        const populated = await SalesReturnNote.findById(note._id)
            .populate('clientRef')
            .populate('createdBy', 'firstName lastName')
            .populate('sourceInvoiceRef', 'invoiceNumber invoiceDate status')
            .populate('sourceDeliveryNoteRef', 'deliveryNoteNumber createdAt status')
            .populate('replacementInvoiceRef', 'invoiceNumber invoiceDate status')
            .populate('items.productRef', 'name productId')
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

const reverseSalesReturnStock = async (note) => {
    for (const item of note.items || []) {
        if (!item.productRef) continue;
        const qty = Number(item.quantity || 0);
        if (qty <= 0) continue;
        const serials = (item.serialNumbers || []).map((s) => String(s).toUpperCase());

        let entry = await StockEntry.findOne({
            product: item.productRef,
            notes: new RegExp(`Sales return ${note.returnNumber}`),
        }).sort({ createdAt: -1 });

        if (!entry) {
            entry = await StockEntry.findOne({ product: item.productRef }).sort({ createdAt: -1 });
        }

        if (entry) {
            if (serials.length > 0) {
                entry.serialNumbers = (entry.serialNumbers || [])
                    .map((s) => String(s).toUpperCase())
                    .filter((s) => !serials.includes(s));
                entry.hasSerialNumbers = entry.serialNumbers.length > 0;
            }
            entry.quantity = Math.max(0, Number(entry.quantity || 0) - qty);
            await entry.save();
        }

        await Product.findByIdAndUpdate(item.productRef, { $inc: { quantity: -qty } });
    }
};

// Soft cancel sales return + reverse restored stock (Invoice-style delete)
exports.cancelSalesReturn = async (req, res) => {
    try {
        const note = await SalesReturnNote.findById(req.params.id);
        if (!note) return res.status(404).json({ success: false, message: 'Sales return not found' });
        if (note.status === 'Cancelled') {
            return res.status(400).json({ success: false, message: 'Sales return is already cancelled' });
        }
        if (!isWithinEditWindow(note.createdAt)) {
            return res.status(403).json({ success: false, message: 'Sales return can only be cancelled within 30 days of creation' });
        }

        const trimmedReason = (req.body?.reason || '').trim();
        if (!trimmedReason) {
            return res.status(400).json({ success: false, message: 'Cancellation reason is required' });
        }

        await reverseSalesReturnStock(note);

        note.status = 'Cancelled';
        note.cancelledBy = req.user._id;
        note.cancellationNote = trimmedReason;
        note.statusHistory = [
            ...(note.statusHistory || []),
            {
                status: 'Cancelled',
                note: `Sales return cancelled. Reason: ${trimmedReason}`,
                editedBy: req.user._id,
                editedAt: new Date(),
            },
        ];
        await note.save();

        const populated = await SalesReturnNote.findById(note._id)
            .populate('clientRef')
            .populate('createdBy', 'firstName lastName')
            .populate('items.productRef', 'name productId')
            .populate('statusHistory.editedBy', 'firstName lastName')
            .populate('cancelledBy', 'firstName lastName');

        res.status(200).json({ success: true, message: 'Sales return cancelled.', data: populated });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

// Edit metadata with required edit note (logged to statusHistory)
exports.editSalesReturn = async (req, res) => {
    try {
        const note = await SalesReturnNote.findById(req.params.id);
        if (!note) return res.status(404).json({ success: false, message: 'Sales return not found' });
        if (note.status === 'Cancelled') {
            return res.status(400).json({ success: false, message: 'Cannot edit a cancelled sales return' });
        }
        if (!isWithinEditWindow(note.createdAt)) {
            return res.status(403).json({ success: false, message: 'Sales return can only be edited within 30 days of creation' });
        }

        const editNote = (req.body.editNote || '').trim();
        if (!editNote) {
            return res.status(400).json({ success: false, message: 'Edit reason is required' });
        }

        if (req.body.reason !== undefined) note.reason = req.body.reason;
        if (req.body.terms !== undefined) note.terms = req.body.terms;
        if (req.body.notes !== undefined) note.notes = req.body.notes;
        if (req.body.returnStockLocation !== undefined) note.returnStockLocation = req.body.returnStockLocation;

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

        const populated = await SalesReturnNote.findById(note._id)
            .populate('clientRef')
            .populate('createdBy', 'firstName lastName')
            .populate('items.productRef', 'name productId')
            .populate('statusHistory.editedBy', 'firstName lastName');

        res.status(200).json({ success: true, message: 'Sales return updated.', data: populated });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};
