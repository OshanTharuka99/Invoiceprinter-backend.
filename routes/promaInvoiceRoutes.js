const express = require('express');
const router = express.Router();
const promaInvoiceController = require('../controllers/promaInvoiceController');
const { protect, restrictTo } = require('../middleware/auth');

router.use(protect);

router.route('/')
    .get(promaInvoiceController.getPromaInvoices)
    .post(promaInvoiceController.createPromaInvoice);

router.route('/:id/status')
    .patch(promaInvoiceController.updatePromaInvoiceStatus);

router.route('/:id/cancel')
    .put(promaInvoiceController.cancelPromaInvoice);

router.route('/:id')
    .get(promaInvoiceController.getPromaInvoiceById)
    .delete(restrictTo('admin', 'root'), promaInvoiceController.deletePromaInvoice);

module.exports = router;
