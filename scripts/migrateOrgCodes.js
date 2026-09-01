const mongoose = require('mongoose');
const { migrateToCurrentOrgCode } = require('../utils/orgCodeMigration');
require('dotenv').config({ path: './.env' });

const backfillOrgCodes = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('MongoDB connected...');

        const result = await migrateToCurrentOrgCode();

        console.log('\n=== Org Code Backfill Result ===');
        console.log(`Current org code: ${result.currentCode}`);
        console.log(`Legacy codes migrated: ${result.legacyCodes.join(', ') || '(none)'}`);
        result.results.forEach(r => console.log(`  ${r.collection}.${r.field}: ${r.updated} updated`));
        console.log(`\nTotal updated: ${result.updated}`);

        if (result.errors.length > 0) {
            console.log('\nErrors:');
            result.errors.forEach(e => console.log(`  ${e.collection}.${e.field} "${e.value}": ${e.error}`));
        }

        mongoose.connection.close();
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

backfillOrgCodes();