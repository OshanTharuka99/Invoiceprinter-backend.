const mongoose = require('mongoose');

const businessDetailsSchema = new mongoose.Schema({
    businessName: {
        type: String,
        required: [true, 'Business Name is required'],
        trim: true
    },
    businessType: {
        type: String,
        enum: ['Owner', 'Partnership', 'Pvt Ltd'],
        default: 'Owner'
    },
    registrationNumber: {
        type: String,
        trim: true
    },
    address: {
        type: String,
        trim: true
    },
    phoneNumber: {
        type: String,
        trim: true
    },
    email: {
        type: String,
        trim: true,
        lowercase: true
    },
    fax: {
        type: String,
        trim: true
    },
    country: {
        type: String,
        default: 'Sri Lanka'
    },
    city: {
        type: String,
        trim: true
    },
    primaryCurrency: {
        code: { type: String, default: 'LKR' },
        symbol: { type: String, default: 'Rs.' }
    },
    secondaryCurrency: {
        code: { type: String, default: 'USD' },
        symbol: { type: String, default: '$' }
    },
    // Tax Configuration
    isVatRegistered: {
        type: Boolean,
        default: false
    },
    vatNumber: {
        type: String,
        trim: true
    },
    vatPercentage: {
        type: Number,
        default: 18
    },
    otherTaxes: [{
        name: String,
        type: {
            type: String,
            enum: ['percentage', 'fixed'],
            default: 'percentage'
        },
        value: {
            type: Number,
            default: 0
        }
    }],
    // Discount Configuration
    discountProfiles: [{
        name: String,
        type: {
            type: String,
            enum: ['percentage', 'fixed'],
            default: 'percentage'
        },
        value: {
            type: Number,
            default: 0
        },
        minBillAmount: {
            type: Number,
            default: 0
        }
    }],
    quotationLogo: {
        type: String // We will store this as a Base64 string for simplicity
    },
    quotationTerms: {
        type: String,
        trim: true,
        default: 'Standard terms and conditions apply.'
    },
    quotationNotes: {
        type: String,
        trim: true,
        default: ''
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('BusinessDetails', businessDetailsSchema);
