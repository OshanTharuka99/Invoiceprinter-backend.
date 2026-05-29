const DeliveryNote = require('../models/DeliveryNote');
const BusinessDetails = require('../models/BusinessDetails');

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
            createdBy: req.user._id
        });

        res.status(201).json({ success: true, data: deliveryNote });
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
            .populate('createdBy', 'firstName lastName');
        if (!deliveryNote) return res.status(404).json({ success: false, message: 'Delivery note not found' });
        res.status(200).json({ success: true, data: deliveryNote });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.updateDeliveryNote = async (req, res) => {
    try {
        const deliveryNote = await DeliveryNote.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
        if (!deliveryNote) return res.status(404).json({ success: false, message: 'Delivery note not found' });
        res.status(200).json({ success: true, data: deliveryNote });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.deleteDeliveryNote = async (req, res) => {
    try {
        const deliveryNote = await DeliveryNote.findByIdAndDelete(req.params.id);
        if (!deliveryNote) return res.status(404).json({ success: false, message: 'Delivery note not found' });
        res.status(200).json({ success: true, message: 'Delivery note deleted.' });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};
