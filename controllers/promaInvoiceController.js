const PromaInvoice = require('../models/PromaInvoice');
const BusinessDetails = require('../models/BusinessDetails');

const nextPromaInvoiceNumber = async () => {
    const bizDetails = await BusinessDetails.findOne();
    const prefix = bizDetails?.promaInvoicePrefix || 'PI';
    const digits = bizDetails?.promaInvoiceDigits || 5;

    const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const latest = await PromaInvoice.findOne({
        promaInvoiceNumber: new RegExp('^' + escapedPrefix)
    }).sort({ createdAt: -1 });

    let sequence = 1;
    if (latest && latest.promaInvoiceNumber) {
        const suffixStr = latest.promaInvoiceNumber.substring(prefix.length);
        const num = parseInt(suffixStr, 10);
        if (!isNaN(num)) sequence = num + 1;
    }
    return `${prefix}${sequence.toString().padStart(digits, '0')}`;
};

const sanitizePayload = (body) => {
    const payload = { ...body };
    if (payload.clientRef === '') payload.clientRef = undefined;
    if (payload.projectId === '') payload.projectId = undefined;
    if (payload.items) {
        payload.items = payload.items.map((item) => {
            const cleaned = { ...item };
            if (cleaned.productRef === '') cleaned.productRef = undefined;
            delete cleaned.serialNumbers;
            delete cleaned.unitCost;
            return cleaned;
        });
    }
    delete payload.promaInvoiceNumber;
    delete payload.statusHistory;
    delete payload.cancelledBy;
    delete payload.cancellationNote;
    delete payload.originalPromaInvoiceRef;
    delete payload.createdBy;
    return payload;
};

const populateFull = (query) => query
    .populate('clientRef')
    .populate('projectId', 'projectId name location')
    .populate('createdBy', 'firstName lastName')
    .populate('statusHistory.editedBy', 'firstName lastName')
    .populate('cancelledBy', 'firstName lastName')
    .populate('items.productRef', 'name productId');

exports.getPromaInvoices = async (req, res) => {
    try {
        const promaInvoices = await PromaInvoice.find()
            .populate('clientRef', 'firstName lastName organization clientId telephoneNumber emailAddress address clientType')
            .populate('projectId', 'projectId name location')
            .populate('createdBy', 'firstName lastName')
            .populate('items.productRef', 'name productId')
            .sort({ createdAt: -1 })
            .lean();
        res.status(200).json({ success: true, data: promaInvoices });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getPromaInvoiceById = async (req, res) => {
    try {
        const promaInvoice = await populateFull(PromaInvoice.findById(req.params.id));
        if (!promaInvoice) {
            return res.status(404).json({ success: false, message: 'Proma invoice not found' });
        }
        res.status(200).json({ success: true, data: promaInvoice });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.createPromaInvoice = async (req, res) => {
    try {
        const payload = sanitizePayload(req.body);
        const {
            creationMethod,
            paymentMethod,
            status,
            invoiceDate,
            items
        } = payload;

        if (!items || items.length === 0) {
            return res.status(400).json({ success: false, message: 'At least one item is required' });
        }
        if (!paymentMethod) {
            return res.status(400).json({ success: false, message: 'Payment method is required' });
        }
        if (!creationMethod) {
            return res.status(400).json({ success: false, message: 'Creation method is required' });
        }

        const promaInvoiceNumber = await nextPromaInvoiceNumber();
        const initialStatus = paymentMethod === 'cash' ? 'Paid' : (status || 'Unpaid');

        const promaInvoice = await PromaInvoice.create({
            ...payload,
            promaInvoiceNumber,
            invoiceDate: invoiceDate || Date.now(),
            status: initialStatus,
            statusHistory: [{
                status: initialStatus,
                note: 'Initial proma invoice creation',
                editedBy: req.user._id,
                editedAt: Date.now()
            }],
            createdBy: req.user._id
        });

        const populated = await populateFull(PromaInvoice.findById(promaInvoice._id));
        res.status(201).json({ success: true, data: populated });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.updatePromaInvoiceStatus = async (req, res) => {
    try {
        const { status, note } = req.body;
        if (!status) {
            return res.status(400).json({ success: false, message: 'Status is required' });
        }

        const promaInvoice = await PromaInvoice.findById(req.params.id);
        if (!promaInvoice) {
            return res.status(404).json({ success: false, message: 'Proma invoice not found' });
        }
        if (promaInvoice.status === 'Cancelled') {
            return res.status(400).json({ success: false, message: 'Cannot update a cancelled proma invoice' });
        }
        if (promaInvoice.paymentMethod === 'cash') {
            return res.status(400).json({ success: false, message: 'Cash proma invoices are permanently marked as Paid' });
        }

        promaInvoice.status = status;
        promaInvoice.statusHistory.push({
            status,
            note: note || '',
            editedBy: req.user._id,
            editedAt: Date.now()
        });
        await promaInvoice.save();

        const populated = await populateFull(PromaInvoice.findById(promaInvoice._id));
        res.status(200).json({ success: true, data: populated });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.cancelPromaInvoice = async (req, res) => {
    try {
        const note = (req.body?.note || '').trim();
        if (!note) {
            return res.status(400).json({ success: false, message: 'Cancellation note is required' });
        }

        const promaInvoice = await PromaInvoice.findById(req.params.id);
        if (!promaInvoice) {
            return res.status(404).json({ success: false, message: 'Proma invoice not found' });
        }
        if (promaInvoice.status === 'Cancelled') {
            return res.status(400).json({ success: false, message: 'Proma invoice is already cancelled' });
        }

        promaInvoice.status = 'Cancelled';
        promaInvoice.cancelledBy = req.user._id;
        promaInvoice.cancellationNote = note;
        promaInvoice.statusHistory.push({
            status: 'Cancelled',
            note,
            editedBy: req.user._id,
            editedAt: Date.now()
        });
        await promaInvoice.save();

        const populated = await populateFull(PromaInvoice.findById(promaInvoice._id));
        res.status(200).json({ success: true, message: 'Proma invoice cancelled', data: populated });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.deletePromaInvoice = async (req, res) => {
    try {
        const promaInvoice = await PromaInvoice.findByIdAndDelete(req.params.id);
        if (!promaInvoice) {
            return res.status(404).json({ success: false, message: 'Proma invoice not found' });
        }
        res.status(200).json({ success: true, message: 'Proma invoice permanently deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
