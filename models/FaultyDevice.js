const mongoose = require('mongoose');

const faultyDeviceSchema = new mongoose.Schema({
    serialNumber: { type: String, required: true, trim: true, uppercase: true },
    productRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
    productName: { type: String, trim: true, default: '' },
    rmaRef: { type: mongoose.Schema.Types.ObjectId, ref: 'RmaJob', default: null },
    jobNumber: { type: String, trim: true, default: '' },
    buyingPrice: { type: Number, default: 0, min: 0 },
    stockEntryRef: { type: mongoose.Schema.Types.ObjectId, ref: 'StockEntry', default: null },
    status: {
        type: String,
        enum: ['faulty', 'removed'],
        default: 'faulty',
    },
    faultySince: { type: Date, default: Date.now },
    autoRemoveAt: { type: Date, required: true },
    lossAmount: { type: Number, default: 0, min: 0 },
    notes: { type: String, trim: true, default: '' },
    removeNote: { type: String, trim: true, default: '' },
    removedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    removedAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

faultyDeviceSchema.index({ status: 1, autoRemoveAt: 1 });
faultyDeviceSchema.index({ serialNumber: 1 });

module.exports = mongoose.model('FaultyDevice', faultyDeviceSchema);
