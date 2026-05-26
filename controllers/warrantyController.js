const Warranty = require('../models/Warranty');
const StockEntry = require('../models/StockEntry');
const Product = require('../models/Product');
const AuditLog = require('../models/AuditLog');

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
            .populate('projectRef', 'projectId name location')
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
            .populate('projectRef', 'projectId name location')
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
            .populate('projectRef', 'projectId name location')
            .populate('productRef', 'name productId warrantyPeriod');

        if (!warranty) return res.status(404).json({ success: false, message: 'Warranty not found' });
        res.status(200).json({ success: true, data: warranty });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

// Void (delete) a warranty and restore its serial number back to the product catalog
exports.deleteWarranty = async (req, res) => {
    try {
        const warranty = await Warranty.findById(req.params.id)
            .populate('productRef', 'name productId');
        if (!warranty) return res.status(404).json({ success: false, message: 'Warranty not found' });

        const serial = warranty.serialNumber?.toUpperCase();
        const productId = warranty.productRef?._id;

        if (serial && productId) {
            // Find the most recent stock entry for this product and restore the serial
            let entry = await StockEntry.findOne({ product: productId }).sort({ createdAt: -1 });
            if (entry) {
                if (!entry.serialNumbers.map(s => s.toUpperCase()).includes(serial)) {
                    entry.serialNumbers.push(serial);
                    entry.quantity += 1;
                    await entry.save();
                }
            } else {
                // No stock entry exists — create one to hold the restored serial
                const product = await Product.findById(productId).select('productId name');
                await StockEntry.create({
                    product: productId,
                    batchRef: `${product?.productId || 'STOCK'}-VOID-${Date.now()}`,
                    quantity: 1,
                    serialNumbers: [serial],
                    hasSerialNumbers: true,
                    notes: `Restored from voided warranty`,
                    addedBy: req.user._id
                });
            }
            // Restore product-level quantity
            await Product.findByIdAndUpdate(productId, { $inc: { quantity: 1 } });
        }

        await AuditLog.create({
            action: 'WARRANTY_VOIDED',
            targetType: 'Warranty',
            targetId: warranty._id,
            targetName: serial || 'N/A',
            details: { serial, product: warranty.productRef?.name, invoiceRef: warranty.invoiceRef },
            reason: 'Manual void by admin',
            performedBy: req.user._id
        });

        await Warranty.findByIdAndDelete(req.params.id);
        res.status(200).json({ success: true, message: 'Warranty voided and serial restored to catalog' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Update the serial number on a warranty — restore old serial to catalog, deduct new serial from catalog
exports.updateWarrantySerial = async (req, res) => {
    try {
        const { newSerial } = req.body;
        if (!newSerial || !newSerial.trim()) {
            return res.status(400).json({ success: false, message: 'New serial number is required' });
        }

        const warranty = await Warranty.findById(req.params.id).populate('productRef', 'name productId');
        if (!warranty) return res.status(404).json({ success: false, message: 'Warranty not found' });

        const oldSerial = warranty.serialNumber?.toUpperCase();
        const newSerialUpper = newSerial.toUpperCase().trim();
        const productId = warranty.productRef?._id;

        if (oldSerial === newSerialUpper) {
            return res.status(400).json({ success: false, message: 'New serial is the same as the current serial' });
        }

        if (productId) {
            const entries = await StockEntry.find({ product: productId });

            // Check new serial exists in stock
            const allSerials = new Set(entries.flatMap(e => e.serialNumbers.map(s => s.toUpperCase())));
            if (!allSerials.has(newSerialUpper)) {
                return res.status(400).json({ success: false, message: `Serial ${newSerialUpper} is not available in stock` });
            }

            // Remove new serial from stock
            for (const entry of entries) {
                const idx = entry.serialNumbers.findIndex(s => s.toUpperCase() === newSerialUpper);
                if (idx !== -1) {
                    entry.serialNumbers.splice(idx, 1);
                    entry.quantity = Math.max(0, entry.quantity - 1);
                    await entry.save();
                    break;
                }
            }

            // Restore old serial to the most recent stock entry
            if (oldSerial) {
                let latestEntry = await StockEntry.findOne({ product: productId }).sort({ createdAt: -1 });
                if (latestEntry) {
                    if (!latestEntry.serialNumbers.map(s => s.toUpperCase()).includes(oldSerial)) {
                        latestEntry.serialNumbers.push(oldSerial);
                        latestEntry.quantity += 1;
                        await latestEntry.save();
                    }
                } else {
                    const product = await Product.findById(productId).select('productId name');
                    await StockEntry.create({
                        product: productId,
                        batchRef: `${product?.productId || 'STOCK'}-SN-SWAP-${Date.now()}`,
                        quantity: 1,
                        serialNumbers: [oldSerial],
                        hasSerialNumbers: true,
                        notes: `Restored from serial swap on warranty`,
                        addedBy: req.user._id
                    });
                }
                // Product qty net change is 0 (remove new, restore old)
            }
        }

        const oldSerialSaved = warranty.serialNumber;
        warranty.serialNumber = newSerialUpper;
        await warranty.save();

        await AuditLog.create({
            action: 'WARRANTY_SERIAL_EDIT',
            targetType: 'Warranty',
            targetId: warranty._id,
            targetName: oldSerialSaved,
            details: { oldSerial: oldSerialSaved, newSerial: newSerialUpper, product: warranty.productRef?.name },
            reason: req.body.reason || 'Manual correction by admin',
            performedBy: req.user._id
        });

        const updated = await Warranty.findById(warranty._id)
            .populate('invoiceRef', 'invoiceNumber manualClientDetails')
            .populate('clientRef', 'firstName lastName clientId')
            .populate('projectRef', 'projectId name location')
            .populate('productRef', 'name productId warrantyPeriod');

        res.status(200).json({ success: true, data: updated, message: 'Serial number updated and stock adjusted' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

