const Quotation = require('../models/Quotation');
const QuotationDeleteRequest = require('../models/QuotationDeleteRequest');
const Notification = require('../models/Notification');
const User = require('../models/User');
const BusinessDetails = require('../models/BusinessDetails');
const Invoice = require('../models/Invoice');

const NON_LOADABLE_QUOTATION_STATUSES = ['Cancelled', 'Rejected'];
const EDIT_DELETE_WINDOW_DAYS = 30;

const isWithinEditWindow = (createdAt) => {
    const diffDays = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24);
    return diffDays <= EDIT_DELETE_WINDOW_DAYS;
};

const isQuotationLoadable = (quotation) => quotation && !NON_LOADABLE_QUOTATION_STATUSES.includes(quotation.status);

const nextQuotationId = async () => {
    const bizDetails = await BusinessDetails.findOne();
    const prefix = bizDetails?.quotationPrefix || 'QN';
    const digits = bizDetails?.quotationDigits || 5;
    const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const latest = await Quotation.findOne({
        quotationId: new RegExp('^' + escapedPrefix)
    }).sort({ createdAt: -1 });

    let sequence = 1;
    if (latest && latest.quotationId) {
        const suffixStr = latest.quotationId.substring(prefix.length);
        const num = parseInt(suffixStr, 10);
        if (!isNaN(num)) sequence = num + 1;
    }
    return `${prefix}${sequence.toString().padStart(digits, '0')}`;
};

const sanitizeQuotationPayload = (body) => {
    const payload = { ...body };
    if (payload.clientRef === '') payload.clientRef = undefined;
    if (payload.projectId === '') payload.projectId = undefined;
    if (payload.items) {
        payload.items = payload.items.map((i) => {
            if (i.productRef === '') i.productRef = undefined;
            return i;
        });
    }
    delete payload.editNote;
    delete payload.statusHistory;
    delete payload.cancelledBy;
    delete payload.cancellationNote;
    delete payload.quotationId;
    delete payload.originalQuotationRef;
    return payload;
};

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
        const quotationId = await nextQuotationId();
        const payload = sanitizeQuotationPayload(req.body);

        const quotation = await Quotation.create({
            ...payload,
            quotationId,
            statusHistory: [{
                status: payload.status || 'Draft',
                note: 'Quotation created',
                editedBy: req.user._id,
                editedAt: new Date(),
            }],
            createdBy: req.user._id
        });
        
        res.status(201).json({ success: true, data: quotation });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.getQuotations = async (req, res) => {
    try {
        const filter = {};
        if (req.query.forLoad === 'true') {
            filter.status = { $nin: NON_LOADABLE_QUOTATION_STATUSES };
        }

        const quotations = await Quotation.find(filter)
            .populate('clientRef')
            .populate('items.productRef')
            .populate('projectId', 'name projectId')
            .populate('createdBy', 'firstName lastName')
            .populate('statusHistory.editedBy', 'firstName lastName')
            .populate('cancelledBy', 'firstName lastName')
            .sort({ createdAt: -1 });
        res.status(200).json({ success: true, data: quotations });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.lookupQuotation = async (req, res) => {
    try {
        const quotationId = (req.query.quotationId || '').trim().toUpperCase();
        if (!quotationId) {
            return res.status(400).json({ success: false, message: 'Quotation number is required' });
        }

        const quotation = await Quotation.findOne({ quotationId })
            .populate('clientRef')
            .populate('items.productRef')
            .populate('projectId', 'name projectId');

        if (!quotation) {
            return res.status(404).json({ success: false, message: 'Quotation not found' });
        }

        if (!isQuotationLoadable(quotation)) {
            return res.status(403).json({
                success: false,
                message: 'Cannot load a cancelled or rejected quotation.',
            });
        }

        res.status(200).json({ success: true, data: quotation });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.getQuotationForInvoice = async (req, res) => {
    try {
        const quotation = await Quotation.findById(req.params.id)
            .populate('clientRef')
            .populate('items.productRef')
            .populate('projectId');

        if (!quotation) {
            return res.status(404).json({ success: false, message: 'Quotation not found' });
        }

        if (!isQuotationLoadable(quotation)) {
            return res.status(403).json({
                success: false,
                message: 'Cannot load a cancelled or rejected quotation.',
            });
        }

        const existingInvoice = await Invoice.findOne({
            quotationRef: quotation._id,
            status: { $ne: 'Cancelled' },
        }).select('invoiceNumber');

        if (existingInvoice) {
            return res.status(400).json({
                success: false,
                message: `This quotation is already linked to invoice ${existingInvoice.invoiceNumber}.`,
            });
        }

        const data = {
            quotationId: quotation._id,
            quotationNumber: quotation.quotationId,
            clientRef: quotation.clientRef?._id || null,
            manualClientDetails: quotation.manualClientDetails,
            projectId: quotation.projectId?._id || null,
            deliveryAddress: quotation.deliveryAddress || '',
            customerPO: '',
            subTotal: quotation.subTotal,
            appliedDiscounts: quotation.appliedDiscounts || [],
            discountTotal: quotation.discountTotal || 0,
            hasTax: quotation.hasTax || false,
            appliedTaxes: quotation.appliedTaxes || [],
            taxTotal: quotation.taxTotal || 0,
            finalTotal: quotation.finalTotal,
            currency: quotation.currency || 'primary',
            items: (quotation.items || []).map((item) => ({
                productRef: item.productRef?._id || null,
                manualName: item.manualName || item.productRef?.name || '',
                quantity: item.quantity,
                unitPrice: item.unitPrice || 0,
                lineTotal: item.lineTotal || 0,
                serialNumbers: [],
            })),
        };

        res.status(200).json({ success: true, data });
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

// Root-level superseding edit — cancel original, create new number, log reason
exports.editQuotation = async (req, res) => {
    try {
        const original = await Quotation.findById(req.params.id);
        if (!original) return res.status(404).json({ success: false, message: 'Quotation not found' });
        if (original.status === 'Cancelled') {
            return res.status(400).json({ success: false, message: 'Cannot edit a cancelled quotation' });
        }
        if (!isWithinEditWindow(original.createdAt)) {
            return res.status(403).json({ success: false, message: 'Quotation can only be edited within 30 days of creation' });
        }

        const editNote = (req.body.editNote || '').trim();
        if (!editNote) {
            return res.status(400).json({ success: false, message: 'Edit reason is required' });
        }

        const payload = sanitizeQuotationPayload(req.body);
        if (!payload.items || payload.items.length === 0) {
            return res.status(400).json({ success: false, message: 'At least one item is required' });
        }

        original.status = 'Cancelled';
        original.cancelledBy = req.user._id;
        original.cancellationNote = editNote;
        original.statusHistory = [
            ...(original.statusHistory || []),
            {
                status: 'Cancelled',
                note: editNote || 'Quotation superseded by edit',
                editedBy: req.user._id,
                editedAt: new Date(),
            },
        ];
        await original.save();

        const quotationId = await nextQuotationId();
        const newHistory = [
            ...(original.statusHistory || []),
            {
                status: payload.status || 'Draft',
                note: `Created as edit of ${original.quotationId}`,
                editedBy: req.user._id,
                editedAt: new Date(),
            },
        ];

        const created = await Quotation.create({
            ...payload,
            quotationId,
            statusHistory: newHistory,
            originalQuotationRef: original._id,
            createdBy: req.user._id,
        });

        const populated = await Quotation.findById(created._id)
            .populate('clientRef')
            .populate('items.productRef')
            .populate('projectId', 'name projectId')
            .populate('createdBy', 'firstName lastName')
            .populate('statusHistory.editedBy', 'firstName lastName');

        res.status(200).json({
            success: true,
            message: `Quotation edited. Original ${original.quotationId} cancelled.`,
            data: populated,
        });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

// DIRECT DELETION (Admin only) — soft cancel with required reason log
exports.deleteQuotation = async (req, res) => {
    try {
        const quotation = await Quotation.findById(req.params.id);
        if (!quotation) return res.status(404).json({ success: false, message: 'Quotation not found' });

        if (quotation.status === 'Cancelled') {
            return res.status(400).json({ success: false, message: 'Quotation is already cancelled' });
        }

        if (!isWithinEditWindow(quotation.createdAt)) {
            return res.status(403).json({ success: false, message: 'Quotation can only be deleted within 30 days of creation' });
        }

        const trimmedReason = (req.body?.reason || '').trim();
        if (!trimmedReason) {
            return res.status(400).json({ success: false, message: 'Deletion reason is required' });
        }

        quotation.status = 'Cancelled';
        quotation.cancelledBy = req.user._id;
        quotation.cancellationNote = trimmedReason;
        quotation.statusHistory = [
            ...(quotation.statusHistory || []),
            {
                status: 'Cancelled',
                note: `Quotation deleted. Reason: ${trimmedReason}`,
                editedBy: req.user._id,
                editedAt: new Date(),
            },
        ];
        await quotation.save();

        await QuotationDeleteRequest.updateMany(
            { quotation: req.params.id, status: 'Pending' },
            { status: 'Approved', reviewedBy: req.user._id, reviewedAt: Date.now() }
        );

        res.status(200).json({ success: true, message: 'Quotation cancelled.', data: quotation });
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
        
        // Execute soft cancellation
        const quotation = await Quotation.findById(request.quotation);
        if (!quotation) {
            return res.status(404).json({ success: false, message: 'Quotation not found' });
        }

        quotation.status = 'Cancelled';
        quotation.cancelledBy = req.user._id;
        quotation.cancellationNote = request.reason || 'Cancelled per approved deletion request';
        quotation.statusHistory = [
            ...(quotation.statusHistory || []),
            {
                status: 'Cancelled',
                note: `Quotation deleted via approved request. Reason: ${request.reason || ''}`,
                editedBy: req.user._id,
                editedAt: new Date(),
            },
        ];
        await quotation.save();

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

        res.status(200).json({ success: true, message: 'Quotation cancelled per request.' });
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
