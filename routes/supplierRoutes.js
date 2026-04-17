const express = require('express');
const router = express.Router();
const supplierController = require('../controllers/supplierController');
const { protect, restrictTo } = require('../middleware/auth');

router.use(protect);
router.use(restrictTo('admin', 'root')); // fully restricted

router.route('/')
    .get(supplierController.getSuppliers)
    .post(supplierController.createSupplier);

router.route('/:id')
    .put(supplierController.updateSupplier)
    .delete(supplierController.deleteSupplier);

module.exports = router;
