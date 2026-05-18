const Invoice = require('../models/Invoice');
const InvoiceDeleteRequest = require('../models/InvoiceDeleteRequest');
const Notification = require('../models/Notification');
const User = require('../models/User');
const Product = require('../models/Product');
const StockEntry = require('../models/StockEntry');
const Project = require('../models/Project');
const Warranty = require('../models/Warranty');

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

const calculateWarrantyExpiry = (startDate, warrantyPeriod) => {
    if (!warrantyPeriod || warrantyPeriod.trim() === '') {
        return null;
    }

    const parts = warrantyPeriod.trim().split(/\s+/);
    let duration = 0;
    let unit = 'months';

    for (const part of parts) {
        const num = parseInt(part, 10);
        if (!isNaN(num)) {
            duration = num;
        } else {
            const lower = part.toLowerCase();
            if (lower.startsWith('year') || lower.startsWith('yr')) unit = 'years';
            else if (lower.startsWith('month') || lower.startsWith('mo')) unit = 'months';
            else if (lower.startsWith('week') || lower.startsWith('wk')) unit = 'weeks';
            else if (lower.startsWith('day') || lower.startsWith('d')) unit = 'days';
        }
    }

    if (duration === 0) return null;

    const expiry = new Date(startDate);
    switch (unit) {
        case 'years': expiry.setFullYear(expiry.getFullYear() + duration); break;
        case 'months': expiry.setMonth(expiry.getMonth() + duration); break;
        case 'weeks': expiry.setDate(expiry.getDate() + (duration * 7)); break;
        case 'days': expiry.setDate(expiry.getDate() + duration); break;
    }
    return expiry;
};

exports.getInvoices = async (req, res) => {
    try {
        const invoices = await Invoice.find()
            .populate('clientRef')
            .populate('projectId')
            .populate('createdBy', 'firstName lastName')
            .populate('items.productRef', 'name productId warrantyPeriod')
            .sort({ createdAt: -1 });
        res.status(200).json({ success: true, data: invoices });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.createInvoice = async (req, res) => {
    try {
        const {
            creationMethod,
            clientRef,
            manualClientDetails,
            projectId,
            paymentMethod,
            creditPeriod,
            deliveryAddress,
            items,
            subTotal,
            appliedDiscounts,
            discountTotal,
            hasTax,
            appliedTaxes,
            taxTotal,
            finalTotal,
            currency,
            status,
            invoiceDate
        } = req.body;

        if (!items || items.length === 0) {
            return res.status(400).json({ success: false, message: 'At least one item is required' });
        }

        const latestInvoice = await Invoice.findOne().sort({ createdAt: -1 });
        let sequence = 1;
        if (latestInvoice && latestInvoice.invoiceNumber) {
            const match = latestInvoice.invoiceNumber.match(/INV(\d+)/);
            if (match) {
                sequence = parseInt(match[1], 10) + 1;
            }
        }
        const invoiceNumber = `INV${sequence.toString().padStart(5, '0')}`;

        const invoiceData = {
            invoiceNumber,
            creationMethod,
            clientRef: clientRef || undefined,
            manualClientDetails: manualClientDetails || {},
            projectId: projectId || undefined,
            paymentMethod,
            creditPeriod: creditPeriod || { duration: 0, unit: 'days' },
            deliveryAddress: deliveryAddress || '',
            items,
            subTotal,
            appliedDiscounts: appliedDiscounts || [],
            discountTotal: discountTotal || 0,
            hasTax: hasTax || false,
            appliedTaxes: appliedTaxes || [],
            taxTotal: taxTotal || 0,
            finalTotal,
            currency: currency || 'primary',
            status: status || 'Unpaid',
            invoiceDate: invoiceDate || Date.now(),
            createdBy: req.user._id
        };

        const invoice = await Invoice.create(invoiceData);

        for (const item of items) {
            if (item.productRef && creationMethod === 'automatic') {
                let remainingQty = item.quantity;

                const stockEntries = await StockEntry.find({
                    product: item.productRef,
                    quantity: { $gt: 0 }
                }).sort({ createdAt: 1 });

                for (const entry of stockEntries) {
                    if (remainingQty <= 0) break;

                    const reduceQty = Math.min(remainingQty, entry.quantity);
                    entry.quantity -= reduceQty;
                    remainingQty -= reduceQty;

                    if (item.serialNumbers && item.serialNumbers.length > 0) {
                        const serialsToRemove = item.serialNumbers.filter(sn =>
                            entry.serialNumbers.includes(sn.toUpperCase())
                        );
                        entry.serialNumbers = entry.serialNumbers.filter(
                            sn => !serialsToRemove.includes(sn.toUpperCase())
                        );
                    }

                    await entry.save();
                }

                await Product.findByIdAndUpdate(item.productRef, {
                    $inc: { quantity: -item.quantity }
                });
            }
        }

        if (projectId) {
            await Project.findByIdAndUpdate(projectId, {
                $inc: { value: finalTotal }
            });
        }

        const warrantyRecords = [];
        const startDate = invoiceDate ? new Date(invoiceDate) : new Date();

        for (const item of items) {
            if (item.serialNumbers && item.serialNumbers.length > 0 && item.productRef) {
                const product = await Product.findById(item.productRef);
                const warrantyPeriod = product?.warrantyPeriod || '';
                const expiryDate = calculateWarrantyExpiry(startDate, warrantyPeriod);

                for (const serial of item.serialNumbers) {
                    try {
                        const warranty = await Warranty.create({
                            invoiceRef: invoice._id,
                            clientRef: clientRef || null,
                            projectRef: projectId || null,
                            productRef: item.productRef,
                            serialNumber: serial.toUpperCase(),
                            warrantyPeriod,
                            startDate,
                            expiryDate
                        });
                        warrantyRecords.push(warranty);
                    } catch (err) {
                        console.error(`Warranty creation failed for serial ${serial}:`, err.message);
                    }
                }
            }
        }

        const populatedInvoice = await Invoice.findById(invoice._id)
            .populate('clientRef')
            .populate('projectId')
            .populate('createdBy', 'firstName lastName')
            .populate('items.productRef', 'name productId warrantyPeriod');

        res.status(201).json({
            success: true,
            data: populatedInvoice,
            warrantiesCreated: warrantyRecords.length
        });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.getInvoiceById = async (req, res) => {
    try {
        const invoice = await Invoice.findById(req.params.id)
            .populate('clientRef')
            .populate('projectId')
            .populate('createdBy', 'firstName lastName')
            .populate('items.productRef', 'name productId warrantyPeriod');
        if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });
        res.status(200).json({ success: true, data: invoice });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.updateInvoice = async (req, res) => {
    try {
        const updatedInvoice = await Invoice.findByIdAndUpdate(req.params.id, req.body, { new: true })
            .populate('clientRef')
            .populate('projectId')
            .populate('items.productRef', 'name productId warrantyPeriod');
        if (!updatedInvoice) return res.status(404).json({ success: false, message: 'Invoice not found' });
        res.status(200).json({ success: true, data: updatedInvoice });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.deleteInvoice = async (req, res) => {
    try {
        const invoice = await Invoice.findByIdAndDelete(req.params.id);
        if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });

        await InvoiceDeleteRequest.deleteMany({ invoice: req.params.id });
        await Warranty.deleteMany({ invoiceRef: req.params.id });

        res.status(200).json({ success: true, message: 'Invoice deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getInvoiceStats = async (req, res) => {
    try {
        const { period } = req.query;
        const now = new Date();
        let start, end, dateFormat;

        switch (period) {
            case 'daily':
                start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
                dateFormat = '%Y-%m-%d';
                break;
            case 'monthly':
                start = new Date(now.getFullYear(), now.getMonth(), 1);
                end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
                dateFormat = '%Y-%m-%d';
                break;
            default:
                start = new Date(now.getFullYear(), 0, 1);
                end = new Date(now.getFullYear() + 1, 0, 1);
                dateFormat = '%Y-%m';
                break;
        }

        const dateMatch = { createdAt: { $gte: start, $lt: end } };

        const totalInvoices = await Invoice.countDocuments(dateMatch);

        const totalSales = await Invoice.aggregate([
            { $match: dateMatch },
            { $group: { _id: null, total: { $sum: '$finalTotal' } } }
        ]);

        const paymentMethodBreakdown = await Invoice.aggregate([
            { $match: dateMatch },
            { $group: { _id: '$paymentMethod', count: { $sum: 1 }, total: { $sum: '$finalTotal' } } }
        ]);

        const statusBreakdown = await Invoice.aggregate([
            { $match: dateMatch },
            { $group: { _id: '$status', count: { $sum: 1 }, total: { $sum: '$finalTotal' } } }
        ]);

        const salesOverTime = await Invoice.aggregate([
            { $match: dateMatch },
            {
                $group: {
                    _id: { $dateToString: { format: dateFormat, date: '$createdAt' } },
                    total: { $sum: '$finalTotal' },
                    count: { $sum: 1 }
                }
            },
            { $sort: { _id: 1 } }
        ]);

        const recentInvoices = await Invoice.find(dateMatch)
            .populate('clientRef', 'firstName lastName')
            .sort({ createdAt: -1 })
            .limit(10);

        res.status(200).json({
            success: true,
            data: {
                period: period || 'yearly',
                dateRange: { start, end },
                totalInvoices,
                totalSales: totalSales[0]?.total || 0,
                paymentMethodBreakdown,
                statusBreakdown,
                salesOverTime,
                recentInvoices
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
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
                'Deletion Request',
                `${req.user.firstName} ${req.user.lastName} requested deletion of invoice ${invoice.invoiceNumber}. Reason: ${reason}`,
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
        await Warranty.deleteMany({ invoiceRef: request.invoice });

        request.status = 'Approved';
        request.reviewedBy = req.user._id;
        request.reviewedAt = Date.now();
        await request.save();

        await createNotification(
            request.requestedBy._id,
            'approval',
            'Deletion Approved',
            `Your deletion request for invoice ${invoice?.invoiceNumber || 'N/A'} has been approved by ${req.user.firstName} ${req.user.lastName}.`
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
            'Deletion Rejected',
            `Your deletion request for invoice ${invoice?.invoiceNumber || 'N/A'} has been rejected by ${req.user.firstName} ${req.user.lastName}.`
        );

        res.status(200).json({ success: true, message: 'Invoice deletion averted.' });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};
