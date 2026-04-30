const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const { protect, restrictTo } = require('../middleware/auth');

// All routes require authentication
router.use(protect);

// ── Categories ────────────────────────────────────────────────────────────────
router.route('/categories')
    .get(productController.getCategories)
    .post(restrictTo('admin', 'root'), productController.createCategory);

router.route('/categories/:id')
    .put(restrictTo('admin', 'root'), productController.updateCategory)
    .delete(restrictTo('admin', 'root'), productController.deleteCategory);

// ── Products ──────────────────────────────────────────────────────────────────
router.route('/')
    .get(productController.getProducts)
    .post(restrictTo('admin', 'root'), productController.createProduct);

router.route('/:id')
    .put(restrictTo('admin', 'root'), productController.updateProduct)
    .delete(restrictTo('admin', 'root'), productController.deleteProduct);

// ── Stock Entries (all authenticated users) ────────────────────────────────────
router.route('/:id/stock')
    .get(productController.getStockEntries)
    .post(productController.addStockEntry);

module.exports = router;
