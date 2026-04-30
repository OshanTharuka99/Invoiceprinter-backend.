const mongoose = require('mongoose');

const productSchema = new mongoose.Schema(
    {
        productId: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            uppercase: true,
        },
        name: {
            type: String,
            required: [true, 'Product Name/Brand and Model is required'],
            trim: true,
        },
        category: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Category',
            required: [true, 'Product must belong to a category'],
        },
        price: {
            type: Number,
            required: [true, 'Price is required'],
            min: 0,
        },
        currencyType: {
            type: String,
            enum: ['primary', 'secondary'],
            default: 'primary',
        },
        isTaxIncluded: {
            type: Boolean,
            default: false,
        },
        quantity: {
            type: Number,
            default: 0,
            min: 0,
        },
        // New fields
        description: {
            type: String,
            trim: true,
            default: '',
        },
        warrantyPeriod: {
            type: String,
            trim: true,
            default: '',
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model('Product', productSchema);
