const User = require('../models/User');

exports.createUser = async (req, res) => {
    try {
        const newUser = await User.create({
            ...req.body,
            forcePasswordChange: true // Require change on first login
        });
        res.status(201).json({ status: 'success', data: { user: newUser } });
    } catch (error) {
        res.status(400).json({ status: 'fail', message: error.message });
    }
};

exports.getAllUsers = async (req, res) => {
    try {
        const users = await User.find();
        res.status(200).json({ status: 'success', data: { users } });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

exports.deleteUser = async (req, res) => {
    try {
        const targetUser = await User.findById(req.params.id);
        if (!targetUser) return res.status(404).json({ message: 'User not found' });

        // Logic: 
        // root can delete anyone except themselves (handled by frontend typically, but good to check)
        // admin can only delete users, not other admins or root
        if (req.user.role === 'admin' && (targetUser.role === 'admin' || targetUser.role === 'root')) {
            return res.status(403).json({ message: 'Admins cannot delete other admins or the root user.' });
        }

        // Prevent self-deletion if needed (optional but recommended)
        if (req.user.id === req.params.id) {
            return res.status(403).json({ message: 'You cannot delete your own account.' });
        }

        await User.findByIdAndDelete(req.params.id);
        res.status(204).json({ status: 'success', data: null });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

exports.updateUserRole = async (req, res) => {
    try {
        const targetUser = await User.findById(req.params.id);
        if (!targetUser) return res.status(404).json({ message: 'User not found' });

        const newRole = req.body.role;

        // Logic:
        // 1. Nobody can promote anyone to root
        if (newRole === 'root') {
            return res.status(403).json({ message: 'Maximum level reached. Cannot create more root users.' });
        }

        // 2. Admin permissions
        if (req.user.role === 'admin') {
            // Cannot change root user's role
            if (targetUser.role === 'root') {
                return res.status(403).json({ message: 'Admins cannot modify the root user.' });
            }
            // Cannot demote an admin
            if (targetUser.role === 'admin' && newRole === 'user') {
                return res.status(403).json({ message: 'Admins cannot demote other admins to users.' });
            }
        }

        // 3. Root permissions (already implicitly handled because anyone else can be modified by root except to be root)

        targetUser.role = newRole;
        await targetUser.save();

        res.status(200).json({ status: 'success', data: { user: targetUser } });
    } catch (error) {
        res.status(400).json({ status: 'fail', message: error.message });
    }
};

exports.updateUser = async (req, res) => {
    try {
        const targetUser = await User.findById(req.params.id);
        if (!targetUser) return res.status(404).json({ message: 'User not found' });

        // Logic Check
        if (req.user.role === 'admin' && (targetUser.role === 'admin' || targetUser.role === 'root')) {
            return res.status(403).json({ message: 'Admins cannot edit other admins or the root user.' });
        }

        // Only allow updating certain fields (protect password and role here, password handled by separate route or specific check)
        const allowedFields = ['firstName', 'lastName', 'designation', 'sex', 'telephoneNumber', 'email'];
        
        allowedFields.forEach(field => {
            if (req.body[field] !== undefined) {
                targetUser[field] = req.body[field];
            }
        });

        // If password is being updated, it will be hashed by the pre-save hook
        if (req.body.password) {
            targetUser.password = req.body.password;
            targetUser.forcePasswordChange = true; // Force change if admin resets password
        }

        await targetUser.save();

        res.status(200).json({ status: 'success', data: { user: targetUser } });
    } catch (error) {
        res.status(400).json({ status: 'fail', message: error.message });
    }
};

exports.changePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const user = await User.findById(req.user._id).select('+password');

        if (!user) return res.status(404).json({ message: 'User not found' });

        // If currentPassword is provided (from a normal settings change), verify it
        if (currentPassword && !(await user.correctPassword(currentPassword, user.password))) {
            return res.status(401).json({ message: 'Incorrect current password' });
        }

        // PREVENTION: Ensure the new password is not the same as the current hashed one
        const isSamePassword = await user.correctPassword(newPassword, user.password);
        if (isSamePassword) {
            return res.status(400).json({ message: 'New password cannot be the same as your current password. Please choose a new unique password.' });
        }

        user.password = newPassword;
        user.forcePasswordChange = false; // Successfully changed by user
        user.passwordChangedAt = Date.now();
        await user.save();

        res.status(200).json({ 
            status: 'success', 
            message: 'Password changed successfully',
            data: { user }
        });
    } catch (error) {
        res.status(400).json({ status: 'fail', message: error.message });
    }
};

