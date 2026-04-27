const Invoice = require('../models/Invoice');
const InvoiceDeleteRequest = require('../models/InvoiceDeleteRequest');
const Notification = require('../models/Notification');
const User = require('../models/User');

const createNotification = async (recipientId, type, title, message, relatedId = null) => {
    try {
        await Notification.create({
            recipient: recipientId,
            type,
            title,
            message,
            relatedId
        });
    } catch (err) {
        console.error('Notification error:', err);
    }
};

exports.createInvoice = async (req, res) => {
    try {
        // Find latest invoice to determine the next INV ID sequence
        const latest = await Invoice.findOne().sort({ createdAt: -1 });
        let sequence = 1;
        if (latest && latest.invoiceId && latest.invoiceId.startsWith('INV')) {
            const num = parseInt(latest.invoiceId.substring(3), 10);
            if (!isNaN(num)) sequence = num + 1;
        }
        const invoiceId = `INV${sequence.toString().padStart(5, '0')}`;
        
        let payload = { ...req.body };
        if (payload.clientRef === "") payload.clientRef = undefined;
        if (payload.projectId === "") payload.projectId = undefined;
        if (payload.items) {
            payload.items = payload.items.map(i => {
                if (i.productRef === "") i.productRef = undefined;
                return i;
            });
        }

        const invoice = await Invoice.create({
            ...payload,
            invoiceId,
            createdBy: req.user._id
        });
        
        res.status(201).json({ success: true, data: invoice });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.getInvoices = async (req, res) => {
    try {
        const invoices = await Invoice.find()
            .populate('clientRef')
            .populate('items.productRef')
            .populate('createdBy', 'firstName lastName')
            .sort({ createdAt: -1 });
        res.status(200).json({ success: true, data: invoices });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.getInvoiceById = async (req, res) => {
    try {
        const invoice = await Invoice.findById(req.params.id)
            .populate('clientRef')
            .populate('items.productRef')
            .populate('createdBy', 'firstName lastName');
        if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });
        res.status(200).json({ success: true, data: invoice });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.updateInvoice = async (req, res) => {
    try {
        const invoice = await Invoice.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
        if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });
        res.status(200).json({ success: true, data: invoice });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.deleteInvoice = async (req, res) => {
    try {
        const invoice = await Invoice.findByIdAndDelete(req.params.id);
        if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });
        
        // Purge orphaned delete requests
        await InvoiceDeleteRequest.deleteMany({ invoice: req.params.id });

        res.status(200).json({ success: true, message: 'Invoice eliminated.' });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.requestDelete = async (req, res) => {
    try {
        const { reason } = req.body;
        if (!reason) return res.status(400).json({ success: false, message: 'Reason for deletion is required' });

        const invoice = await Invoice.findById(req.params.id);
        if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });

        const request = await InvoiceDeleteRequest.create({
            invoice: req.params.id,
            requestedBy: req.user._id,
            reason
        });

        const admins = await User.find({ role: { $in: ['admin', 'root'] } });
        for (const admin of admins) {
            await createNotification(
                admin._id,
                'delete_request',
                'Invoice Deletion Request',
                `${req.user.firstName} ${req.user.lastName} requested deletion of invoice ${invoice.invoiceId}. Reason: ${reason}`,
                request._id
            );
        }

        res.status(201).json({ success: true, message: 'Deletion request transmitted to Security.', data: request });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.getDeleteRequests = async (req, res) => {
    try {
        const requests = await InvoiceDeleteRequest.find({ status: 'Pending' })
            .populate('requestedBy', 'firstName lastName')
            .populate('invoice');
        res.status(200).json({ success: true, data: requests });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.approveDeleteRequest = async (req, res) => {
    try {
        const request = await InvoiceDeleteRequest.findById(req.params.requestId).populate('requestedBy');
        if (!request || request.status !== 'Pending') {
            return res.status(404).json({ success: false, message: 'Pending request not isolated' });
        }
        
        const invoice = await Invoice.findById(request.invoice);
        await Invoice.findByIdAndDelete(request.invoice);
        
        request.status = 'Approved';
        request.reviewedBy = req.user._id;
        request.reviewedAt = Date.now();
        await request.save();

        await createNotification(
            request.requestedBy._id,
            'approval',
            'Invoice Deletion Approved',
            `Your deletion request for invoice ${invoice?.invoiceId || 'N/A'} has been approved by ${req.user.firstName} ${req.user.lastName}.`
        );

        res.status(200).json({ success: true, message: 'Invoice securely deleted per request.' });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.rejectDeleteRequest = async (req, res) => {
    try {
        const request = await InvoiceDeleteRequest.findById(req.params.requestId).populate('requestedBy');
        if (!request || request.status !== 'Pending') {
            return res.status(404).json({ success: false, message: 'Request not isolated' });
        }
        
        const invoice = await Invoice.findById(request.invoice);
        
        request.status = 'Rejected';
        request.reviewedBy = req.user._id;
        request.reviewedAt = Date.now();
        await request.save();

        await createNotification(
            request.requestedBy._id,
            'rejection',
            'Invoice Deletion Rejected',
            `Your deletion request for invoice ${invoice?.invoiceId || 'N/A'} has been rejected by ${req.user.firstName} ${req.user.lastName}.`
        );

        res.status(200).json({ success: true, message: 'Invoice deletion averted.' });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};
