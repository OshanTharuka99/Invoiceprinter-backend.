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

// Get all invoices
exports.getInvoices = async (req, res) => {
    try {
        const invoices = await Invoice.find().sort({ createdAt: -1 });
        res.status(200).json(invoices);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Create new invoice
exports.createInvoice = async (req, res) => {
    const invoice = new Invoice(req.body);
    try {
        const newInvoice = await invoice.save();
        res.status(201).json(newInvoice);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

// Get single invoice
exports.getInvoiceById = async (req, res) => {
    try {
        const invoice = await Invoice.findById(req.params.id);
        if (!invoice) return res.status(404).json({ message: 'Invoice not found' });
        res.status(200).json(invoice);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Update invoice
exports.updateInvoice = async (req, res) => {
    try {
        const updatedInvoice = await Invoice.findByIdAndUpdate(req.params.id, req.body, { new: true });
        res.status(200).json(updatedInvoice);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

// Delete invoice
exports.deleteInvoice = async (req, res) => {
    try {
        const invoice = await Invoice.findByIdAndDelete(req.params.id);
        if (!invoice) return res.status(404).json({ message: 'Invoice not found' });
        
        // Purge orphaned delete requests linking to this invoice
        await InvoiceDeleteRequest.deleteMany({ invoice: req.params.id });

        res.status(200).json({ message: 'Invoice deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// USER DELETION REQUEST
exports.requestDelete = async (req, res) => {
    try {
        const { reason } = req.body;
        if (!reason) return res.status(400).json({ message: 'Reason for deletion is required' });

        const invoice = await Invoice.findById(req.params.id);
        if (!invoice) return res.status(404).json({ message: 'Invoice not found' });

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
                'Deletion Request',
                `${req.user.firstName} ${req.user.lastName} requested deletion of invoice ${invoice._id}. Reason: ${reason}`,
                request._id
            );
        }

        res.status(201).json({ message: 'Deletion request transmitted to Security.', data: request });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

// VIEW PENDING DELETION REQUESTS (Admin Only)
exports.getDeleteRequests = async (req, res) => {
    try {
        const requests = await InvoiceDeleteRequest.find({ status: 'Pending' })
            .populate('requestedBy', 'firstName lastName')
            .populate('invoice');
        res.status(200).json({ data: requests });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

exports.approveDeleteRequest = async (req, res) => {
    try {
        const request = await InvoiceDeleteRequest.findById(req.params.requestId).populate('requestedBy');
        if (!request || request.status !== 'Pending') {
            return res.status(404).json({ message: 'Pending request not isolated' });
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
            'Deletion Approved',
            `Your deletion request for invoice ${invoice?._id || 'N/A'} has been approved by ${req.user.firstName} ${req.user.lastName}.`
        );

        res.status(200).json({ message: 'Invoice securely deleted per request.' });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

exports.rejectDeleteRequest = async (req, res) => {
    try {
        const request = await InvoiceDeleteRequest.findById(req.params.requestId).populate('requestedBy');
        if (!request || request.status !== 'Pending') {
            return res.status(404).json({ message: 'Request not isolated' });
        }
        
        const invoice = await Invoice.findById(request.invoice);
        
        request.status = 'Rejected';
        request.reviewedBy = req.user._id;
        request.reviewedAt = Date.now();
        await request.save();

        await createNotification(
            request.requestedBy._id,
            'rejection',
            'Deletion Rejected',
            `Your deletion request for invoice ${invoice?._id || 'N/A'} has been rejected by ${req.user.firstName} ${req.user.lastName}.`
        );

        res.status(200).json({ message: 'Invoice deletion averted.' });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};
