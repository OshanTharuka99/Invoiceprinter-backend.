const express = require('express');
const userController = require('../controllers/userController');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// Protect all routes after this middleware
router.use(authMiddleware.protect);

// Only admin can access these routes
router.use(authMiddleware.restrictTo('admin'));

router.get('/', userController.getAllUsers);
router.delete('/:id', userController.deleteUser);
router.patch('/:id/role', userController.updateUserRole);

module.exports = router;
