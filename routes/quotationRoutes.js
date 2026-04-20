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


// Standard General Routes
router.route('/')
    .get(quotationController.getQuotations)
    .post(quotationController.createQuotation);

router.route('/:id')
    .put(quotationController.updateQuotation)
    .delete(restrictTo('admin', 'root'), quotationController.deleteQuotation); // Restricted Delete Protocol

router.route('/:id/request-delete')
    .post(quotationController.requestDelete);

module.exports = router;
