const mongoose = require('mongoose');
const BusinessDetails = require('../models/BusinessDetails');
const Client = require('../models/Client');
const Product = require('../models/Product');
const Project = require('../models/Project');
const Supplier = require('../models/Supplier');
const Category = require('../models/Category');
const StockEntry = require('../models/StockEntry');
const GoodsReturnNote = require('../models/GoodsReturnNote');
require('dotenv').config({ path: './.env' });

const FIELD_MAP = [
    { model: Client, field: 'clientId' },
    { model: Product, field: 'productId' },
    { model: Project, field: 'projectId' },
    { model: Supplier, field: 'supplierId' },
    { model: Category, field: 'code' },
    { model: StockEntry, field: 'batchRef' },
    { model: GoodsReturnNote, field: 'batchRef' },
];

const prefixCounts = async (values) => {
    const counts = {};
    for (const v of values) {
        if (typeof v !== 'string' || !v.includes('/')) {
            const key = `(no-prefix) ${typeof v === 'string' ? v.slice(0, 30) : typeof v}`;
            counts[key] = (counts[key] || 0) + 1;
            continue;
        }
        const seg = v.split('/')[0];
        counts[seg] = (counts[seg] || 0) + 1;
    }
    return counts;
};

const inspect = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('MongoDB connected...');

        const biz = await BusinessDetails.findOne().select('organizationCode businessName').lean();
        console.log(`\nOrganizationCode: "${biz?.organizationCode || '(empty)'}"  |  Business: "${biz?.businessName || ''}"`);

        for (const { model, field } of FIELD_MAP) {
            const values = await model.distinct(field);
            const counts = await prefixCounts(values);
            console.log(`\n${model.modelName}.${field}: total docs with field = ${values.length}`);
            for (const [prefix, count] of Object.entries(counts)) {
                console.log(`   ${prefix.padEnd(28)} x${count}`);
            }
        }

        mongoose.connection.close();
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

inspect();