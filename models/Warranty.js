const mongoose = require('mongoose');

const warrantySchema = new mongoose.Schema({
    invoiceRef: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Invoice',
        required: true
    },
    clientRef: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Client',
        required: false
    },
    projectRef: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Project'
    },
    projectLocation: {
        type: String,
        trim: true,
        default: ''
    },
    productRef: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true
    },
    serialNumber: {
        type: String,
        required: true,
        trim: true,
        uppercase: true
    },
    warrantyPeriod: {
        type: String,
        trim: true,
        default: ''
    },
    startDate: {
        type: Date,
        required: true,
        default: Date.now
    },
    expiryDate: {
        type: Date,
        required: false
    },
    status: {
        type: String,
        enum: ['active', 'expired'],
        default: 'active'
    }
}, {
    timestamps: true
});

warrantySchema.index({ serialNumber: 1, productRef: 1 }, { unique: true });
warrantySchema.index({ expiryDate: 1 });
warrantySchema.index({ status: 1 });

module.exports = mongoose.model('Warranty', warrantySchema);
