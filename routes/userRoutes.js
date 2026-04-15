const express = require('express');
const userController = require('../controllers/userController');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// Protect all routes after this middleware
router.use(authMiddleware.protect);

// All authenticated users can change their own password
router.post('/change-password', userController.changePassword);

// Only admin and root can access these routes
router.use(authMiddleware.restrictTo('admin', 'root'));

router.get('/', userController.getAllUsers);
router.post('/', userController.createUser);
router.delete('/:id', userController.deleteUser);
router.patch('/:id', userController.updateUser);
router.patch('/:id/role', userController.updateUserRole);

module.exports = router;
