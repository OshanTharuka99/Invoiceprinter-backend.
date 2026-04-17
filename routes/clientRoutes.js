const express = require('express');
const router = express.Router();
const clientController = require('../controllers/clientController');
const { protect, restrictTo } = require('../middleware/auth');

router.use(protect);

// Edit Request Routes (Admin)
router.route('/requests')
    .get(restrictTo('admin', 'root'), clientController.getEditRequests);

router.route('/requests/:requestId/approve')
    .put(restrictTo('admin', 'root'), clientController.approveEditRequest);

router.route('/requests/:requestId/reject')
    .put(restrictTo('admin', 'root'), clientController.rejectEditRequest);

// Client Routes
router.route('/')
    .get(clientController.getClients)
    .post(clientController.createClient); // Anyone can create

router.route('/:id')
    .put(restrictTo('admin', 'root'), clientController.updateClientDirectly)
    .delete(restrictTo('admin', 'root'), clientController.deleteClient);

router.route('/:id/request-edit')
    .post(clientController.requestEdit); // Normal users suggest edits

module.exports = router;
