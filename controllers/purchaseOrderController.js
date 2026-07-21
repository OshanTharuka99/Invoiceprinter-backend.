const PurchaseOrder = require('../models/PurchaseOrder');
const BusinessDetails = require('../models/BusinessDetails');

const EDIT_DELETE_WINDOW_DAYS = 30;

const isWithinEditWindow = (createdAt) => {
    const diffDays = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24);
    return diffDays <= EDIT_DELETE_WINDOW_DAYS;
};

const nextPoNumber = async () => {
    const bizDetails = await BusinessDetails.findOne();
    const prefix = bizDetails?.purchaseOrderPrefix || 'PO';
    const digits = bizDetails?.purchaseOrderDigits || 5;
    const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const latest = await PurchaseOrder.findOne({
        poNumber: new RegExp('^' + escapedPrefix)
    }).sort({ createdAt: -1 });

    let sequence = 1;
    if (latest && latest.poNumber) {
        const suffixStr = latest.poNumber.substring(prefix.length);
        const num = parseInt(suffixStr, 10);
        if (!isNaN(num)) sequence = num + 1;
    }
    return `${prefix}${sequence.toString().padStart(digits, '0')}`;
};

const sanitizePOPayload = (body) => {
    const payload = { ...body };
    if (payload.supplierRef === '') payload.supplierRef = undefined;
    if (payload.items) {
        payload.items = payload.items.map((i) => {
            if (i.productRef === '') i.productRef = undefined;
            return i;
        });
    }
    delete payload.editNote;
    delete payload.statusHistory;
    delete payload.cancelledBy;
    delete payload.cancellationNote;
    delete payload.poNumber;
    delete payload.originalPORef;
    return payload;
};

exports.createPurchaseOrder = async (req, res) => {
    try {
        const poNumber = await nextPoNumber();
        const payload = sanitizePOPayload(req.body);

        const purchaseOrder = await PurchaseOrder.create({
            ...payload,
            poNumber,
            statusHistory: [{
                status: payload.status || 'Draft',
                note: 'Purchase order created',
                editedBy: req.user._id,
                editedAt: new Date(),
            }],
            createdBy: req.user._id
        });

        res.status(201).json({ success: true, data: purchaseOrder });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.getPurchaseOrders = async (req, res) => {
    try {
        const purchaseOrders = await PurchaseOrder.find()
            .populate('supplierRef')
            .populate('items.productRef')
            .populate('createdBy', 'firstName lastName')
            .populate('statusHistory.editedBy', 'firstName lastName')
            .populate('cancelledBy', 'firstName lastName')
            .sort({ createdAt: -1 });
        res.status(200).json({ success: true, data: purchaseOrders });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.getPurchaseOrderById = async (req, res) => {
    try {
        const purchaseOrder = await PurchaseOrder.findById(req.params.id)
            .populate('supplierRef')
            .populate('items.productRef')
            .populate('createdBy', 'firstName lastName')
            .populate('statusHistory.editedBy', 'firstName lastName')
            .populate('cancelledBy', 'firstName lastName');
        if (!purchaseOrder) return res.status(404).json({ success: false, message: 'Purchase order not found' });
        res.status(200).json({ success: true, data: purchaseOrder });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.updatePurchaseOrder = async (req, res) => {
    try {
        const payload = sanitizePOPayload(req.body);
        const purchaseOrder = await PurchaseOrder.findByIdAndUpdate(req.params.id, payload, { new: true, runValidators: true })
            .populate('supplierRef')
            .populate('items.productRef')
            .populate('createdBy', 'firstName lastName');
        if (!purchaseOrder) return res.status(404).json({ success: false, message: 'Purchase order not found' });
        res.status(200).json({ success: true, data: purchaseOrder });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

// Root superseding edit — cancel original + create new PO with log
exports.editPurchaseOrder = async (req, res) => {
    try {
        const original = await PurchaseOrder.findById(req.params.id);
        if (!original) return res.status(404).json({ success: false, message: 'Purchase order not found' });
        if (original.status === 'Cancelled') {
            return res.status(400).json({ success: false, message: 'Cannot edit a cancelled purchase order' });
        }
        if (!isWithinEditWindow(original.createdAt)) {
            return res.status(403).json({ success: false, message: 'Purchase order can only be edited within 30 days of creation' });
        }

        const editNote = (req.body.editNote || '').trim();
        if (!editNote) {
            return res.status(400).json({ success: false, message: 'Edit reason is required' });
        }

        const payload = sanitizePOPayload(req.body);
        if (!payload.items || payload.items.length === 0) {
            return res.status(400).json({ success: false, message: 'At least one item is required' });
        }

        original.status = 'Cancelled';
        original.cancelledBy = req.user._id;
        original.cancellationNote = editNote;
        original.statusHistory = [
            ...(original.statusHistory || []),
            {
                status: 'Cancelled',
                note: editNote || 'Purchase order superseded by edit',
                editedBy: req.user._id,
                editedAt: new Date(),
            },
        ];
        await original.save();

        const poNumber = await nextPoNumber();
        const created = await PurchaseOrder.create({
            ...payload,
            poNumber,
            statusHistory: [
                ...(original.statusHistory || []),
                {
                    status: payload.status || 'Draft',
                    note: `Created as edit of ${original.poNumber}`,
                    editedBy: req.user._id,
                    editedAt: new Date(),
                },
            ],
            originalPORef: original._id,
            createdBy: req.user._id,
        });

        const populated = await PurchaseOrder.findById(created._id)
            .populate('supplierRef')
            .populate('items.productRef')
            .populate('createdBy', 'firstName lastName')
            .populate('statusHistory.editedBy', 'firstName lastName');

        res.status(200).json({
            success: true,
            message: `Purchase order edited. Original ${original.poNumber} cancelled.`,
            data: populated,
        });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

// Soft cancel with required reason (Invoice-style)
exports.deletePurchaseOrder = async (req, res) => {
    try {
        const purchaseOrder = await PurchaseOrder.findById(req.params.id);
        if (!purchaseOrder) return res.status(404).json({ success: false, message: 'Purchase order not found' });

        if (purchaseOrder.status === 'Cancelled') {
            return res.status(400).json({ success: false, message: 'Purchase order is already cancelled' });
        }

        if (!isWithinEditWindow(purchaseOrder.createdAt)) {
            return res.status(403).json({ success: false, message: 'Purchase order can only be deleted within 30 days of creation' });
        }

        const trimmedReason = (req.body?.reason || '').trim();
        if (!trimmedReason) {
            return res.status(400).json({ success: false, message: 'Deletion reason is required' });
        }

        purchaseOrder.status = 'Cancelled';
        purchaseOrder.cancelledBy = req.user._id;
        purchaseOrder.cancellationNote = trimmedReason;
        purchaseOrder.statusHistory = [
            ...(purchaseOrder.statusHistory || []),
            {
                status: 'Cancelled',
                note: `Purchase order deleted. Reason: ${trimmedReason}`,
                editedBy: req.user._id,
                editedAt: new Date(),
            },
        ];
        await purchaseOrder.save();

        res.status(200).json({ success: true, message: 'Purchase order cancelled.', data: purchaseOrder });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};
