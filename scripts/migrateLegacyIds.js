const mongoose = require('mongoose');
const { convertLegacyIds } = require('../utils/orgCodeMigration');
require('dotenv').config({ path: './.env' });

const migrateLegacyIds = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('MongoDB connected...');

        const result = await convertLegacyIds();

        console.log('\n=== Legacy ID Conversion Result ===');
        console.log(`Current org code: ${result.currentCode}`);
        result.results.forEach(r => {
            console.log(`  ${r.collection}.${r.field}: ${r.updated} converted`);
            if (r.oldToNew && r.oldToNew.size) {
                r.oldToNew.forEach((to, from) => console.log(`     ${from.padEnd(24)} -> ${to}`));
            }
        });
        console.log(`\nTotal updated: ${result.updated}`);

        mongoose.connection.close();
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

migrateLegacyIds();