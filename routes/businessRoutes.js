const express = require('express');
const businessController = require('../controllers/businessController');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// Protect all routes
router.use(authMiddleware.protect);

// GET is accessible by both Admin and Root
router.get('/', businessController.getDetails);

// UPDATE is restricted to ROOT only
router.patch('/', authMiddleware.restrictTo('root'), businessController.updateDetails);

module.exports = router;
