const Invoice = require('../models/Invoice');
const InvoiceDeleteRequest = require('../models/InvoiceDeleteRequest');
const Notification = require('../models/Notification');
const User = require('../models/User');
const Product = require('../models/Product');
const StockEntry = require('../models/StockEntry');
const Project = require('../models/Project');
const Warranty = require('../models/Warranty');
const BusinessDetails = require('../models/BusinessDetails');

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

const EDIT_DELETE_WINDOW_DAYS = 30;

const isWithinEditWindow = (createdAt) => {
    const now = new Date();
    const diffMs = now - new Date(createdAt);
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    return diffDays <= EDIT_DELETE_WINDOW_DAYS;
};

// Restore stock from an invoice's items (used on edit/delete)
const reverseInvoiceStock = async (invoice) => {
    for (const item of invoice.items) {
        if (!item.productRef) continue;
        const hasSerials = item.serialNumbers && item.serialNumbers.length > 0;
        const isAutomatic = invoice.creationMethod === 'automatic';
        const isManual = invoice.creationMethod === 'manual';

        // Find the most recent stock entry for this product to restore into
        let entry = await StockEntry.findOne({ product: item.productRef }).sort({ createdAt: -1 });

        if (hasSerials) {
            // Restore serial numbers back to the stock entry
            if (entry) {
                const upperSerials = item.serialNumbers.map(s => s.toUpperCase());
                const newSerials = [...new Set([...entry.serialNumbers, ...upperSerials])];
                entry.serialNumbers = newSerials;
                if (isManual) {
                    entry.quantity += item.serialNumbers.length;
                }
                await entry.save();
            }
        }

        if (isAutomatic) {
            // Restore quantity to product level
            await Product.findByIdAndUpdate(item.productRef, {
                $inc: { quantity: item.quantity }
            });
            // Also try to restore to the stock entry
            if (entry) {
                entry.quantity += item.quantity;
                await entry.save();
            }
        } else if (isManual && hasSerials) {
            await Product.findByIdAndUpdate(item.productRef, {
                $inc: { quantity: item.serialNumbers.length }
            });
        }
    }
};

// Apply stock deductions for a set of items (used on create/edit)
const applyStockDeductions = async (items, creationMethod) => {
    for (const item of items) {
        if (item.productRef && (creationMethod === 'automatic' || (creationMethod === 'manual' && item.serialNumbers?.length > 0))) {
            let remainingQty = item.quantity;

            const stockEntries = await StockEntry.find({
                product: item.productRef,
                quantity: { $gt: 0 }
            }).sort({ createdAt: 1 });

            for (const entry of stockEntries) {
                if (remainingQty <= 0) break;

                if (item.serialNumbers && item.serialNumbers.length > 0) {
                    const serialsToRemove = item.serialNumbers.filter(sn =>
                        entry.serialNumbers.map(s => s.toUpperCase()).includes(sn.toUpperCase())
                    );
                    if (serialsToRemove.length > 0) {
                        entry.serialNumbers = entry.serialNumbers.filter(
                            sn => !serialsToRemove.map(s => s.toUpperCase()).includes(sn.toUpperCase())
                        );
                        if (creationMethod === 'manual') {
                            entry.quantity = Math.max(0, entry.quantity - serialsToRemove.length);
                            remainingQty -= serialsToRemove.length;
                        }
                    }
                }

                if (creationMethod === 'automatic') {
                    const reduceQty = Math.min(remainingQty, entry.quantity);
                    entry.quantity -= reduceQty;
                    remainingQty -= reduceQty;
                }

                if (entry.quantity <= 0) {
                    await StockEntry.findByIdAndDelete(entry._id);
                } else {
                    await entry.save();
                }
            }

            if (creationMethod === 'automatic') {
                await Product.findByIdAndUpdate(item.productRef, {
                    $inc: { quantity: -item.quantity }
                });
            } else if (creationMethod === 'manual' && item.serialNumbers?.length > 0) {
                await Product.findByIdAndUpdate(item.productRef, {
                    $inc: { quantity: -item.serialNumbers.length }
                });
            }
        }
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
            .populate('statusHistory.editedBy', 'firstName lastName')
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

        // Business rule: every invoice must be linked to a project for warranty tracking
        if (!projectId) {
            return res.status(400).json({ success: false, message: 'A project must be selected for this invoice' });
        }

        const bizDetails = await BusinessDetails.findOne();
        const prefix = bizDetails?.invoicePrefix || 'INV';
        const digits = bizDetails?.invoiceDigits || 5;

        const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const latestInvoice = await Invoice.findOne({
            invoiceNumber: new RegExp('^' + escapedPrefix)
        }).sort({ createdAt: -1 });

        let sequence = 1;
        if (latestInvoice && latestInvoice.invoiceNumber) {
            const suffixStr = latestInvoice.invoiceNumber.substring(prefix.length);
            const num = parseInt(suffixStr, 10);
            if (!isNaN(num)) sequence = num + 1;
        }
        const invoiceNumber = `${prefix}${sequence.toString().padStart(digits, '0')}`;

        // Enforce Paid status for Cash payment method
        const initialStatus = paymentMethod === 'cash' ? 'Paid' : (status || 'Unpaid');

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
            status: initialStatus,
            statusHistory: [{
                status: initialStatus,
                note: 'Initial invoice creation',
                editedBy: req.user._id,
                editedAt: Date.now()
            }],
            invoiceDate: invoiceDate || Date.now(),
            createdBy: req.user._id
        };

        const invoice = await Invoice.create(invoiceData);

        await applyStockDeductions(items, creationMethod);

        if (projectId) {
            await Project.findByIdAndUpdate(projectId, {
                $inc: { value: finalTotal }
            });
        }

        const warrantyRecords = [];
        const startDate = invoiceDate ? new Date(invoiceDate) : new Date();

        // Fetch project location once for all warranty records
        let projectLocation = '';
        if (projectId) {
            const proj = await Project.findById(projectId).select('location');
            projectLocation = proj?.location || '';
        }

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
                            projectLocation,
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
            .populate('statusHistory.editedBy', 'firstName lastName')
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
            .populate('statusHistory.editedBy', 'firstName lastName')
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
            .populate('statusHistory.editedBy', 'firstName lastName')
            .populate('items.productRef', 'name productId warrantyPeriod');
        if (!updatedInvoice) return res.status(404).json({ success: false, message: 'Invoice not found' });
        res.status(200).json({ success: true, data: updatedInvoice });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.updateInvoiceStatus = async (req, res) => {
    try {
        const { status, note } = req.body;
        if (!status) return res.status(400).json({ success: false, message: 'Status is required' });

        const invoice = await Invoice.findById(req.params.id);
        if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });

        if (invoice.paymentMethod === 'cash') {
            return res.status(400).json({ success: false, message: 'Cash invoices are permanently marked as Paid' });
        }

        invoice.status = status;
        invoice.statusHistory.push({
            status,
            note: note || '',
            editedBy: req.user._id,
            editedAt: Date.now()
        });

        await invoice.save();

        const updatedInvoice = await Invoice.findById(invoice._id)
            .populate('clientRef')
            .populate('projectId')
            .populate('createdBy', 'firstName lastName')
            .populate('statusHistory.editedBy', 'firstName lastName')
            .populate('items.productRef', 'name productId warrantyPeriod');

        res.status(200).json({ success: true, data: updatedInvoice });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.editInvoice = async (req, res) => {
    try {
        const originalInvoice = await Invoice.findById(req.params.id);
        if (!originalInvoice) return res.status(404).json({ success: false, message: 'Invoice not found' });

        if (originalInvoice.status === 'Cancelled') {
            return res.status(400).json({ success: false, message: 'Cannot edit a cancelled invoice' });
        }

        if (!isWithinEditWindow(originalInvoice.createdAt)) {
            return res.status(403).json({ success: false, message: 'Invoice can only be edited within 30 days of creation' });
        }

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
            invoiceDate,
            editNote
        } = req.body;

        if (!items || items.length === 0) {
            return res.status(400).json({ success: false, message: 'At least one item is required' });
        }
        if (!projectId) {
            return res.status(400).json({ success: false, message: 'A project must be selected' });
        }

        // 1. Reverse stock effects of the original invoice
        await reverseInvoiceStock(originalInvoice);

        // 2. Delete old warranty records linked to original invoice
        await Warranty.deleteMany({ invoiceRef: originalInvoice._id });

        // 3. Reverse project value contribution
        await Project.findByIdAndUpdate(originalInvoice.projectId, {
            $inc: { value: -originalInvoice.finalTotal }
        });

        // 4. Cancel the original invoice
        originalInvoice.status = 'Cancelled';
        originalInvoice.cancelledBy = req.user._id;
        originalInvoice.cancellationNote = editNote || `Replaced by edited invoice`;
        originalInvoice.statusHistory.push({
            status: 'Cancelled',
            note: editNote || 'Invoice superseded by edit',
            editedBy: req.user._id,
            editedAt: Date.now()
        });
        await originalInvoice.save();

        // 5. Generate new invoice number
        const bizDetails = await BusinessDetails.findOne();
        const prefix = bizDetails?.invoicePrefix || 'INV';
        const digits = bizDetails?.invoiceDigits || 5;

        const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const latestInvoice = await Invoice.findOne({
            invoiceNumber: new RegExp('^' + escapedPrefix)
        }).sort({ createdAt: -1 });

        let sequence = 1;
        if (latestInvoice && latestInvoice.invoiceNumber) {
            const suffixStr = latestInvoice.invoiceNumber.substring(prefix.length);
            const num = parseInt(suffixStr, 10);
            if (!isNaN(num)) sequence = num + 1;
        }
        const newInvoiceNumber = `${prefix}${sequence.toString().padStart(digits, '0')}`;

        const initialStatus = paymentMethod === 'cash' ? 'Paid' : (status || 'Unpaid');

        const newHistory = [...originalInvoice.statusHistory, {
            status: initialStatus,
            note: `Created as edit of ${originalInvoice.invoiceNumber}`,
            editedBy: req.user._id,
            editedAt: Date.now()
        }];

        // 6. Create the new invoice
        const newInvoice = await Invoice.create({
            invoiceNumber: newInvoiceNumber,
            creationMethod: creationMethod || originalInvoice.creationMethod,
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
            status: initialStatus,
            statusHistory: newHistory,
            originalInvoiceRef: originalInvoice._id,
            invoiceDate: invoiceDate || Date.now(),
            createdBy: req.user._id
        });

        // 7. Apply new stock deductions
        await applyStockDeductions(items, creationMethod || originalInvoice.creationMethod);

        // 8. Update project value
        if (projectId) {
            await Project.findByIdAndUpdate(projectId, { $inc: { value: finalTotal } });
        }

        // 9. Create new warranty records
        const startDate = invoiceDate ? new Date(invoiceDate) : new Date();
        let projectLocation = '';
        if (projectId) {
            const proj = await Project.findById(projectId).select('location');
            projectLocation = proj?.location || '';
        }

        for (const item of items) {
            if (item.serialNumbers && item.serialNumbers.length > 0 && item.productRef) {
                const product = await Product.findById(item.productRef);
                const warrantyPeriod = product?.warrantyPeriod || '';
                const expiryDate = calculateWarrantyExpiry(startDate, warrantyPeriod);
                for (const serial of item.serialNumbers) {
                    try {
                        await Warranty.create({
                            invoiceRef: newInvoice._id,
                            clientRef: clientRef || null,
                            projectRef: projectId || null,
                            projectLocation,
                            productRef: item.productRef,
                            serialNumber: serial.toUpperCase(),
                            warrantyPeriod,
                            startDate,
                            expiryDate
                        });
                    } catch (err) {
                        console.error(`Warranty creation failed for serial ${serial}:`, err.message);
                    }
                }
            }
        }

        const populatedInvoice = await Invoice.findById(newInvoice._id)
            .populate('clientRef')
            .populate('projectId')
            .populate('createdBy', 'firstName lastName')
            .populate('statusHistory.editedBy', 'firstName lastName')
            .populate('items.productRef', 'name productId warrantyPeriod');

        res.status(201).json({
            success: true,
            data: populatedInvoice,
            cancelledInvoiceNumber: originalInvoice.invoiceNumber
        });
    } catch (error) {
        console.error('editInvoice error:', error);
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.deleteInvoice = async (req, res) => {
    try {
        const invoice = await Invoice.findById(req.params.id);
        if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });

        if (!isWithinEditWindow(invoice.createdAt)) {
            return res.status(403).json({ success: false, message: 'Invoice can only be deleted within 30 days of creation' });
        }

        // Restore stock before deleting
        if (invoice.status !== 'Cancelled') {
            await reverseInvoiceStock(invoice);
        }

        // Delete related warranties
        await Warranty.deleteMany({ invoiceRef: invoice._id });

        // Soft delete the invoice by setting status to Cancelled
        invoice.status = 'Cancelled';
        invoice.statusHistory.push({
            status: 'Cancelled',
            note: 'Invoice deleted/nullified',
            editedBy: req.user._id,
            editedAt: Date.now()
        });
        await invoice.save();

        await InvoiceDeleteRequest.deleteMany({ invoice: req.params.id });

        res.status(200).json({ success: true, message: 'Invoice deleted and stock restored successfully' });
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

        if (!isWithinEditWindow(invoice.createdAt)) {
            return res.status(403).json({ success: false, message: 'Delete requests can only be raised within 30 days of invoice creation' });
        }

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
        if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });

        // Restore stock before soft-deleting
        if (invoice.status !== 'Cancelled') {
            await reverseInvoiceStock(invoice);
        }

        // Delete related warranties
        await Warranty.deleteMany({ invoiceRef: invoice._id });

        // Soft delete the invoice by setting status to Cancelled
        invoice.status = 'Cancelled';
        invoice.statusHistory.push({
            status: 'Cancelled',
            note: `Invoice deleted via approved request. Reason: ${request.reason}`,
            editedBy: req.user._id,
            editedAt: Date.now()
        });
        await invoice.save();

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
