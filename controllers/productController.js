const Product = require('../models/Product');
const Category = require('../models/Category');
const StockEntry = require('../models/StockEntry');
const BusinessDetails = require('../models/BusinessDetails');
const AuditLog = require('../models/AuditLog');
const InventoryEditRequest = require('../models/InventoryEditRequest');
const User = require('../models/User');
const Notification = require('../models/Notification');

const createNotification = async (recipientId, type, title, message, relatedId = null) => {
    try {
        await Notification.create({ recipient: recipientId, type, title, message, relatedId });
    } catch (err) { console.error('Notification error:', err); }
};


// ── CATEGORY METHODS ─────────────────────────────────────────────────────────

exports.createCategory = async (req, res) => {
    try {
        const { name, code, parentCategory } = req.body;
        const category = await Category.create({ name, code, parentCategory: parentCategory || null });
        res.status(201).json({ success: true, data: category });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.getCategories = async (req, res) => {
    try {
        const categories = await Category.find().populate('parentCategory');
        res.status(200).json({ success: true, data: categories });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.updateCategory = async (req, res) => {
    try {
        const { reason, ...updateData } = req.body;
        const before = await Category.findById(req.params.id);
        if (!before) return res.status(404).json({ success: false, message: 'Category not found' });

        const category = await Category.findByIdAndUpdate(
            req.params.id,
            updateData,
            { new: true, runValidators: true }
        );

        await AuditLog.create({
            action: 'CATEGORY_EDIT',
            targetType: 'Category',
            targetId: category._id,
            targetName: category.name,
            details: { before: before.toObject(), after: category.toObject() },
            reason: reason || 'Direct edit by admin',
            performedBy: req.user._id
        });

        res.status(200).json({ success: true, data: category });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.deleteCategory = async (req, res) => {
    try {
        const productsCount = await Product.countDocuments({ category: req.params.id });
        if (productsCount > 0) {
            return res.status(400).json({ success: false, message: 'Cannot delete category with associated products' });
        }
        await Category.findByIdAndDelete(req.params.id);
        res.status(200).json({ success: true, message: 'Category deleted' });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

// ── PRODUCT METHODS ───────────────────────────────────────────────────────────

exports.createProduct = async (req, res) => {
    try {
        const { name, category, price, currencyType, isTaxIncluded, description, warrantyPeriod } = req.body;

        const categoryDoc = await Category.findById(category);
        if (!categoryDoc) return res.status(404).json({ success: false, message: 'Category not found' });

        const codePrefix = categoryDoc.code.toUpperCase();
        const latestProduct = await Product.findOne({
            productId: { $regex: `^${codePrefix}` },
        }).sort({ productId: -1 });

        let sequence = 1;
        if (latestProduct) {
            const lastSequenceStr = latestProduct.productId.replace(codePrefix, '');
            const lastSequence = parseInt(lastSequenceStr, 10);
            if (!isNaN(lastSequence)) sequence = lastSequence + 1;
        }

        const productId = `${codePrefix}${sequence.toString().padStart(5, '0')}`;

        const product = await Product.create({
            productId,
            name,
            category,
            price,
            currencyType,
            isTaxIncluded,
            description: description || '',
            warrantyPeriod: warrantyPeriod || '',
            quantity: 0,
        });

        res.status(201).json({ success: true, data: product });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.getProducts = async (req, res) => {
    try {
        const includeSerials = String(req.query.includeSerials || '').toLowerCase() === 'true';
        const products = await Product.find()
            .populate('category', 'name code')
            .sort({ createdAt: -1 })
            .lean();

        if (!includeSerials) {
            return res.status(200).json({ success: true, data: products });
        }

        // Attach available serial numbers only when explicitly requested (invoice/quotation forms)
        const productIds = products.map(p => p._id);
        const stockEntries = await StockEntry.find({
            product: { $in: productIds },
            hasSerialNumbers: true,
            'serialNumbers.0': { $exists: true },
        }).select('product serialNumbers').lean();

        const serialsByProduct = {};
        for (const entry of stockEntries) {
            const pid = entry.product.toString();
            if (!serialsByProduct[pid]) serialsByProduct[pid] = [];
            serialsByProduct[pid].push(...(entry.serialNumbers || []));
        }

        const enrichedProducts = products.map(p => ({
            ...p,
            availableSerials: serialsByProduct[p._id.toString()] || [],
        }));

        res.status(200).json({ success: true, data: enrichedProducts });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.updateProduct = async (req, res) => {
    try {
        // Prevent direct quantity manipulation — use stock entries
        const { quantity, reason, ...updateData } = req.body;
        const before = await Product.findById(req.params.id);
        if (!before) return res.status(404).json({ success: false, message: 'Product not found' });

        const product = await Product.findByIdAndUpdate(
            req.params.id,
            updateData,
            { new: true, runValidators: true }
        );

        await AuditLog.create({
            action: 'PRODUCT_EDIT',
            targetType: 'Product',
            targetId: product._id,
            targetName: product.name,
            details: { before: before.toObject(), after: product.toObject() },
            reason: reason || 'Direct edit by admin',
            performedBy: req.user._id
        });

        res.status(200).json({ success: true, data: product });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.deleteProduct = async (req, res) => {
    try {
        const product = await Product.findByIdAndDelete(req.params.id);
        if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
        // Cascade-delete associated stock entries
        await StockEntry.deleteMany({ product: req.params.id });
        res.status(200).json({ success: true, message: 'Product deleted successfully' });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

// ── STOCK ENTRY METHODS ───────────────────────────────────────────────────────

exports.addStockEntry = async (req, res) => {
    try {
        const productId = req.params.id;
        const {
            location,
            buyingPrice,
            quantity,
            warrantyPeriod,
            serialNumbers,
            notes,
            supplierRef,
            supplierInvoiceNumber,
            supplierDeliveryNumber,
        } = req.body;

        const product = await Product.findById(productId);
        if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

        const qty = parseInt(quantity, 10);
        if (isNaN(qty) || qty < 1) {
            return res.status(400).json({ success: false, message: 'Quantity must be a positive integer' });
        }

        // ── Store location validation ─────────────────────────────────────────
        if (location && location.trim()) {
            const biz = await BusinessDetails.findOne();
            const stores = biz?.stores || [];
            if (stores.length > 0) {
                const storeNames = stores.map(s => s.name.trim().toLowerCase());
                if (!storeNames.includes(location.trim().toLowerCase())) {
                    return res.status(400).json({
                        success: false,
                        message: `Invalid location. Available stores: ${stores.map(s => s.name).join(', ')}`
                    });
                }
            }
        }

        // ── Serial number validation ──────────────────────────────────────────
        let processedSerials = [];
        if (Array.isArray(serialNumbers) && serialNumbers.length > 0) {
            processedSerials = serialNumbers
                .map((s) => String(s).trim().toUpperCase())
                .filter(Boolean);

            // Duplicate check within submitted list
            const uniqueSet = new Set(processedSerials);
            if (uniqueSet.size !== processedSerials.length) {
                return res.status(400).json({
                    success: false,
                    message: 'Duplicate serial numbers found in the submitted list',
                });
            }

            // Count match check
            if (processedSerials.length !== qty) {
                return res.status(400).json({
                    success: false,
                    message: `Serial number count (${processedSerials.length}) must equal quantity (${qty})`,
                });
            }

            // Check against existing entries for this product
            const existingEntries = await StockEntry.find({ product: productId });
            const existingSerials = new Set(existingEntries.flatMap((e) => e.serialNumbers));
            const duplicates = processedSerials.filter((s) => existingSerials.has(s));
            if (duplicates.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: `These serial numbers already exist: ${duplicates.join(', ')}`,
                });
            }
        }

        // Generate unique batch reference
        const batchCount = await StockEntry.countDocuments({ product: productId });
        const batchRef = `${product.productId}-BATCH-${(batchCount + 1).toString().padStart(3, '0')}`;

        const entry = await StockEntry.create({
            product: productId,
            batchRef,
            location: location || '',
            buyingPrice: buyingPrice || 0,
            quantity: qty,
            warrantyPeriod: warrantyPeriod || '',
            serialNumbers: processedSerials,
            hasSerialNumbers: processedSerials.length > 0,
            supplierRef: supplierRef || null,
            supplierInvoiceNumber: supplierInvoiceNumber
                ? String(supplierInvoiceNumber).trim().toUpperCase()
                : '',
            supplierDeliveryNumber: supplierDeliveryNumber
                ? String(supplierDeliveryNumber).trim().toUpperCase()
                : '',
            notes: notes || '',
            addedBy: req.user._id,
        });

        // Atomically increment product quantity
        await Product.findByIdAndUpdate(productId, { $inc: { quantity: qty } });

        const populated = await StockEntry.findById(entry._id)
            .populate('addedBy', 'name username')
            .populate('supplierRef', 'name supplierId');
        res.status(201).json({ success: true, data: populated });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.getStockEntries = async (req, res) => {
    try {
        const entries = await StockEntry.find({ product: req.params.id })
            .populate('addedBy', 'name username')
            .populate('supplierRef', 'name supplierId')
            .sort({ createdAt: -1 });
        res.status(200).json({ success: true, data: entries });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

// ── STOCK ENTRY EDIT (admin/root only — direct) ───────────────────────────────

exports.updateStockEntry = async (req, res) => {
    try {
        const { reason, ...changes } = req.body;
        if (!reason) return res.status(400).json({ success: false, message: 'Reason for modification is required' });

        const entry = await StockEntry.findById(req.params.entryId);
        if (!entry) return res.status(404).json({ success: false, message: 'Stock entry not found' });

        const before = entry.toObject();

        // Prevent arbitrary product reassignment
        const allowed = ['location', 'buyingPrice', 'quantity', 'notes', 'serialNumbers'];
        allowed.forEach(f => { if (changes[f] !== undefined) entry[f] = changes[f]; });

        // Sync product-level quantity if quantity changed
        if (changes.quantity !== undefined) {
            const diff = changes.quantity - before.quantity;
            await Product.findByIdAndUpdate(entry.product, { $inc: { quantity: diff } });
        }

        await entry.save();

        await AuditLog.create({
            action: 'STOCK_EDIT',
            targetType: 'StockEntry',
            targetId: entry._id,
            targetName: entry.batchRef,
            details: { before, after: entry.toObject() },
            reason,
            performedBy: req.user._id
        });

        res.status(200).json({ success: true, data: entry });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

// ── INVENTORY EDIT REQUESTS (standard user → approval workflow) ────────────────

exports.createInventoryRequest = async (req, res) => {
    try {
        const { type, targetId, targetName, proposedChanges, reason } = req.body;
        if (!type || !targetId || !proposedChanges || !reason) {
            return res.status(400).json({ success: false, message: 'type, targetId, proposedChanges, and reason are required' });
        }

        const request = await InventoryEditRequest.create({
            type, targetId, targetName: targetName || '', proposedChanges, reason,
            requestedBy: req.user._id
        });

        // Notify all admins/root users
        const admins = await User.find({ role: { $in: ['admin', 'root'] } });
        for (const admin of admins) {
            await createNotification(
                admin._id, 'inventory_request', 'Inventory Edit Request',
                `${req.user.firstName} ${req.user.lastName} submitted a ${type} edit request for "${targetName || targetId}". Reason: ${reason}`,
                request._id
            );
        }

        res.status(201).json({ success: true, message: 'Edit request submitted for approval', data: request });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.getInventoryRequests = async (req, res) => {
    try {
        const requests = await InventoryEditRequest.find({ status: 'Pending' })
            .populate('requestedBy', 'firstName lastName email')
            .sort({ createdAt: -1 });
        res.status(200).json({ success: true, data: requests });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.approveInventoryRequest = async (req, res) => {
    try {
        const request = await InventoryEditRequest.findById(req.params.requestId)
            .populate('requestedBy');
        if (!request || request.status !== 'Pending') {
            return res.status(404).json({ success: false, message: 'Pending request not found' });
        }

        const { type, targetId, proposedChanges, reason } = request;
        let before = null;

        if (type === 'Product') {
            const doc = await Product.findById(targetId);
            before = doc?.toObject();
            const { quantity, ...safe } = proposedChanges;
            await Product.findByIdAndUpdate(targetId, safe, { new: true, runValidators: true });
        } else if (type === 'Category') {
            const doc = await Category.findById(targetId);
            before = doc?.toObject();
            await Category.findByIdAndUpdate(targetId, proposedChanges, { new: true, runValidators: true });
        } else if (type === 'StockEntry') {
            const doc = await StockEntry.findById(targetId);
            before = doc?.toObject();
            const allowed = ['location', 'buyingPrice', 'quantity', 'notes', 'serialNumbers'];
            const safe = {};
            allowed.forEach(f => { if (proposedChanges[f] !== undefined) safe[f] = proposedChanges[f]; });
            // sync product quantity if changed
            if (safe.quantity !== undefined && doc) {
                const diff = safe.quantity - doc.quantity;
                await Product.findByIdAndUpdate(doc.product, { $inc: { quantity: diff } });
            }
            await StockEntry.findByIdAndUpdate(targetId, safe, { new: true });
        }

        request.status = 'Approved';
        request.reviewedBy = req.user._id;
        request.reviewedAt = Date.now();
        await request.save();

        await AuditLog.create({
            action: 'INVENTORY_REQUEST_APPROVED',
            targetType: type,
            targetId,
            targetName: request.targetName,
            details: { before, proposedChanges, approvedBy: req.user._id },
            reason,
            performedBy: req.user._id
        });

        // Notify requester
        await createNotification(
            request.requestedBy._id, 'approval', 'Inventory Edit Approved',
            `Your edit request for "${request.targetName}" has been approved by ${req.user.firstName} ${req.user.lastName}.`
        );

        res.status(200).json({ success: true, message: 'Inventory edit applied and logged' });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.rejectInventoryRequest = async (req, res) => {
    try {
        const request = await InventoryEditRequest.findById(req.params.requestId)
            .populate('requestedBy');
        if (!request || request.status !== 'Pending') {
            return res.status(404).json({ success: false, message: 'Pending request not found' });
        }

        request.status = 'Rejected';
        request.reviewedBy = req.user._id;
        request.reviewedAt = Date.now();
        await request.save();

        await AuditLog.create({
            action: 'INVENTORY_REQUEST_REJECTED',
            targetType: request.type,
            targetId: request.targetId,
            targetName: request.targetName,
            details: { proposedChanges: request.proposedChanges },
            reason: request.reason,
            performedBy: req.user._id
        });

        await createNotification(
            request.requestedBy._id, 'rejection', 'Inventory Edit Rejected',
            `Your edit request for "${request.targetName}" has been rejected by ${req.user.firstName} ${req.user.lastName}.`
        );

        res.status(200).json({ success: true, message: 'Inventory edit request rejected' });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

