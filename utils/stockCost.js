const StockEntry = require('../models/StockEntry');

/**
 * FIFO unit cost for a line item (mirrors stock deduction order).
 */
const computeFifoUnitCost = async (item, creationMethod) => {
    if (!item.productRef) return 0;

    const productId = item.productRef._id || item.productRef;
    let remainingQty = Number(item.quantity) || 0;
    let totalCost = 0;

    const stockEntries = await StockEntry.find({
        product: productId,
        quantity: { $gt: 0 },
    }).sort({ createdAt: 1 });

    const hasSerials = item.serialNumbers?.length > 0;

    for (const entry of stockEntries) {
        if (remainingQty <= 0) break;
        const unitBuy = entry.buyingPrice || 0;

        if (hasSerials) {
            const entrySerials = entry.serialNumbers.map((s) => s.toUpperCase());
            const serialsToRemove = item.serialNumbers.filter((sn) =>
                entrySerials.includes(String(sn).toUpperCase())
            );
            if (serialsToRemove.length > 0 && creationMethod === 'manual') {
                totalCost += serialsToRemove.length * unitBuy;
                remainingQty -= serialsToRemove.length;
            }
        }

        if (creationMethod === 'automatic') {
            const reduceQty = Math.min(remainingQty, entry.quantity);
            totalCost += reduceQty * unitBuy;
            remainingQty -= reduceQty;
        }
    }

    const qty = Number(item.quantity) || 0;
    if (qty <= 0) return 0;
    return Math.round((totalCost / qty) * 100) / 100;
};

const enrichItemsWithUnitCost = async (items, creationMethod) => {
    const enriched = [];
    for (const item of items) {
        const unitCost = await computeFifoUnitCost(item, creationMethod);
        enriched.push({
            ...item,
            unitCost,
        });
    }
    return enriched;
};

/** Fallback when FIFO cannot run (e.g. stock already deducted). */
const getEstimatedUnitCost = async (productId) => {
    const id = productId?._id || productId;
    if (!id) return 0;

    const entries = await StockEntry.find({ product: id, buyingPrice: { $gt: 0 } });
    if (!entries.length) return 0;

    const totalQty = entries.reduce((s, e) => s + (e.quantity || 0), 0);
    if (totalQty > 0) {
        const totalCost = entries.reduce((s, e) => s + e.quantity * e.buyingPrice, 0);
        return Math.round((totalCost / totalQty) * 100) / 100;
    }

    const avg = entries.reduce((s, e) => s + e.buyingPrice, 0) / entries.length;
    return Math.round(avg * 100) / 100;
};

const enrichItemsWithUnitCostFromDN = async (items, dnItems = []) => {
    const enriched = [];
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const dnItem = dnItems[i];
        let unitCost = dnItem?.unitCost || 0;
        if (!unitCost && item.productRef) {
            unitCost = await getEstimatedUnitCost(item.productRef);
        }
        enriched.push({ ...item, unitCost });
    }
    return enriched;
};

const computeInvoiceProfit = (invoice) => {
    const items = invoice.items || [];
    const totalCost = items.reduce(
        (sum, item) => sum + (Number(item.unitCost) || 0) * (Number(item.quantity) || 0),
        0
    );
    const revenue = (Number(invoice.subTotal) || 0) - (Number(invoice.discountTotal) || 0);
    const profit = revenue - totalCost;
    const margin = revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : 0;
    return { totalCost, revenue, profit, margin };
};

module.exports = {
    computeFifoUnitCost,
    enrichItemsWithUnitCost,
    enrichItemsWithUnitCostFromDN,
    getEstimatedUnitCost,
    computeInvoiceProfit,
};
