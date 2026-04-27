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
    telephoneNumber: { type: String, trim: true, default: '' },
    whatsappNumber: { type: String, trim: true, default: '' },
    address: { type: String, trim: true, default: '' },
    emailAddress: { type: String, trim: true, lowercase: true, default: '' }
}, {
    timestamps: true
});

module.exports = mongoose.model('Client', clientSchema);
