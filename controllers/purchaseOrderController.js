const PurchaseOrder = require('../models/PurchaseOrder');

exports.createPurchaseOrder = async (req, res) => {
    try {
        // Find latest purchase order to determine next PO sequence
        const latest = await PurchaseOrder.findOne().sort({ createdAt: -1 });
        let sequence = 1;
        if (latest && latest.poNumber && latest.poNumber.startsWith('PO')) {
            const num = parseInt(latest.poNumber.substring(2), 10);
            if (!isNaN(num)) sequence = num + 1;
        }
        const poNumber = `PO${sequence.toString().padStart(5, '0')}`;
        
        let payload = { ...req.body };
        if (payload.supplierRef === "") payload.supplierRef = undefined;
        if (payload.items) {
            payload.items = payload.items.map(i => {
                if (i.productRef === "") i.productRef = undefined;
                return i;
            });
        }

        const purchaseOrder = await PurchaseOrder.create({
            ...payload,
            poNumber,
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
            .populate('createdBy', 'firstName lastName');
        if (!purchaseOrder) return res.status(404).json({ success: false, message: 'Purchase order not found' });
        res.status(200).json({ success: true, data: purchaseOrder });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.updatePurchaseOrder = async (req, res) => {
    try {
        let payload = { ...req.body };
        if (payload.items) {
            payload.items = payload.items.map(i => {
                if (i.productRef === "") i.productRef = undefined;
                return i;
            });
        }
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

exports.deletePurchaseOrder = async (req, res) => {
    try {
        const purchaseOrder = await PurchaseOrder.findByIdAndDelete(req.params.id);
        if (!purchaseOrder) return res.status(404).json({ success: false, message: 'Purchase order not found' });
        res.status(200).json({ success: true, message: 'Purchase order deleted successfully.' });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};
