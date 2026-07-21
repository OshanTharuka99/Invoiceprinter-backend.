const express = require('express');
const router = express.Router();
const salesReturnController = require('../controllers/salesReturnController');
const { protect, restrictTo } = require('../middleware/auth');

router.use(protect);
router.use(restrictTo('admin', 'root'));

router.get('/', salesReturnController.getSalesReturns);
router.get('/source', salesReturnController.getSourceDocument);
router.post('/', salesReturnController.createSalesReturn);
router.put('/:id/edit', salesReturnController.editSalesReturn);
router.delete('/:id', salesReturnController.cancelSalesReturn);

module.exports = router;
