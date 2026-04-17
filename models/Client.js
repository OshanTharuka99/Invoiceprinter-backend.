const mongoose = require('mongoose');

const clientSchema = new mongoose.Schema({
    clientId: {
        type: String,
        unique: true,
        required: true,
        uppercase: true
    },
    firstName: {
        type: String,
        required: true,
        trim: true
    },
    lastName: {
        type: String,
        trim: true,
        default: ''
    },
    clientType: {
        type: String,
        enum: ['Business', 'Organization', 'Person'],
        required: true
    },
    telephoneNumber: { type: String, trim: true },
    whatsappNumber: { type: String, trim: true },
    address: { type: String, trim: true },
    emailAddress: { type: String, trim: true, lowercase: true }
}, {
    timestamps: true
});

clientSchema.pre('validate', function(next) {
    if (!this.telephoneNumber && !this.whatsappNumber && !this.address && !this.emailAddress) {
        this.invalidate('contact', 'At least one contact method (Telephone, WhatsApp, Address, or Email) must be provided.');
    }
    next();
});

module.exports = mongoose.model('Client', clientSchema);
