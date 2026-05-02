const express = require('express');
const router = express.Router();
const warrantyController = require('../controllers/warrantyController');
const { protect, restrictTo } = require('../middleware/auth');

router.use(protect);

router.route('/')
    .get(warrantyController.getWarranties);

router.route('/:id')
    .get(warrantyController.getWarrantyById)
    .patch(restrictTo('admin', 'root'), warrantyController.updateWarrantyStatus);

module.exports = router;
