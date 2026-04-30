const Product = require('../models/Product');
const Category = require('../models/Category');
const StockEntry = require('../models/StockEntry');

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
        const category = await Category.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true, runValidators: true }
        );
        if (!category) return res.status(404).json({ success: false, message: 'Category not found' });
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
        const products = await Product.find().populate('category').sort({ createdAt: -1 });
        res.status(200).json({ success: true, data: products });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.updateProduct = async (req, res) => {
    try {
        // Prevent direct quantity manipulation — use stock entries
        const { quantity, ...updateData } = req.body;
        const product = await Product.findByIdAndUpdate(
            req.params.id,
            updateData,
            { new: true, runValidators: true }
        );
        if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
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
        const { location, buyingPrice, quantity, warrantyPeriod, serialNumbers, notes } = req.body;

        const product = await Product.findById(productId);
        if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

        const qty = parseInt(quantity, 10);
        if (isNaN(qty) || qty < 1) {
            return res.status(400).json({ success: false, message: 'Quantity must be a positive integer' });
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
            notes: notes || '',
            addedBy: req.user._id,
        });

        // Atomically increment product quantity
        await Product.findByIdAndUpdate(productId, { $inc: { quantity: qty } });

        const populated = await StockEntry.findById(entry._id).populate('addedBy', 'name username');
        res.status(201).json({ success: true, data: populated });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.getStockEntries = async (req, res) => {
    try {
        const entries = await StockEntry.find({ product: req.params.id })
            .populate('addedBy', 'name username')
            .sort({ createdAt: -1 });
        res.status(200).json({ success: true, data: entries });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};
