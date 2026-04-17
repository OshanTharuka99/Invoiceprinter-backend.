const Client = require('../models/Client');
const ClientEditRequest = require('../models/ClientEditRequest');

exports.createClient = async (req, res) => {
    try {
        const latest = await Client.findOne().sort({ createdAt: -1 });
        let sequence = 1;
        if (latest && latest.clientId && latest.clientId.startsWith('CLI_')) {
            const num = parseInt(latest.clientId.split('_')[1], 10);
            if (!isNaN(num)) sequence = num + 1;
        }
        const clientId = `CLI_${sequence.toString().padStart(4, '0')}`;

        const client = await Client.create({ ...req.body, clientId });
        res.status(201).json({ success: true, data: client });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.getClients = async (req, res) => {
    try {
        const clients = await Client.find().sort({ createdAt: -1 });
        res.status(200).json({ success: true, data: clients });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.updateClientDirectly = async (req, res) => {
    try {
        const client = await Client.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
        if (!client) return res.status(404).json({ success: false, message: 'Client not found' });
        res.status(200).json({ success: true, data: client });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.deleteClient = async (req, res) => {
     try {
        const client = await Client.findByIdAndDelete(req.params.id);
        if (!client) return res.status(404).json({ success: false, message: 'Client not found' });
        res.status(200).json({ success: true, message: 'Client deleted' });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
}

// User Requests an Edit
exports.requestEdit = async (req, res) => {
    try {
        const request = await ClientEditRequest.create({
            client: req.params.id,
            requestedBy: req.user._id,
            proposedChanges: req.body
        });
        res.status(201).json({ success: true, message: 'Edit request submitted for approval', data: request });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

// Admin Views Pending Requests
exports.getEditRequests = async (req, res) => {
    try {
        const requests = await ClientEditRequest.find({ status: 'Pending' })
            .populate('client')
            .populate('requestedBy', 'firstName lastName email')
            .sort({ createdAt: -1 });
        res.status(200).json({ success: true, data: requests });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
}

exports.approveEditRequest = async (req, res) => {
    try {
        const request = await ClientEditRequest.findById(req.params.requestId);
        if (!request || request.status !== 'Pending') {
            return res.status(404).json({ success: false, message: 'Pending request not found' });
        }
        
        const client = await Client.findByIdAndUpdate(request.client, request.proposedChanges, { new: true, runValidators: true });
        
        request.status = 'Approved';
        request.reviewedBy = req.user._id;
        request.reviewedAt = Date.now();
        await request.save();

        res.status(200).json({ success: true, message: 'Edit applied', data: client });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.rejectEditRequest = async (req, res) => {
    try {
        const request = await ClientEditRequest.findById(req.params.requestId);
        if (!request || request.status !== 'Pending') {
            return res.status(404).json({ success: false, message: 'Pending request not found' });
        }
        
        request.status = 'Rejected';
        request.reviewedBy = req.user._id;
        request.reviewedAt = Date.now();
        await request.save();

        res.status(200).json({ success: true, message: 'Edit rejected' });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};
