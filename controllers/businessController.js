const BusinessDetails = require('../models/BusinessDetails');
const { migrateOrgCodePrefix } = require('../utils/orgCodeMigration');

exports.getDetails = async (req, res) => {
    try {
        let details = await BusinessDetails.findOne();
        
        // If no details exist, create a default one
        if (!details) {
            details = await BusinessDetails.create({
                businessName: 'My Business',
                businessType: 'Owner',
                address: 'Not Set',
                phoneNumber: 'Not Set',
                email: 'business@example.com',
                country: 'Sri Lanka',
                city: 'Not Set'
            });
        }

        res.status(200).json({ status: 'success', data: { details } });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

exports.updateDetails = async (req, res) => {
    try {
        // Restrict to ROOT or ADMIN roles only - though handled in routes, good to have here too
        if (req.user.role !== 'root' && req.user.role !== 'admin') {
            return res.status(403).json({ message: 'Only ROOT or ADMIN users can edit business details.' });
        }

        const payload = { ...req.body };

        let details = await BusinessDetails.findOne();

        // When the organization code changes, migrate existing custom IDs to the new code
        let orgCodeMigration = null;
        if (details && payload.organizationCode !== undefined) {
            orgCodeMigration = await migrateOrgCodePrefix(details.organizationCode, payload.organizationCode);
        }

        if (!details) {
            details = await BusinessDetails.create(payload);
        } else {
            details = await BusinessDetails.findOneAndUpdate({}, { ...payload, updatedBy: req.user._id }, {
                new: true,
                runValidators: true
            });
        }

        res.status(200).json({
            status: 'success',
            data: { details },
            ...(orgCodeMigration ? { orgCodeMigration } : {})
        });
    } catch (error) {
        res.status(400).json({ status: 'fail', message: error.message });
    }
};
