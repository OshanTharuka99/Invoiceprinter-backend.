const RmaJob = require('../models/RmaJob');
const FaultyDevice = require('../models/FaultyDevice');
const Warranty = require('../models/Warranty');
const StockEntry = require('../models/StockEntry');
const Product = require('../models/Product');
const BusinessDetails = require('../models/BusinessDetails');
const Notification = require('../models/Notification');
const AuditLog = require('../models/AuditLog');
const User = require('../models/User');
const Invoice = require('../models/Invoice');
const DeliveryNote = require('../models/DeliveryNote');

const SIX_MONTHS_MS = 180 * 24 * 60 * 60 * 1000;
const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000;

const isNoWarrantyPeriod = (period) => {
    const p = String(period || '').trim().toUpperCase();
    return !p || p === 'N/A' || p === 'NA' || p === 'NONE';
};

const createNotification = async (recipientId, type, title, message, relatedId = null) => {
    try {
        await Notification.create({
            recipient: recipientId,
            type: type || 'general',
            title,
            message,
            relatedId,
        });
    } catch (err) {
        console.error('RMA notification error:', err.message);
    }
};

const notifyUsers = async (userIds, type, title, message, relatedId) => {
    const unique = [...new Set((userIds || []).map((id) => String(id)).filter(Boolean))];
    for (const id of unique) {
        await createNotification(id, type, title, message, relatedId);
    }
};

const parseWarrantyPeriodToMs = (period) => {
    if (!period || typeof period !== 'string') return 365 * 24 * 60 * 60 * 1000;
    const text = period.toLowerCase().trim();
    const match = text.match(/(\d+)\s*(year|yr|month|mon|week|day|days|months|years|weeks|yrs)/i);
    if (!match) return 365 * 24 * 60 * 60 * 1000;
    const n = Number(match[1]) || 1;
    const unit = match[2];
    if (unit.startsWith('year') || unit.startsWith('yr')) return n * 365 * 24 * 60 * 60 * 1000;
    if (unit.startsWith('mon')) return n * 30 * 24 * 60 * 60 * 1000;
    if (unit.startsWith('week')) return n * 7 * 24 * 60 * 60 * 1000;
    return n * 24 * 60 * 60 * 1000;
};

const computeExpiry = (startDate, period) => {
    const start = startDate ? new Date(startDate) : new Date();
    return new Date(start.getTime() + parseWarrantyPeriodToMs(period));
};

const buildJobNumber = async () => {
    const biz = await BusinessDetails.findOne();
    const prefix = (biz?.rmaPrefix || 'RMA').toUpperCase();
    const digits = Number(biz?.rmaDigits || 5);
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const latest = await RmaJob.findOne({ jobNumber: new RegExp(`^${escaped}`) }).sort({ createdAt: -1 });
    let sequence = 1;
    if (latest?.jobNumber) {
        const num = parseInt(latest.jobNumber.substring(prefix.length), 10);
        if (!Number.isNaN(num)) sequence = num + 1;
    }
    return `${prefix}${String(sequence).padStart(digits, '0')}`;
};

const populateRma = (query) => query
    .populate('productRef', 'name productId warrantyPeriod price')
    .populate('warrantyRef')
    .populate('clientRef', 'firstName lastName telephoneNumber emailAddress address clientId')
    .populate('projectRef', 'projectId name location')
    .populate('supplierRef', 'name telephoneNumber emailAddress address supplierId')
    .populate('assignees', 'firstName lastName username role')
    .populate('createdBy', 'firstName lastName username role')
    .populate('statusHistory.editedBy', 'firstName lastName username')
    .populate('invoiceRef', 'invoiceNumber')
    .populate('replacement.newWarrantyRef')
    .populate('replacement.faultyDeviceRef');

const resolveSupplierFromStock = async (serial, productId) => {
    const serialUpper = String(serial).toUpperCase();
    let entry = await StockEntry.findOne({
        serialNumbers: serialUpper,
        ...(productId ? { product: productId } : {}),
    }).populate('supplierRef', 'name telephoneNumber emailAddress address supplierId').sort({ createdAt: -1 });

    if (!entry && productId) {
        entry = await StockEntry.findOne({
            product: productId,
            notes: new RegExp(serialUpper, 'i'),
        }).populate('supplierRef', 'name telephoneNumber emailAddress address supplierId').sort({ createdAt: -1 });
    }

    if (!entry && productId) {
        entry = await StockEntry.findOne({ product: productId })
            .populate('supplierRef', 'name telephoneNumber emailAddress address supplierId')
            .sort({ createdAt: -1 });
    }

    return entry;
};

const deductSerialFromStock = async (productId, serial, userId) => {
    const serialUpper = String(serial).toUpperCase();
    const entry = await StockEntry.findOne({
        product: productId,
        serialNumbers: serialUpper,
    }).sort({ createdAt: 1 });

    if (!entry) {
        throw new Error(`Serial ${serialUpper} not found in stock`);
    }

    const buyingPrice = Number(entry.buyingPrice || 0);
    entry.serialNumbers = (entry.serialNumbers || [])
        .map((s) => String(s).toUpperCase())
        .filter((s) => s !== serialUpper);
    entry.hasSerialNumbers = entry.serialNumbers.length > 0;
    entry.quantity = Math.max(0, Number(entry.quantity || 0) - 1);

    if (entry.quantity <= 0 && entry.serialNumbers.length === 0) {
        await StockEntry.findByIdAndDelete(entry._id);
    } else {
        await entry.save();
    }

    await Product.findByIdAndUpdate(productId, { $inc: { quantity: -1 } });

    return { buyingPrice, entryId: entry._id, warrantyPeriod: entry.warrantyPeriod || '' };
};

const autoCleanupFaultyDevices = async () => {
    const now = new Date();
    const due = await FaultyDevice.find({ status: 'faulty', autoRemoveAt: { $lte: now } });
    for (const device of due) {
        device.status = 'removed';
        device.removeNote = device.removeNote || 'Automatically removed after 6 months — counted as loss';
        device.removedAt = now;
        device.lossAmount = Number(device.buyingPrice || 0);
        await device.save();

        try {
            await AuditLog.create({
                action: 'STOCK_LOSS_WRITEOFF',
                targetType: 'FaultyDevice',
                targetId: device._id,
                targetName: device.serialNumber,
                details: {
                    jobNumber: device.jobNumber,
                    buyingPrice: device.buyingPrice,
                    auto: true,
                },
                reason: 'Auto-remove after 6 months',
                performedBy: device.createdBy || device.removedBy,
            });
        } catch (_) { /* ignore if no performer */ }
    }
    return due.length;
};

/** Notify assignees + root users when an active RMA is open ≥ 1 month (once). */
const notifyOverdueRmaJobs = async () => {
    const cutoff = new Date(Date.now() - ONE_MONTH_MS);
    const overdue = await RmaJob.find({
        createdAt: { $lte: cutoff },
        status: { $nin: ['Closed', 'Cancelled', 'Resolved'] },
        overdueNotifiedAt: null,
    }).select('jobNumber serialNumber assignees createdBy createdAt');

    if (!overdue.length) return 0;

    const roots = await User.find({ role: 'root' }).select('_id');
    const rootIds = roots.map((u) => String(u._id));

    for (const job of overdue) {
        const recipients = [
            ...((job.assignees || []).map((id) => String(id))),
            ...rootIds,
        ];
        const ageDays = Math.floor((Date.now() - new Date(job.createdAt).getTime()) / (24 * 60 * 60 * 1000));
        await notifyUsers(
            recipients,
            'rma_overdue',
            `RMA overdue: ${job.jobNumber}`,
            `Job ${job.jobNumber} (SN ${job.serialNumber}) has been open for ${ageDays} days. Please follow up.`,
            job._id,
        );
        job.overdueNotifiedAt = new Date();
        await job.save();
    }
    return overdue.length;
};

exports.lookupBySerial = async (req, res) => {
    try {
        const serial = String(req.params.serial || '').trim().toUpperCase();
        if (!serial) {
            return res.status(400).json({ success: false, message: 'Serial number is required' });
        }

        const now = new Date();
        const warranties = await Warranty.find({ serialNumber: serial })
            .populate('invoiceRef', 'invoiceNumber manualClientDetails clientRef paymentMethod createdAt')
            .populate('clientRef', 'firstName lastName telephoneNumber emailAddress address clientId whatsappNumber')
            .populate('projectRef', 'projectId name location client')
            .populate('productRef', 'name productId warrantyPeriod price')
            .sort({ createdAt: -1 });

        let warranty = warranties[0] || null;
        if (warranty?.expiryDate && new Date(warranty.expiryDate) < now && warranty.status === 'active') {
            warranty = warranty.toObject();
            warranty.status = 'expired';
        } else if (warranty) {
            warranty = warranty.toObject();
        }

        const underWarranty = !!(warranty && warranty.status === 'active'
            && (!warranty.expiryDate || new Date(warranty.expiryDate) >= now));

        let client = warranty?.clientRef || null;
        let project = warranty?.projectRef || null;
        let product = warranty?.productRef || null;
        let invoiceNumber = '';
        let invoiceRef = warranty?.invoiceRef?._id || warranty?.invoiceRef || null;

        if (warranty?.invoiceRef) {
            const inv = warranty.invoiceRef;
            invoiceNumber = inv.invoiceNumber || '';
            if (!client && inv.manualClientDetails) {
                client = {
                    firstName: inv.manualClientDetails.name || '',
                    lastName: '',
                    telephoneNumber: inv.manualClientDetails.telephoneNumber || '',
                    emailAddress: inv.manualClientDetails.emailAddress || '',
                    address: inv.manualClientDetails.address || '',
                    _manual: true,
                };
            }
        }

        // invoiceRef may actually be a DeliveryNote id
        if (!invoiceNumber && invoiceRef) {
            const inv = await Invoice.findById(invoiceRef).select('invoiceNumber manualClientDetails clientRef');
            if (inv) {
                invoiceNumber = inv.invoiceNumber;
                if (!client && inv.clientRef) {
                    client = await require('../models/Client').findById(inv.clientRef)
                        .select('firstName lastName telephoneNumber emailAddress address clientId');
                }
            } else {
                const dn = await DeliveryNote.findById(invoiceRef)
                    .populate('clientRef', 'firstName lastName telephoneNumber emailAddress address clientId')
                    .select('deliveryNoteNumber manualClientDetails clientRef projectRef');
                if (dn) {
                    invoiceNumber = dn.deliveryNoteNumber || '';
                    if (!client) client = dn.clientRef || (dn.manualClientDetails ? {
                        firstName: dn.manualClientDetails.name || '',
                        lastName: '',
                        telephoneNumber: dn.manualClientDetails.telephoneNumber || '',
                        emailAddress: dn.manualClientDetails.emailAddress || '',
                        address: dn.manualClientDetails.address || '',
                        _manual: true,
                    } : null);
                    if (!project && dn.projectRef) {
                        project = await require('../models/Project').findById(dn.projectRef)
                            .select('projectId name location');
                    }
                }
            }
        }

        const stockEntry = await resolveSupplierFromStock(serial, product?._id || product);
        const supplier = stockEntry?.supplierRef || null;
        const buyingPrice = Number(stockEntry?.buyingPrice || 0);

        // stock serial options for replace
        let availableSerials = [];
        if (product?._id) {
            const entries = await StockEntry.find({ product: product._id, quantity: { $gt: 0 } });
            availableSerials = [...new Set(entries.flatMap((e) => e.serialNumbers || []).map((s) => String(s).toUpperCase()))];
        }

        const openRma = await RmaJob.findOne({
            serialNumber: serial,
            status: { $nin: ['Closed', 'Cancelled'] },
        }).select('jobNumber status');

        res.status(200).json({
            success: true,
            data: {
                serialNumber: serial,
                warrantyFound: !!warranty,
                underWarranty,
                warranty,
                product,
                client,
                project,
                supplier,
                invoiceNumber,
                invoiceRef,
                buyingPrice,
                stockWarrantyPeriod: stockEntry?.warrantyPeriod || '',
                availableSerials,
                openRma,
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getRmaJobs = async (req, res) => {
    try {
        // Cleanup + overdue alerts run in background so list loads stay fast
        setImmediate(() => {
            autoCleanupFaultyDevices().catch(() => {});
            notifyOverdueRmaJobs().catch(() => {});
        });

        const filter = {};
        if (req.query.status) filter.status = req.query.status;
        if (req.user.role === 'user') {
            filter.$or = [
                { createdBy: req.user._id },
                { assignees: req.user._id },
            ];
        }

        const light = String(req.query.light || '').toLowerCase() === 'true';
        let query = RmaJob.find(filter).sort({ createdAt: -1 });

        if (light) {
            query = query
                .select('jobNumber serialNumber status underWarranty createdAt productRef clientRef assignees createdBy customerDetails productName replacement faultComment diagnosis')
                .populate('productRef', 'name productId')
                .populate('clientRef', 'firstName lastName organization')
                .populate('assignees', 'firstName lastName')
                .populate('createdBy', 'firstName lastName')
                .lean();
            const jobs = await query;
            return res.status(200).json({ success: true, data: jobs });
        }

        const jobs = await populateRma(query);
        res.status(200).json({ success: true, data: jobs });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getRmaJobById = async (req, res) => {
    try {
        const job = await populateRma(RmaJob.findById(req.params.id));
        if (!job) return res.status(404).json({ success: false, message: 'RMA job not found' });
        res.status(200).json({ success: true, data: job });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.createRmaJob = async (req, res) => {
    try {
        const {
            serialNumber,
            productRef,
            warrantyRef,
            underWarranty,
            warrantyPeriod,
            warrantyStartDate,
            warrantyExpiryDate,
            invoiceRef,
            invoiceNumber,
            clientRef,
            customerDetails,
            projectRef,
            projectDetails,
            supplierRef,
            supplierDetails,
            assignees,
            faultComment,
            terms,
            notes,
        } = req.body;

        const serial = String(serialNumber || '').trim().toUpperCase();
        if (!serial) return res.status(400).json({ success: false, message: 'Serial number is required' });
        if (!faultComment?.trim()) {
            return res.status(400).json({ success: false, message: 'Faulty device comment is required' });
        }

        const openExisting = await RmaJob.findOne({
            serialNumber: serial,
            status: { $nin: ['Closed', 'Cancelled'] },
        });
        if (openExisting) {
            return res.status(400).json({
                success: false,
                message: `Open RMA already exists: ${openExisting.jobNumber}`,
            });
        }

        const biz = await BusinessDetails.findOne();
        const jobNumber = await buildJobNumber();
        const assigneeIds = [...new Set((assignees || []).map((id) => String(id)).filter(Boolean))];

        let productName = '';
        if (productRef) {
            const product = await Product.findById(productRef).select('name');
            productName = product?.name || '';
        }

        const job = await RmaJob.create({
            jobNumber,
            serialNumber: serial,
            productRef: productRef || null,
            productName,
            warrantyRef: warrantyRef || null,
            underWarranty: !!underWarranty,
            warrantyPeriod: warrantyPeriod || '',
            warrantyStartDate: warrantyStartDate || null,
            warrantyExpiryDate: warrantyExpiryDate || null,
            invoiceRef: invoiceRef || null,
            invoiceNumber: invoiceNumber || '',
            clientRef: clientRef || null,
            customerDetails: customerDetails || {},
            projectRef: projectRef || null,
            projectDetails: projectDetails || {},
            supplierRef: supplierRef || null,
            supplierDetails: supplierDetails || {},
            assignees: assigneeIds,
            faultComment: faultComment.trim(),
            terms: terms || biz?.rmaTerms || '',
            notes: notes || biz?.rmaNotes || '',
            status: 'Open',
            statusHistory: [{
                status: 'Open',
                note: `RMA created. Fault: ${faultComment.trim()}`,
                editedBy: req.user._id,
                editedAt: new Date(),
            }],
            createdBy: req.user._id,
        });

        await notifyUsers(
            assigneeIds,
            'rma_assignment',
            `RMA Assigned: ${jobNumber}`,
            `You have been assigned to RMA ${jobNumber} for serial ${serial}.`,
            job._id,
        );

        try {
            await AuditLog.create({
                action: 'RMA_CREATED',
                targetType: 'RmaJob',
                targetId: job._id,
                targetName: jobNumber,
                details: { serial, assignees: assigneeIds },
                reason: faultComment.trim(),
                performedBy: req.user._id,
            });
        } catch (_) { /* optional */ }

        const populated = await populateRma(RmaJob.findById(job._id));
        res.status(201).json({ success: true, data: populated });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.addAssignees = async (req, res) => {
    try {
        const job = await RmaJob.findById(req.params.id);
        if (!job) return res.status(404).json({ success: false, message: 'RMA job not found' });

        const incoming = [...new Set((req.body.assignees || []).map((id) => String(id)).filter(Boolean))];
        if (incoming.length === 0) {
            return res.status(400).json({ success: false, message: 'Select at least one user' });
        }

        const existing = new Set((job.assignees || []).map((id) => String(id)));
        const added = incoming.filter((id) => !existing.has(id));
        job.assignees = [...existing, ...added];
        job.statusHistory.push({
            status: job.status,
            note: `Assignees updated (+${added.length})`,
            editedBy: req.user._id,
            editedAt: new Date(),
        });
        await job.save();

        if (added.length) {
            await notifyUsers(
                added,
                'rma_assignment',
                `RMA Assigned: ${job.jobNumber}`,
                `You have been assigned to RMA ${job.jobNumber} for serial ${job.serialNumber}.`,
                job._id,
            );
        }

        const populated = await populateRma(RmaJob.findById(job._id));
        res.status(200).json({ success: true, data: populated });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

const canUpdateRma = (job, user) => {
    if (user.role === 'admin' || user.role === 'root') return true;
    const uid = String(user._id);
    if (String(job.createdBy) === uid) return true;
    return (job.assignees || []).some((id) => String(id) === uid);
};

exports.addStatusUpdate = async (req, res) => {
    try {
        const job = await RmaJob.findById(req.params.id);
        if (!job) return res.status(404).json({ success: false, message: 'RMA job not found' });
        if (!canUpdateRma(job, req.user)) {
            return res.status(403).json({ success: false, message: 'Not assigned to this RMA' });
        }

        const note = (req.body.note || '').trim();
        if (!note) return res.status(400).json({ success: false, message: 'Status comment is required' });

        const status = req.body.status || job.status;
        if (!['Open', 'In Progress', 'Awaiting Supplier', 'Resolved', 'Closed', 'Cancelled'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Invalid status' });
        }

        if (req.body.diagnosis !== undefined) {
            job.diagnosis = String(req.body.diagnosis || '').trim();
        }

        // Ending the RMA requires a recorded fault / diagnosis
        if (['Resolved', 'Closed'].includes(status)) {
            const faultText = (job.diagnosis || job.faultComment || '').trim();
            if (!faultText) {
                return res.status(400).json({
                    success: false,
                    message: 'Fault diagnosis is required before resolving or closing this RMA',
                });
            }
        }

        job.status = status;

        job.statusHistory.push({
            status,
            note,
            editedBy: req.user._id,
            editedAt: new Date(),
        });
        await job.save();

        const recipients = [
            ...((job.assignees || []).map((id) => String(id))),
            String(job.createdBy),
        ].filter((id) => id !== String(req.user._id));

        await notifyUsers(
            recipients,
            'rma_update',
            `RMA Update: ${job.jobNumber}`,
            `${req.user.firstName || 'User'}: ${note}`,
            job._id,
        );

        const populated = await populateRma(RmaJob.findById(job._id));
        res.status(200).json({ success: true, data: populated });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.setDiagnosis = async (req, res) => {
    try {
        const job = await RmaJob.findById(req.params.id);
        if (!job) return res.status(404).json({ success: false, message: 'RMA job not found' });
        if (!canUpdateRma(job, req.user)) {
            return res.status(403).json({ success: false, message: 'Not assigned to this RMA' });
        }

        const diagnosis = (req.body.diagnosis || '').trim();
        if (!diagnosis) return res.status(400).json({ success: false, message: 'Diagnosis / fault cause is required' });

        job.diagnosis = diagnosis;
        job.statusHistory.push({
            status: job.status,
            note: `Fault check completed. Cause: ${diagnosis}`,
            editedBy: req.user._id,
            editedAt: new Date(),
        });
        await job.save();

        const populated = await populateRma(RmaJob.findById(job._id));
        res.status(200).json({ success: true, data: populated });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.replaceDevice = async (req, res) => {
    try {
        const job = await RmaJob.findById(req.params.id);
        if (!job) return res.status(404).json({ success: false, message: 'RMA job not found' });
        if (!canUpdateRma(job, req.user)) {
            return res.status(403).json({ success: false, message: 'Not assigned to this RMA' });
        }
        if (job.replacement?.replaced) {
            return res.status(400).json({ success: false, message: 'Device already replaced on this RMA' });
        }

        const source = req.body.source; // stock | supplier
        const newSerial = String(req.body.newSerialNumber || '').trim().toUpperCase();
        const rawWarranty = String(req.body.newWarrantyPeriod || '').trim();
        const noWarranty = isNoWarrantyPeriod(rawWarranty);
        const newWarrantyPeriod = noWarranty ? 'N/A' : rawWarranty;
        if (!['stock', 'supplier'].includes(source)) {
            return res.status(400).json({ success: false, message: 'Replacement source must be stock or supplier' });
        }
        if (!newSerial) {
            return res.status(400).json({ success: false, message: 'New serial number is required' });
        }
        if (newSerial === job.serialNumber) {
            return res.status(400).json({ success: false, message: 'New serial must differ from old serial' });
        }

        const productId = job.productRef;
        if (!productId) {
            return res.status(400).json({ success: false, message: 'RMA has no linked product for stock update' });
        }

        let buyingPrice = 0;
        if (source === 'stock') {
            const deducted = await deductSerialFromStock(productId, newSerial, req.user._id);
            buyingPrice = deducted.buyingPrice;
        } else {
            // supplier-provided: try to use historical buying price of old device
            const oldStock = await resolveSupplierFromStock(job.serialNumber, productId);
            buyingPrice = Number(oldStock?.buyingPrice || 0);
            if (req.body.buyingPrice !== undefined) {
                buyingPrice = Number(req.body.buyingPrice) || buyingPrice;
            }
        }

        // If stock replace, transfer old device cost onto new path: keep buyingPrice from NEW stock item,
        // but user asked: new device price should take faulty device price.
        const oldMeta = await resolveSupplierFromStock(job.serialNumber, productId);
        const faultyPrice = Number(oldMeta?.buyingPrice || buyingPrice || 0);
        if (source === 'stock' && faultyPrice > 0) {
            buyingPrice = faultyPrice;
        }

        const warrantyPeriodFinal = noWarranty
            ? ''
            : (newWarrantyPeriod
                || (await Product.findById(productId).select('warrantyPeriod'))?.warrantyPeriod
                || '');
        const startDate = noWarranty
            ? null
            : (req.body.newWarrantyStartDate
                ? new Date(req.body.newWarrantyStartDate)
                : new Date());
        const expiryDate = noWarranty
            ? null
            : (req.body.newWarrantyExpiryDate
                ? new Date(req.body.newWarrantyExpiryDate)
                : (warrantyPeriodFinal ? computeExpiry(startDate, warrantyPeriodFinal) : null));

        // Create faulty holding for old SN
        const autoRemoveAt = new Date(Date.now() + SIX_MONTHS_MS);
        const faulty = await FaultyDevice.create({
            serialNumber: job.serialNumber,
            productRef: productId,
            productName: job.productName || '',
            rmaRef: job._id,
            jobNumber: job.jobNumber,
            buyingPrice: faultyPrice,
            status: 'faulty',
            faultySince: new Date(),
            autoRemoveAt,
            lossAmount: 0,
            notes: `Faulty device from RMA ${job.jobNumber}`,
            createdBy: req.user._id,
        });

        // Mark old SN in a faulty stock entry (non-sellable tracking)
        await StockEntry.create({
            product: productId,
            batchRef: `FAULTY-${job.jobNumber}-${Date.now().toString(36).toUpperCase()}`,
            location: 'FAULTY',
            buyingPrice: faultyPrice,
            quantity: 1,
            serialNumbers: [job.serialNumber],
            hasSerialNumbers: true,
            warrantyPeriod: job.warrantyPeriod || '',
            notes: `FAULT DEVICE — RMA ${job.jobNumber}. Auto-remove after 6 months. Loss price: ${faultyPrice}`,
            addedBy: req.user._id,
        });

        // Update / create warranty for new SN (skip when N/A)
        let newWarrantyRef = null;
        if (warrantyPeriodFinal) {
            if (job.warrantyRef) {
                const oldW = await Warranty.findById(job.warrantyRef);
                if (oldW) {
                    oldW.status = 'expired';
                    await oldW.save();

                    // Check uniqueness for new serial
                    const clash = await Warranty.findOne({
                        serialNumber: newSerial,
                        productRef: productId,
                    });
                    if (clash) {
                        clash.serialNumber = newSerial;
                        clash.warrantyPeriod = warrantyPeriodFinal;
                        clash.startDate = startDate;
                        clash.expiryDate = expiryDate;
                        clash.status = 'active';
                        await clash.save();
                        newWarrantyRef = clash._id;
                    } else {
                        const createdW = await Warranty.create({
                            invoiceRef: oldW.invoiceRef,
                            clientRef: oldW.clientRef || job.clientRef || undefined,
                            projectRef: oldW.projectRef || job.projectRef || undefined,
                            projectLocation: oldW.projectLocation || job.projectDetails?.location || '',
                            productRef: productId,
                            serialNumber: newSerial,
                            warrantyPeriod: warrantyPeriodFinal,
                            startDate,
                            expiryDate,
                            status: 'active',
                        });
                        newWarrantyRef = createdW._id;
                    }
                }
            } else if (job.invoiceRef) {
                const createdW = await Warranty.create({
                    invoiceRef: job.invoiceRef,
                    clientRef: job.clientRef || undefined,
                    projectRef: job.projectRef || undefined,
                    projectLocation: job.projectDetails?.location || '',
                    productRef: productId,
                    serialNumber: newSerial,
                    warrantyPeriod: warrantyPeriodFinal,
                    startDate,
                    expiryDate,
                    status: 'active',
                });
                newWarrantyRef = createdW._id;
            }
        } else if (job.warrantyRef) {
            // Replacement has no warranty — expire old record
            const oldW = await Warranty.findById(job.warrantyRef);
            if (oldW) {
                oldW.status = 'expired';
                await oldW.save();
            }
        }

        job.replacement = {
            replaced: true,
            source,
            oldSerialNumber: job.serialNumber,
            newSerialNumber: newSerial,
            newWarrantyPeriod: warrantyPeriodFinal || 'N/A',
            newWarrantyStartDate: startDate,
            newWarrantyExpiryDate: expiryDate,
            buyingPrice,
            newWarrantyRef,
            faultyDeviceRef: faulty._id,
        };
        job.underWarranty = !!warrantyPeriodFinal;
        job.statusHistory.push({
            status: job.status,
            note: `Device replaced (${source}). Old SN ${job.serialNumber} → New SN ${newSerial}. Warranty: ${warrantyPeriodFinal || 'N/A'}`,
            editedBy: req.user._id,
            editedAt: new Date(),
        });
        await job.save();

        try {
            await AuditLog.create({
                action: 'RMA_REPLACE',
                targetType: 'RmaJob',
                targetId: job._id,
                targetName: job.jobNumber,
                details: {
                    source,
                    oldSerial: job.serialNumber,
                    newSerial,
                    buyingPrice,
                    faultyDeviceId: faulty._id,
                },
                reason: job.diagnosis || job.faultComment,
                performedBy: req.user._id,
            });
            await AuditLog.create({
                action: 'FAULTY_STOCK_ADDED',
                targetType: 'FaultyDevice',
                targetId: faulty._id,
                targetName: job.serialNumber,
                details: { jobNumber: job.jobNumber, buyingPrice: faultyPrice },
                reason: 'Replaced under RMA',
                performedBy: req.user._id,
            });
        } catch (_) { /* optional */ }

        const populated = await populateRma(RmaJob.findById(job._id));
        res.status(200).json({ success: true, data: populated });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.setCustomerSignature = async (req, res) => {
    try {
        const job = await RmaJob.findById(req.params.id);
        if (!job) return res.status(404).json({ success: false, message: 'RMA job not found' });

        const customerName = (req.body.customerName || job.customerDetails?.name || '').trim();
        const idCardNumber = (req.body.idCardNumber || '').trim();
        const destination = String(req.body.destination ?? job.customerDetails?.destination ?? '').trim();

        if (!customerName) return res.status(400).json({ success: false, message: 'Customer name is required' });
        if (!idCardNumber) return res.status(400).json({ success: false, message: 'ID card number is required' });

        job.customerSignature = {
            collected: true,
            customerName,
            idCardNumber,
            destination,
            signedAt: new Date(),
        };
        job.customerDetails = {
            ...(job.customerDetails?.toObject?.() || job.customerDetails || {}),
            name: customerName,
            idCardNumber,
            destination,
        };
        job.statusHistory.push({
            status: job.status,
            note: 'Customer signature details recorded for RMA report',
            editedBy: req.user._id,
            editedAt: new Date(),
        });
        await job.save();

        const populated = await populateRma(RmaJob.findById(job._id));
        res.status(200).json({ success: true, data: populated });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.getFaultyDevices = async (req, res) => {
    try {
        setImmediate(() => {
            autoCleanupFaultyDevices().catch(() => {});
        });
        const filter = {};
        if (req.query.status) filter.status = req.query.status;
        const devices = await FaultyDevice.find(filter)
            .populate('productRef', 'name productId')
            .populate('rmaRef', 'jobNumber')
            .populate('removedBy', 'firstName lastName')
            .populate('createdBy', 'firstName lastName')
            .sort({ faultySince: -1 });
        res.status(200).json({ success: true, data: devices });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.removeFaultyDevice = async (req, res) => {
    try {
        const device = await FaultyDevice.findById(req.params.id);
        if (!device) return res.status(404).json({ success: false, message: 'Faulty device not found' });
        if (device.status === 'removed') {
            return res.status(400).json({ success: false, message: 'Already removed' });
        }

        const removeNote = (req.body.note || '').trim();
        if (!removeNote) {
            return res.status(400).json({ success: false, message: 'Removal note is required' });
        }

        device.status = 'removed';
        device.removeNote = removeNote;
        device.removedBy = req.user._id;
        device.removedAt = new Date();
        device.lossAmount = Number(device.buyingPrice || 0);
        await device.save();

        // Remove matching faulty stock entry serials
        const entries = await StockEntry.find({
            location: 'FAULTY',
            serialNumbers: device.serialNumber,
            ...(device.productRef ? { product: device.productRef } : {}),
        });
        for (const entry of entries) {
            entry.serialNumbers = (entry.serialNumbers || [])
                .map((s) => String(s).toUpperCase())
                .filter((s) => s !== device.serialNumber);
            entry.quantity = Math.max(0, Number(entry.quantity || 0) - 1);
            entry.hasSerialNumbers = entry.serialNumbers.length > 0;
            if (entry.quantity <= 0) await StockEntry.findByIdAndDelete(entry._id);
            else await entry.save();
        }

        await AuditLog.create({
            action: 'FAULTY_REMOVED',
            targetType: 'FaultyDevice',
            targetId: device._id,
            targetName: device.serialNumber,
            details: {
                lossAmount: device.lossAmount,
                jobNumber: device.jobNumber,
            },
            reason: removeNote,
            performedBy: req.user._id,
        });

        res.status(200).json({
            success: true,
            message: 'Faulty device removed and recorded as loss',
            data: device,
        });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.getOrgUsers = async (req, res) => {
    try {
        const users = await User.find({ role: { $in: ['user', 'admin', 'root'] } })
            .select('firstName lastName username role')
            .sort({ firstName: 1 });
        res.status(200).json({ success: true, data: users });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
