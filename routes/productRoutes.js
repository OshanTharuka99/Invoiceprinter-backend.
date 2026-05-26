const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const { protect, restrictTo } = require('../middleware/auth');

// All routes require authentication
router.use(protect);

// ── Inventory Edit Requests (all authenticated, approval by admin/root) ────────
router.route('/inventory-requests')
    .get(restrictTo('admin', 'root'), productController.getInventoryRequests)
    .post(productController.createInventoryRequest);

router.put('/inventory-requests/:requestId/approve', restrictTo('admin', 'root'), productController.approveInventoryRequest);
router.put('/inventory-requests/:requestId/reject', restrictTo('admin', 'root'), productController.rejectInventoryRequest);

// ── Categories ────────────────────────────────────────────────────────────────
router.route('/categories')
    .get(productController.getCategories)
    .post(productController.createCategory);

router.route('/categories/:id')
    .put(restrictTo('admin', 'root'), productController.updateCategory)
    .delete(restrictTo('admin', 'root'), productController.deleteCategory);

// ── Products ──────────────────────────────────────────────────────────────────
router.route('/')
    .get(productController.getProducts)
    .post(productController.createProduct);

router.route('/:id')
    .put(restrictTo('admin', 'root'), productController.updateProduct)
    .delete(restrictTo('admin', 'root'), productController.deleteProduct);

// ── Stock Entries (all authenticated users) ────────────────────────────────────
router.route('/:id/stock')
    .get(productController.getStockEntries)
    .post(productController.addStockEntry);

// ── Stock Entry Edit (admin/root only — direct) ───────────────────────────────
router.patch('/:id/stock/:entryId', restrictTo('admin', 'root'), productController.updateStockEntry);

module.exports = router;
