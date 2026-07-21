const mongoose = require('mongoose');

const stockEntrySchema = new mongoose.Schema(
    {
        product: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Product',
            required: [true, 'Product reference is required'],
            index: true,
        },
        batchRef: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            uppercase: true,
        },
        location: {
            type: String,
            trim: true,
            default: '',
        },
        buyingPrice: {
            type: Number,
            min: [0, 'Buying price cannot be negative'],
            default: 0,
        },
        quantity: {
            type: Number,
            required: [true, 'Quantity is required'],
            min: [0, 'Quantity cannot be negative'],
        },
        warrantyPeriod: {
            type: String,
            trim: true,
            default: '',
        },
        // Optional serial numbers — enforced unique per product at controller level
        serialNumbers: [
            {
                type: String,
                trim: true,
                uppercase: true,
            },
        ],
        hasSerialNumbers: {
            type: Boolean,
            default: false,
        },
        supplierRef: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Supplier',
            default: null,
        },
        supplierInvoiceNumber: {
            type: String,
            trim: true,
            uppercase: true,
            default: '',
            index: true,
        },
        supplierDeliveryNumber: {
            type: String,
            trim: true,
            uppercase: true,
            default: '',
            index: true,
        },
        notes: {
            type: String,
            trim: true,
            default: '',
        },
        addedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model('StockEntry', stockEntrySchema);
