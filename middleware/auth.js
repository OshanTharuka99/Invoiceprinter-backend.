const jwt = require('jsonwebtoken');
const User = require('../models/User');

exports.protect = async (req, res, next) => {
    try {
        if (!next || typeof next !== 'function') {
            console.error('Protect middleware: next is not a function');
            return res.status(500).json({ message: 'Middleware configuration error' });
        }

        let token;
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
            token = req.headers.authorization.split(' ')[1];
        }

        if (!token) {
            return res.status(401).json({ message: 'You are not logged in! Please log in to get access.' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const currentUser = await User.findById(decoded.id);
        if (!currentUser) {
            return res.status(401).json({ message: 'The user belonging to this token no longer exists.' });
        }

        req.user = currentUser;
        next();
    } catch (error) {
        res.status(401).json({ message: 'Invalid token or session expired.' });
    }
};

exports.restrictTo = (...roles) => {
    return (req, res, next) => {
        if (!next || typeof next !== 'function') {
            console.error('RestrictTo middleware: next is not a function');
            return res.status(500).json({ message: 'Middleware configuration error' });
        }
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ message: 'You do not have permission to perform this action' });
        }
        next();
    };
};
