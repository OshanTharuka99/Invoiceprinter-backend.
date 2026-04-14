const mongoose = require('mongoose');
const User = require('./models/User');
const fs = require('fs');
require('dotenv').config();

const users = [
    {
        email: 'admin@invoprint.com',
        password: 'adminPassword123!',
        firstName: 'System',
        lastName: 'Admin',
        designation: 'Managing Director',
        role: 'admin',
        sex: 'male',
        telephoneNumber: '0712345678'
    },
    {
        email: 'user@invoprint.com',
        password: 'userPassword123!',
        firstName: 'Normal',
        lastName: 'User',
        designation: 'Sales Agent',
        role: 'user',
        sex: 'female',
        telephoneNumber: '0778765432'
    }
];

const seedDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB for seeding...');
        console.log('Database Name:', mongoose.connection.name);

        // Clear existing users
        await User.deleteMany({});
        console.log('Existing users cleared.');

        // Create new users
        console.log('Creating users...');
        for (const userData of users) {
             const user = new User(userData);
             await user.save();
             console.log(`User ${userData.email} created.`);
        }
        console.log('Initial users created successfully.');

        // Save to passwords.txt
        const creds = `
ADMIN CREDENTIALS
Email: ${users[0].email}
Password: ${users[0].password}
Role: ${users[0].role}

USER CREDENTIALS
Email: ${users[1].email}
Password: ${users[1].password}
Role: ${users[1].role}
`;
        fs.writeFileSync('../passwords.txt', creds);
        console.log('Credentials saved to passwords.txt');

        mongoose.connection.close();
        process.exit();
    } catch (err) {
        console.error('Error seeding database:', err);
        if (err.errors) {
            Object.keys(err.errors).forEach(key => {
                console.error(`Validation error on ${key}: ${err.errors[key].message}`);
            });
        }
        process.exit(1);
    }
};

seedDB();
