const mongoose = require('mongoose');

const supplierSchema = new mongoose.Schema({
    supplierId: {
        type: String,
        required: true,
        unique: true,
        uppercase: true
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    telephoneNumber: {
        type: String,
        trim: true
    },
    emailAddress: {
        type: String,
        trim: true,
        lowercase: true
    },
    address: {
        type: String,
        trim: true
    },
    bankDetails: {
        accountNumber: { type: String, trim: true },
        accountName: { type: String, trim: true },
        bankName: { type: String, trim: true },
        branch: { type: String, trim: true }
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('Supplier', supplierSchema);
