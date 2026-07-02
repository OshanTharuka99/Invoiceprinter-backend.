const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { getAuthCookieOptions } = require('../utils/cookieOptions');

const signToken = id => {
    return jwt.sign({ id }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN
    });
};

const createSendToken = (user, statusCode, res) => {
    const token = signToken(user._id);

    // Remove password from output
    user.password = undefined;

    res.cookie('token', token, getAuthCookieOptions());

    res.status(statusCode).json({
        status: 'success',
        data: {
            user
        }
    });
};

exports.logout = (req, res) => {
    res.clearCookie('token', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
    });

    res.status(200).json({ status: 'success', message: 'Logged out successfully' });
};

exports.getMe = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(401).json({ message: 'The user belonging to this token no longer exists.' });
        }

        res.status(200).json({
            status: 'success',
            data: { user },
        });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

exports.register = async (req, res) => {
    try {
        const newUser = await User.create({
            email: req.body.email,
            password: req.body.password,
            firstName: req.body.firstName,
            lastName: req.body.lastName,
            designation: req.body.designation,
            role: req.body.role,
            sex: req.body.sex,
            telephoneNumber: req.body.telephoneNumber
        });

        createSendToken(newUser, 201, res);
    } catch (error) {
        res.status(400).json({ status: 'fail', message: error.message });
    }
};

exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;

        // 1) Check if email and password exist
        if (!email || !password) {
            return res.status(400).json({ message: 'Please provide email and password!' });
        }

        // 2) Check if user exists && password is correct
        const user = await User.findOne({ email }).select('+password');

        if (!user || !(await user.correctPassword(password, user.password))) {
            return res.status(401).json({ message: 'Incorrect email or password' });
        }

        // 3) If everything ok, send token to client
        createSendToken(user, 200, res);
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};
