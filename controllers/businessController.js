const BusinessDetails = require('../models/BusinessDetails');

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
        // Restrict to ROOT role only - though handled in routes, good to have here too
        if (req.user.role !== 'root') {
            return res.status(403).json({ message: 'Only ROOT user can edit business details.' });
        }

        let details = await BusinessDetails.findOne();
        
        if (!details) {
            details = await BusinessDetails.create(req.body);
        } else {
            details = await BusinessDetails.findOneAndUpdate({}, { ...req.body, updatedBy: req.user._id }, {
                new: true,
                runValidators: true
            });
        }

        res.status(200).json({ status: 'success', data: { details } });
    } catch (error) {
        res.status(400).json({ status: 'fail', message: error.message });
    }
};
