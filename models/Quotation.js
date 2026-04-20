const mongoose = require('mongoose');

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
        name: { type: String, trim: true },
        address: { type: String, trim: true },
        telephoneNumber: { type: String, trim: true },
        emailAddress: { type: String, trim: true }
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
    hasDiscount: { type: Boolean, default: false },
    discountType: { type: String, enum: ['percentage', 'fixed', 'none'], default: 'none' },
    discountValue: { type: Number, default: 0 },
    hasTax: { type: Boolean, default: false },
    taxName: { type: String, default: 'VAT' },
    taxPercentage: { type: Number, default: 0 },
    finalTotal: { type: Number, required: true, min: 0 },
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
