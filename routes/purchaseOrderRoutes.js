const express = require('express');
const router = express.Router();
const purchaseOrderController = require('../controllers/purchaseOrderController');
const { protect, restrictTo } = require('../middleware/auth');

router.use(protect);

router.route('/')
    .get(purchaseOrderController.getPurchaseOrders)
    .post(purchaseOrderController.createPurchaseOrder);

router.route('/:id')
    .get(purchaseOrderController.getPurchaseOrderById)
    .put(purchaseOrderController.updatePurchaseOrder)
    .delete(restrictTo('admin', 'root'), purchaseOrderController.deletePurchaseOrder);

module.exports = router;
