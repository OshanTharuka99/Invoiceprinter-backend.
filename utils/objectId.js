const BusinessDetails = require('../models/BusinessDetails');

const OBJECT_SHORTS = {
    Client: 'CLI',
    Product: 'PROD',
    Project: 'PRJ',
    Supplier: 'SUP',
    Category: 'CAT',
    StockEntry: 'STK',
};

const DEFAULT_ORG_CODE = 'ORG';

const getOrganizationCode = async () => {
    const biz = await BusinessDetails.findOne().select('organizationCode').lean();
    const code = String(biz?.organizationCode || '').trim();
    return code || DEFAULT_ORG_CODE;
};

const buildObjectId = (orgCode, short, sequence, digits = 5) =>
    `${orgCode}/${short}/${String(sequence).padStart(digits, '0')}`;

/**
 * Generate the next object id in the form: ORGANIZATION_CODE/SHORT/NNNNN
 * e.g. mybussiness/CLI/00001
 *
 * @param {Model} Model        Mongoose model to search against
 * @param {string} shortKey    Key from OBJECT_SHORTS (e.g. 'Client')
 * @param {string} idField     Field that stores the object id (e.g. 'clientId')
 */
const nextObjectId = async (Model, shortKey, idField, digits = 5) => {
    const orgCode = await getOrganizationCode();
    const short = OBJECT_SHORTS[shortKey] || shortKey;
    const prefix = `${orgCode}/${short}/`;

    // Look for the highest existing number under this org/short prefix
    const latest = await Model.findOne({ [idField]: { $regex: `^${escapeRegex(prefix)}` } })
        .sort({ [idField]: -1 });

    let sequence = 1;
    if (latest && latest[idField]) {
        const numStr = latest[idField].slice(prefix.length);
        const num = parseInt(numStr, 10);
        if (!isNaN(num)) sequence = num + 1;
    }

    return buildObjectId(orgCode, short, sequence, digits);
};

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Convenience helper for free-form refs (e.g. batch refs containing product id)
const hasPrefix = (value, orgCode, short) =>
    typeof value === 'string' && value.startsWith(`${orgCode}/${short}/`);

module.exports = {
    OBJECT_SHORTS,
    getOrganizationCode,
    buildObjectId,
    nextObjectId,
    hasPrefix,
};