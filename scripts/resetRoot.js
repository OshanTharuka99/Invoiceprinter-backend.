const mongoose = require('mongoose');
const User = require('../models/User');
require('dotenv').config({ path: './.env' });

const resetRoot = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('MongoDB connected...');

        const rootEmail = 'admin@invoprint.com';
        const newPassword = 'InvoPrintRoot@2026!';

        const rootUser = await User.findOne({ email: rootEmail });

        if (rootUser) {
            rootUser.password = newPassword;
            await rootUser.save();
            console.log(`Password for ${rootEmail} has been reset to: ${newPassword}`);
            console.log('NOTE: User will be forced to change this on next login if passwordChanged is false.');
        } else {
            console.log('Root user not found.');
        }

        mongoose.connection.close();
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

resetRoot();
