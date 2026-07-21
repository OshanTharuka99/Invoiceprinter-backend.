const mongoose = require('mongoose');

const deliveryNoteSchema = new mongoose.Schema({
    deliveryNoteNumber: {
        type: String,
        required: true,
        unique: true,
        uppercase: true
    },
    creationMethod: {
        type: String,
        enum: ['automatic', 'manual'],
        default: 'automatic'
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
    deliveryType: {
        type: String,
        enum: ['Client', 'Store', 'Organization'],
        default: 'Client'
    },
    selectedStoreRef: {
        type: String,
        trim: true
    },
    deliveryAddress: {
        type: String,
        trim: true,
        default: ''
    },
    items: [{
        productRef: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Product'
        },
        manualName: { type: String, trim: true },
        quantity: { type: Number, required: true, min: 0 },
        unitCost: { type: Number, default: 0, min: 0 },
        serialNumbers: [{ type: String, trim: true }]
    }],
    terms: {
        type: String,
        trim: true,
        default: ''
    },
    notes: {
        type: String,
        trim: true,
        default: ''
    },
    customerPORef: {
        type: String,
        trim: true,
        default: ''
    },
    customerName: {
        type: String,
        trim: true,
        default: ''
    },
    customerIdNumber: {
        type: String,
        trim: true,
        default: ''
    },
    deliveryDate: {
        type: Date,
        default: null
    },
    status: {
        type: String,
        enum: ['Draft', 'Delivered'],
        default: 'Draft'
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    history: [{
        action: { type: String, required: true },
        changes: { type: String, trim: true, default: '' },
        from: { type: String, default: '' },
        to: { type: String, default: '' },
        editedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        editedAt: { type: Date, default: Date.now }
    }]
}, {
    timestamps: true
});

module.exports = mongoose.model('DeliveryNote', deliveryNoteSchema);
