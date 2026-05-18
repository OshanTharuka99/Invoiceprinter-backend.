try {
    const express = require('express');
    const app = express();
    const router = require('./routes/purchaseOrderRoutes');
    console.log("Successfully required router!");
    console.log("Router stack: ", router.stack.map(layer => layer.route ? layer.route.path : layer.name));
} catch (e) {
    console.error("Require failed: ", e.message);
}
