const Product = require('../models/Product');
const Category = require('../models/Category');

// Category Methods
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
}

exports.updateCategory = async (req, res) => {
    try {
        const category = await Category.findByIdAndUpdate(req.params.id, req.body, {
            new: true,
            runValidators: true
        });
        if (!category) {
            return res.status(404).json({ success: false, message: 'Category not found' });
        }
        res.status(200).json({ success: true, data: category });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

// Product Methods
exports.createProduct = async (req, res) => {
    try {
        const { name, category, price, currencyType, isTaxIncluded } = req.body;
        
        const categoryDoc = await Category.findById(category);
        if (!categoryDoc) {
            return res.status(404).json({ success: false, message: 'Category not found' });
        }

        const codePrefix = categoryDoc.code.toUpperCase();
        
        // Find the latest product for this category
        const latestProduct = await Product.findOne({
            productId: { $regex: `^${codePrefix}` }
        }).sort({ productId: -1 });

        let sequence = 1;
        if (latestProduct) {
            const lastSequenceStr = latestProduct.productId.replace(codePrefix, '');
            const lastSequence = parseInt(lastSequenceStr, 10);
            if (!isNaN(lastSequence)) {
                sequence = lastSequence + 1;
            }
        }
        
        const productId = `${codePrefix}${sequence.toString().padStart(5, '0')}`;

        const product = await Product.create({
            productId,
            name,
            category,
            price,
            currencyType,
            isTaxIncluded,
            quantity: req.body.quantity || 0
        });

        res.status(201).json({ success: true, data: product });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.getProducts = async (req, res) => {
    try {
        const products = await Product.find().populate('category');
        res.status(200).json({ success: true, data: products });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.updateProduct = async (req, res) => {
    try {
        const product = await Product.findByIdAndUpdate(req.params.id, req.body, {
            new: true,
            runValidators: true
        });
        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }
        res.status(200).json({ success: true, data: product });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.deleteProduct = async (req, res) => {
    try {
        const product = await Product.findByIdAndDelete(req.params.id);
        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }
        res.status(200).json({ success: true, message: 'Product deleted successfully' });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};
