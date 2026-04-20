const mongoose = require('mongoose');

const quotationDeleteRequestSchema = new mongoose.Schema({
    quotation: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Quotation',
        required: true
    },
    requestedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    reason: {
        type: String,
        required: true,
        trim: true
    },
    status: {
        type: String,
        enum: ['Pending', 'Approved', 'Rejected'],
        default: 'Pending'
    },
    reviewedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    reviewedAt: {
        type: Date
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('QuotationDeleteRequest', quotationDeleteRequestSchema);
