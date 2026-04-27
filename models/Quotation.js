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

const quotationSchema = new mongoose.Schema({
    quotationId: {
        type: String,
        required: true,
        unique: true,
        uppercase: true // QN00000 format
    },
    creationMethod: {
        type: String,
        enum: ['automatic', 'manual'],
        required: true
    },
    clientRef: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Client'
    },
    manualClientDetails: {
        title: { type: String, default: 'Mr' },
        organization: { type: String, trim: true, default: '' },
        name: { type: String, trim: true },
        address: { type: String, trim: true },
        telephoneNumber: { type: String, trim: true },
        emailAddress: { type: String, trim: true }
    },
    projectId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Project'
    },
    items: [{
        productRef: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Product'
        },
        manualName: { type: String, trim: true },
        quantity: { type: Number, required: true, min: 0 },
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
    validDate: { type: Date, default: null },
    currency: { type: String, default: 'primary' },
    status: {
        type: String,
        enum: ['Draft', 'Sent', 'Approved', 'Rejected'],
        default: 'Draft'
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('Quotation', quotationSchema);
