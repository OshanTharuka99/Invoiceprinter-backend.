const express = require('express');
const router = express.Router();
const deliveryNoteController = require('../controllers/deliveryNoteController');
const { protect, restrictTo } = require('../middleware/auth');

router.use(protect);

router.route('/')
    .get(deliveryNoteController.getDeliveryNotes)
    .post(deliveryNoteController.createDeliveryNote);

router.route('/:id')
    .get(deliveryNoteController.getDeliveryNoteById)
    .put(deliveryNoteController.updateDeliveryNote)
    .delete(restrictTo('admin', 'root'), deliveryNoteController.deleteDeliveryNote);

router.put('/:id/deliver', deliveryNoteController.deliverDeliveryNote);
router.get('/:id/for-invoice', deliveryNoteController.getDeliveryNoteForInvoice);

module.exports = router;
