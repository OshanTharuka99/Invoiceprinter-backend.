const express = require('express');
const router = express.Router();
const goodsReturnController = require('../controllers/goodsReturnController');
const { protect, restrictTo } = require('../middleware/auth');

router.use(protect);
router.use(restrictTo('admin', 'root'));

router.get('/', goodsReturnController.getGoodsReturns);
router.get('/source', goodsReturnController.getSourceDocument);
router.post('/', goodsReturnController.createGoodsReturn);
router.put('/:id/edit', goodsReturnController.editGoodsReturn);
router.delete('/:id', goodsReturnController.cancelGoodsReturn);

module.exports = router;
