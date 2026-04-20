const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' })); //read json request
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Routes
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const invoiceRoutes = require('./routes/invoiceRoutes');
const businessRoutes = require('./routes/businessRoutes');
const productRoutes = require('./routes/productRoutes');
const clientRoutes = require('./routes/clientRoutes');
const projectRoutes = require('./routes/projectRoutes');
const supplierRoutes = require('./routes/supplierRoutes');
const quotationRoutes = require('./routes/quotationRoutes');

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/business', businessRoutes);
app.use('/api/products', productRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/quotations', quotationRoutes);

app.get('/', (req, res) => {
    res.send('Invoice Printer API is running...');
});

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('MongoDB connected successfully'))
    .catch(err => console.log('MongoDB connection error:', err));

app.listen(PORT, () => {
    console.log(`Server is running on port: ${PORT}`);
});
