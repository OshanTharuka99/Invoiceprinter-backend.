const mongoose = require('mongoose');

const salesReturnItemSchema = new mongoose.Schema({
    sourceItemKey: { type: String, trim: true, default: '' },
    productRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    manualName: { type: String, trim: true, default: '' },
    quantity: { type: Number, required: true, min: 0.0001 },
    unitPrice: { type: Number, default: 0, min: 0 },
    lineTotal: { type: Number, default: 0, min: 0 },
    serialNumbers: [{ type: String, trim: true, uppercase: true }],
}, { _id: false });

const salesReturnNoteSchema = new mongoose.Schema({
    returnNumber: { type: String, required: true, unique: true, uppercase: true, trim: true },
    returnDate: { type: Date, default: Date.now },
    sourceType: { type: String, enum: ['invoice', 'delivery_note'], required: true },
    sourceInvoiceRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', default: null },
    sourceDeliveryNoteRef: { type: mongoose.Schema.Types.ObjectId, ref: 'DeliveryNote', default: null },
    sourceNumber: { type: String, trim: true, default: '' },
    clientRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', default: null },
    manualClientDetails: {
        title: { type: String, default: 'Mr' },
        organization: { type: String, trim: true, default: '' },
        name: { type: String, trim: true, default: '' },
        address: { type: String, trim: true, default: '' },
        telephoneNumber: { type: String, trim: true, default: '' },
        emailAddress: { type: String, trim: true, default: '' },
    },
    paymentMethodAtSale: {
        type: String,
        enum: ['cash', 'cheque', 'bank_transfer', 'credit', 'unknown'],
        default: 'unknown',
    },
    items: [salesReturnItemSchema],
    returnStockLocation: { type: String, trim: true, default: '' },
    reason: { type: String, trim: true, default: '' },
    terms: { type: String, trim: true, default: '' },
    notes: { type: String, trim: true, default: '' },
    returnAmount: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ['Processed', 'Cancelled'], default: 'Processed' },
    originalInvoiceCancelled: { type: Boolean, default: false },
    replacementInvoiceRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', default: null },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    cancellationNote: { type: String, trim: true, default: '' },
    statusHistory: [{
        status: { type: String, trim: true },
        note: { type: String, trim: true, default: '' },
        editedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        editedAt: { type: Date, default: Date.now },
    }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

module.exports = mongoose.model('SalesReturnNote', salesReturnNoteSchema);
