const mongoose = require('mongoose');

const inventoryEditRequestSchema = new mongoose.Schema({
    type: {
        type: String,
        required: true,
        enum: ['Product', 'Category', 'StockEntry']
    },
    targetId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true
    },
    targetName: {
        type: String,
        default: ''
    },
    proposedChanges: {
        type: Object,
        required: true
    },
    reason: {
        type: String,
        required: true
    },
    requestedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
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
}, { timestamps: true });

module.exports = mongoose.model('InventoryEditRequest', inventoryEditRequestSchema);
