const Quotation = require('../models/Quotation');
const QuotationDeleteRequest = require('../models/QuotationDeleteRequest');
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

exports.createQuotation = async (req, res) => {
    try {
        // Find latest quotation to determine the next QN ID sequence
        const latest = await Quotation.findOne().sort({ createdAt: -1 });
        let sequence = 1;
        if (latest && latest.quotationId && latest.quotationId.startsWith('QN')) {
            const num = parseInt(latest.quotationId.substring(2), 10);
            if (!isNaN(num)) sequence = num + 1;
        }
        const quotationId = `QN${sequence.toString().padStart(5, '0')}`;
        let payload = { ...req.body };
        if (payload.clientRef === "") payload.clientRef = undefined;
        if (payload.projectId === "") payload.projectId = undefined;
        if (payload.items) {
            payload.items = payload.items.map(i => {
                if (i.productRef === "") i.productRef = undefined;
                return i;
            });
        }

        const quotation = await Quotation.create({
            ...payload,
            quotationId,
            createdBy: req.user._id
        });
        
        res.status(201).json({ success: true, data: quotation });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.getQuotations = async (req, res) => {
    try {
        // Shared access for both Admin and Users
        const quotations = await Quotation.find()
            .populate('clientRef')
            .populate('items.productRef')
            .populate('createdBy', 'firstName lastName')
            .sort({ createdAt: -1 });
        res.status(200).json({ success: true, data: quotations });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.updateQuotation = async (req, res) => {
    try {
        const quotation = await Quotation.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
        if (!quotation) return res.status(404).json({ success: false, message: 'Quotation not found' });
        res.status(200).json({ success: true, data: quotation });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

// DIRECT DELETION (Admin only)
exports.deleteQuotation = async (req, res) => {
    try {
        const quotation = await Quotation.findByIdAndDelete(req.params.id);
        if (!quotation) return res.status(404).json({ success: false, message: 'Quotation not found' });
        
        // Purge orphaned delete requests linking to this quotation
        await QuotationDeleteRequest.deleteMany({ quotation: req.params.id });

        res.status(200).json({ success: true, message: 'Quotation eliminated.' });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

// USER DELETION REQUEST
exports.requestDelete = async (req, res) => {
    try {
        const { reason } = req.body;
        if (!reason) return res.status(400).json({ success: false, message: 'Reason for deletion is required' });

        const quotation = await Quotation.findById(req.params.id);
        if (!quotation) return res.status(404).json({ success: false, message: 'Quotation not found' });

        const request = await QuotationDeleteRequest.create({
            quotation: req.params.id,
            requestedBy: req.user._id,
            reason
        });

        const admins = await User.find({ role: { $in: ['admin', 'root'] } });
        for (const admin of admins) {
            await createNotification(
                admin._id,
                'delete_request',
                'Deletion Request',
                `${req.user.firstName} ${req.user.lastName} requested deletion of quotation ${quotation.quotationId}. Reason: ${reason}`,
                request._id
            );
        }

        res.status(201).json({ success: true, message: 'Deletion request transmitted to Security.', data: request });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

// VIEW PENDING DELETION REQUESTS (Admin Only)
exports.getDeleteRequests = async (req, res) => {
    try {
        const requests = await QuotationDeleteRequest.find({ status: 'Pending' })
            .populate('requestedBy', 'firstName lastName')
            .populate('quotation');
        res.status(200).json({ success: true, data: requests });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.approveDeleteRequest = async (req, res) => {
    try {
        const request = await QuotationDeleteRequest.findById(req.params.requestId).populate('requestedBy');
        if (!request || request.status !== 'Pending') {
            return res.status(404).json({ success: false, message: 'Pending request not isolated' });
        }
        
        // Execute the deletion
        const quotation = await Quotation.findById(request.quotation);
        await Quotation.findByIdAndDelete(request.quotation);
        
        request.status = 'Approved';
        request.reviewedBy = req.user._id;
        request.reviewedAt = Date.now();
        await request.save();

        await createNotification(
            request.requestedBy._id,
            'approval',
            'Deletion Approved',
            `Your deletion request for quotation ${quotation?.quotationId || 'N/A'} has been approved by ${req.user.firstName} ${req.user.lastName}.`
        );

        res.status(200).json({ success: true, message: 'Quotation securely deleted per request.' });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.rejectDeleteRequest = async (req, res) => {
    try {
        const request = await QuotationDeleteRequest.findById(req.params.requestId).populate('requestedBy');
        if (!request || request.status !== 'Pending') {
            return res.status(404).json({ success: false, message: 'Request not isolated' });
        }
        
        const quotation = await Quotation.findById(request.quotation);
        
        request.status = 'Rejected';
        request.reviewedBy = req.user._id;
        request.reviewedAt = Date.now();
        await request.save();

        await createNotification(
            request.requestedBy._id,
            'rejection',
            'Deletion Rejected',
            `Your deletion request for quotation ${quotation?.quotationId || 'N/A'} has been rejected by ${req.user.firstName} ${req.user.lastName}.`
        );

        res.status(200).json({ success: true, message: 'Quotation deletion averted.' });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};
