const Supplier = require('../models/Supplier');

exports.createSupplier = async (req, res) => {
    try {
        const latest = await Supplier.findOne().sort({ createdAt: -1 });
        let sequence = 1;
        if (latest && latest.supplierId && latest.supplierId.startsWith('SUP_')) {
            const num = parseInt(latest.supplierId.split('_')[1], 10);
            if (!isNaN(num)) sequence = num + 1;
        }
        const supplierId = `SUP_${sequence.toString().padStart(4, '0')}`;

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
