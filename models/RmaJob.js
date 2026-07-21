const mongoose = require('mongoose');

const statusHistorySchema = new mongoose.Schema({
    status: { type: String, trim: true, required: true },
    note: { type: String, trim: true, default: '' },
    editedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    editedAt: { type: Date, default: Date.now },
}, { _id: false });

const rmaJobSchema = new mongoose.Schema({
    jobNumber: { type: String, required: true, unique: true, uppercase: true, trim: true },
    serialNumber: { type: String, required: true, trim: true, uppercase: true },
    productRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
    productName: { type: String, trim: true, default: '' },
    warrantyRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Warranty', default: null },
    underWarranty: { type: Boolean, default: false },
    warrantyPeriod: { type: String, trim: true, default: '' },
    warrantyStartDate: { type: Date, default: null },
    warrantyExpiryDate: { type: Date, default: null },
    invoiceRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', default: null },
    invoiceNumber: { type: String, trim: true, default: '' },

    clientRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', default: null },
    customerDetails: {
        name: { type: String, trim: true, default: '' },
        telephoneNumber: { type: String, trim: true, default: '' },
        emailAddress: { type: String, trim: true, default: '' },
        idCardNumber: { type: String, trim: true, default: '' },
        destination: { type: String, trim: true, default: '' },
        address: { type: String, trim: true, default: '' },
    },

    projectRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', default: null },
    projectDetails: {
        projectId: { type: String, trim: true, default: '' },
        name: { type: String, trim: true, default: '' },
        location: { type: String, trim: true, default: '' },
    },

    supplierRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', default: null },
    supplierDetails: {
        name: { type: String, trim: true, default: '' },
        telephoneNumber: { type: String, trim: true, default: '' },
        emailAddress: { type: String, trim: true, default: '' },
        address: { type: String, trim: true, default: '' },
    },

    assignees: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    faultComment: { type: String, trim: true, default: '' },
    diagnosis: { type: String, trim: true, default: '' },

    status: {
        type: String,
        enum: ['Open', 'In Progress', 'Awaiting Supplier', 'Resolved', 'Closed', 'Cancelled'],
        default: 'Open',
    },
    statusHistory: [statusHistorySchema],

    replacement: {
        replaced: { type: Boolean, default: false },
        source: { type: String, enum: ['stock', 'supplier', ''], default: '' },
        oldSerialNumber: { type: String, trim: true, uppercase: true, default: '' },
        newSerialNumber: { type: String, trim: true, uppercase: true, default: '' },
        newWarrantyPeriod: { type: String, trim: true, default: '' },
        newWarrantyStartDate: { type: Date, default: null },
        newWarrantyExpiryDate: { type: Date, default: null },
        buyingPrice: { type: Number, default: 0, min: 0 },
        newWarrantyRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Warranty', default: null },
        faultyDeviceRef: { type: mongoose.Schema.Types.ObjectId, ref: 'FaultyDevice', default: null },
    },

    customerSignature: {
        collected: { type: Boolean, default: false },
        customerName: { type: String, trim: true, default: '' },
        idCardNumber: { type: String, trim: true, default: '' },
        destination: { type: String, trim: true, default: '' },
        signedAt: { type: Date, default: null },
    },

    terms: { type: String, trim: true, default: '' },
    notes: { type: String, trim: true, default: '' },
    overdueNotifiedAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

rmaJobSchema.index({ serialNumber: 1 });
rmaJobSchema.index({ status: 1 });
rmaJobSchema.index({ createdAt: -1 });

module.exports = mongoose.model('RmaJob', rmaJobSchema);
