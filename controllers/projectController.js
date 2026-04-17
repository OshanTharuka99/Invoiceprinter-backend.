const Project = require('../models/Project');

exports.createProject = async (req, res) => {
    try {
        const latest = await Project.findOne().sort({ createdAt: -1 });
        let sequence = 1;
        if (latest && latest.projectId && latest.projectId.startsWith('PRO_ID_')) {
            const num = parseInt(latest.projectId.split('_')[2], 10);
            if (!isNaN(num)) sequence = num + 1;
        }
        const projectId = `PRO_ID_${sequence.toString().padStart(4, '0')}`;

        const project = await Project.create({ ...req.body, projectId });
        res.status(201).json({ success: true, data: project });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.getProjects = async (req, res) => {
    try {
        const projects = await Project.find().populate('client').sort({ createdAt: -1 });
        res.status(200).json({ success: true, data: projects });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.updateProject = async (req, res) => {
    try {
        const project = await Project.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
        if (!project) return res.status(404).json({ success: false, message: 'Project not found' });
        res.status(200).json({ success: true, data: project });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.deleteProject = async (req, res) => {
     try {
        const project = await Project.findByIdAndDelete(req.params.id);
        if (!project) return res.status(404).json({ success: false, message: 'Project not found' });
        res.status(200).json({ success: true, message: 'Project deleted' });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};
