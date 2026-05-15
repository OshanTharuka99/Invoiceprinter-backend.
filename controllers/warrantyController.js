const Warranty = require('../models/Warranty');

exports.getWarranties = async (req, res) => {
    try {
        const { status, product, client, project } = req.query;

        const query = {};
        if (status) query.status = status;
        if (product) query.productRef = product;
        if (client) query.clientRef = client;
        if (project) query.projectRef = project;

        const now = new Date();
        const warranties = await Warranty.find(query)
            .populate('invoiceRef', 'invoiceNumber manualClientDetails')
            .populate('clientRef', 'firstName lastName clientId')
            .populate('projectRef', 'projectId name')
            .populate('productRef', 'name productId warrantyPeriod')
            .sort({ expiryDate: 1 });

        const updatedWarranties = warranties.map(w => {
            const warrantyObj = w.toObject();
            if (warrantyObj.expiryDate && new Date(warrantyObj.expiryDate) < now && warrantyObj.status === 'active') {
                warrantyObj.status = 'expired';
            }
            return warrantyObj;
        });

        const activeCount = updatedWarranties.filter(w => w.status === 'active').length;
        const expiredCount = updatedWarranties.filter(w => w.status === 'expired').length;

        res.status(200).json({
            success: true,
            data: updatedWarranties,
            stats: {
                total: updatedWarranties.length,
                active: activeCount,
                expired: expiredCount
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getWarrantyById = async (req, res) => {
    try {
        const warranty = await Warranty.findById(req.params.id)
            .populate('invoiceRef', 'invoiceNumber manualClientDetails')
            .populate('clientRef', 'firstName lastName clientId')
            .populate('projectRef', 'projectId name')
            .populate('productRef', 'name productId warrantyPeriod');
        if (!warranty) return res.status(404).json({ success: false, message: 'Warranty not found' });
        res.status(200).json({ success: true, data: warranty });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.updateWarrantyStatus = async (req, res) => {
    try {
        const { status } = req.body;
        if (!['active', 'expired'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Invalid status' });
        }

        const warranty = await Warranty.findByIdAndUpdate(
            req.params.id,
            { status },
            { new: true }
        ).populate('invoiceRef', 'invoiceNumber manualClientDetails')
            .populate('clientRef', 'firstName lastName clientId')
            .populate('projectRef', 'projectId name')
            .populate('productRef', 'name productId warrantyPeriod');

        if (!warranty) return res.status(404).json({ success: false, message: 'Warranty not found' });
        res.status(200).json({ success: true, data: warranty });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};
