const express = require('express');
const router = express.Router();
const { getInvoices, createInvoice, getInvoiceById, updateInvoice, deleteInvoice } = require('../controllers/invoiceController');

router.get('/', getInvoices);
router.post('/', createInvoice);
router.get('/:id', getInvoiceById);
router.put('/:id', updateInvoice);
router.delete('/:id', deleteInvoice);

module.exports = router;
