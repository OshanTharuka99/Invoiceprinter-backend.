const express = require('express');
const router = express.Router();
const projectController = require('../controllers/projectController');
const { protect, restrictTo } = require('../middleware/auth');

router.use(protect);

router.route('/')
    .get(projectController.getProjects)
    .post(restrictTo('admin', 'root'), projectController.createProject);

router.route('/:id')
    .put(restrictTo('admin', 'root'), projectController.updateProject)
    .delete(restrictTo('admin', 'root'), projectController.deleteProject);

module.exports = router;
