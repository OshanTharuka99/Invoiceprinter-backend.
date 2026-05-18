const express = require('express');
const router = express.Router();
const supplierController = require('../controllers/supplierController');
const { protect, restrictTo } = require('../middleware/auth');

router.use(protect);

router.route('/')
    .get(supplierController.getSuppliers)
    .post(supplierController.createSupplier);

router.route('/:id')
    .put(restrictTo('admin', 'root'), supplierController.updateSupplier)
    .delete(restrictTo('admin', 'root'), supplierController.deleteSupplier);

module.exports = router;
