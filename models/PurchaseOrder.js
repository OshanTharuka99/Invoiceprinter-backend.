const mongoose = require('mongoose');

const appliedDiscountSchema = new mongoose.Schema({
    name: { type: String, required: true },
    type: { type: String, enum: ['percentage', 'fixed'], required: true },
    value: { type: Number, required: true },
    amount: { type: Number, default: 0 }
}, { _id: false });

const appliedTaxSchema = new mongoose.Schema({
    name: { type: String, required: true },
    type: { type: String, enum: ['percentage', 'fixed'], default: 'percentage' },
    value: { type: Number, required: true },
    amount: { type: Number, default: 0 }
}, { _id: false });

const purchaseOrderSchema = new mongoose.Schema({
    poNumber: {
        type: String,
        required: true,
        unique: true,
        uppercase: true // PO00001 format (5 digits)
    },
    creationMethod: {
        type: String,
        enum: ['automatic', 'manual'],
        required: true
    },
    supplierRef: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Supplier',
        required: true
    },
    supplierQuotationNumber: {
        type: String,
        trim: true,
        required: true
    },
    deliveryAddress: {
        type: String,
        trim: true,
        required: true
    },
    deliveryType: {
        type: String,
        enum: ['Organization', 'Store'],
        default: 'Organization'
    },
    selectedStoreRef: {
        type: String, // Store name/id if selected
        trim: true
    },
    items: [{
        productRef: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Product'
        },
        manualName: { type: String, trim: true },
        quantity: { type: Number, required: true, min: 1 },
        unitPrice: { type: Number, required: true, min: 0 },
        lineTotal: { type: Number, required: true, min: 0 }
    }],
    subTotal: { type: Number, required: true, min: 0 },
    appliedDiscounts: [appliedDiscountSchema],
    discountTotal: { type: Number, default: 0 },
    hasTax: { type: Boolean, default: false },
    appliedTaxes: [appliedTaxSchema],
    taxTotal: { type: Number, default: 0 },
    finalTotal: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'primary' },
    status: {
        type: String,
        enum: ['Draft', 'Sent', 'Approved', 'Rejected', 'Completed'],
        default: 'Draft'
    },
    poDate: {
        type: Date,
        default: Date.now
    },
    terms: {
        type: String,
        trim: true
    },
    notes: {
        type: String,
        trim: true
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('PurchaseOrder', purchaseOrderSchema);
