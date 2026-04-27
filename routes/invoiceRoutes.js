const express = require('express');
const router = express.Router();
const invoiceController = require('../controllers/invoiceController');
const { protect, restrictTo } = require('../middleware/auth');

router.use(protect);

// Admin Handling for Deletion Requests
router.route('/delete-requests')
    .get(restrictTo('admin', 'root'), invoiceController.getDeleteRequests);

router.route('/delete-requests/:requestId/approve')
    .put(restrictTo('admin', 'root'), invoiceController.approveDeleteRequest);

router.route('/delete-requests/:requestId/reject')
    .put(restrictTo('admin', 'root'), invoiceController.rejectDeleteRequest);

// Standard General Routes
router.route('/')
    .get(invoiceController.getInvoices)
    .post(invoiceController.createInvoice);

router.route('/:id')
    .get(invoiceController.getInvoiceById)
    .patch(invoiceController.updateInvoice)
    .delete(restrictTo('admin', 'root'), invoiceController.deleteInvoice);

router.route('/:id/request-delete')
    .post(invoiceController.requestDelete);

module.exports = router;
