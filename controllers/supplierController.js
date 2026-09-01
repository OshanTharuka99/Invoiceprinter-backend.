const Supplier = require('../models/Supplier');
const { nextObjectId } = require('../utils/objectId');

exports.createSupplier = async (req, res) => {
    try {
        const supplierId = await nextObjectId(Supplier, 'Supplier', 'supplierId');

        const supplier = await Supplier.create({ ...req.body, supplierId });
        res.status(201).json({ success: true, data: supplier });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.getSuppliers = async (req, res) => {
    try {
        const suppliers = await Supplier.find().sort({ createdAt: -1 });
        res.status(200).json({ success: true, data: suppliers });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.updateSupplier = async (req, res) => {
    try {
        const supplier = await Supplier.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
        if (!supplier) return res.status(404).json({ success: false, message: 'Supplier not found' });
        res.status(200).json({ success: true, data: supplier });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.deleteSupplier = async (req, res) => {
     try {
        const supplier = await Supplier.findByIdAndDelete(req.params.id);
        if (!supplier) return res.status(404).json({ success: false, message: 'Supplier not found' });
        res.status(200).json({ success: true, message: 'Supplier deleted' });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};
