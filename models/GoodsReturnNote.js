const mongoose = require('mongoose');

const goodsReturnItemSchema = new mongoose.Schema({
    stockEntryRef: { type: mongoose.Schema.Types.ObjectId, ref: 'StockEntry', default: null },
    productRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
    productName: { type: String, trim: true, default: '' },
    batchRef: { type: String, trim: true, default: '' },
    quantity: { type: Number, required: true, min: 0.0001 },
    unitCost: { type: Number, default: 0, min: 0 },
    lineTotal: { type: Number, default: 0, min: 0 },
    serialNumbers: [{ type: String, trim: true, uppercase: true }],
}, { _id: false });

const goodsReturnNoteSchema = new mongoose.Schema({
    returnNumber: { type: String, required: true, unique: true, uppercase: true, trim: true },
    returnDate: { type: Date, default: Date.now },
    sourceType: {
        type: String,
        enum: ['supplier_invoice', 'supplier_delivery'],
        required: true,
    },
    sourceNumber: { type: String, required: true, trim: true, uppercase: true },
    supplierRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', default: null },
    supplierName: { type: String, trim: true, default: '' },
    items: [goodsReturnItemSchema],
    reason: { type: String, trim: true, default: '' },
    terms: { type: String, trim: true, default: '' },
    notes: { type: String, trim: true, default: '' },
    returnAmount: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ['Processed', 'Cancelled'], default: 'Processed' },
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

module.exports = mongoose.model('GoodsReturnNote', goodsReturnNoteSchema);
