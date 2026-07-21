const express = require('express');
const router = express.Router();
const rmaController = require('../controllers/rmaController');
const { protect, restrictTo } = require('../middleware/auth');

router.use(protect);

router.get('/users', rmaController.getOrgUsers);
router.get('/lookup/:serial', rmaController.lookupBySerial);
router.get('/faulty', restrictTo('admin', 'root'), rmaController.getFaultyDevices);
router.delete('/faulty/:id', restrictTo('admin', 'root'), rmaController.removeFaultyDevice);

router.get('/', rmaController.getRmaJobs);
router.post('/', rmaController.createRmaJob);
router.get('/:id', rmaController.getRmaJobById);
router.put('/:id/assignees', rmaController.addAssignees);
router.post('/:id/status', rmaController.addStatusUpdate);
router.put('/:id/diagnosis', rmaController.setDiagnosis);
router.put('/:id/replace', rmaController.replaceDevice);
router.put('/:id/signature', rmaController.setCustomerSignature);

module.exports = router;
