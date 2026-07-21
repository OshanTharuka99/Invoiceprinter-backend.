const express = require('express');
const router = express.Router();
const quotationController = require('../controllers/quotationController');
const { protect, restrictTo } = require('../middleware/auth');

router.use(protect); // Secure perimeter

// Admin Handling for Deletion Requests
router.route('/delete-requests')
    .get(restrictTo('admin', 'root'), quotationController.getDeleteRequests);

router.route('/delete-requests/:requestId/approve')
    .put(restrictTo('admin', 'root'), quotationController.approveDeleteRequest);

router.route('/delete-requests/:requestId/reject')
    .put(restrictTo('admin', 'root'), quotationController.rejectDeleteRequest);


router.route('/lookup')
    .get(quotationController.lookupQuotation);

// Standard General Routes
router.route('/')
    .get(quotationController.getQuotations)
    .post(quotationController.createQuotation);

router.get('/:id/for-invoice', quotationController.getQuotationForInvoice);

router.route('/:id/request-delete')
    .post(quotationController.requestDelete);

router.route('/:id/edit')
    .put(restrictTo('root'), quotationController.editQuotation);

router.route('/:id')
    .put(quotationController.updateQuotation)
    .delete(restrictTo('admin', 'root'), quotationController.deleteQuotation); // Restricted Delete Protocol

module.exports = router;
