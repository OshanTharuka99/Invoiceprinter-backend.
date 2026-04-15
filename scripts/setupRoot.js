const mongoose = require('mongoose');
const User = require('../models/User');
require('dotenv').config({ path: './.env' });

const setupRoot = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('MongoDB connected...');

        // 1. Update existing admin to root
        const existingAdmin = await User.findOneAndUpdate(
            { email: 'admin@invoprint.com' },
            { role: 'root' },
            { new: true }
        );

        if (existingAdmin) {
            console.log(`Updated ${existingAdmin.email} to ROOT role.`);
        } else {
            console.log('Original admin not found.');
        }

        // 2. Create new admin
        const newAdminEmail = 'superadmin@invoprint.com';
        const existingNewAdmin = await User.findOne({ email: newAdminEmail });

        if (!existingNewAdmin) {
            const newAdmin = await User.create({
                email: newAdminEmail,
                password: 'superadminPassword123!',
                firstName: 'Super',
                lastName: 'Admin',
                designation: 'Finance Manager',
                role: 'admin',
                sex: 'male',
                telephoneNumber: '0771234567'
            });
            console.log(`Created new Admin: ${newAdmin.email}`);
        } else {
            console.log('New admin already exists.');
        }

        mongoose.connection.close();
        console.log('Setup complete.');
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

setupRoot();
