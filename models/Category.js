const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Category Name is required'],
        trim: true,
        unique: true
    },
    code: {
        type: String,
        required: [true, 'Category Code is required'],
        trim: true,
        unique: true,
        uppercase: true,
        maxlength: 10
    },
    parentCategory: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category',
        default: null
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('Category', categorySchema);
