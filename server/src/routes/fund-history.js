const express = require('express');
const router = express.Router();
const {
  seedFundHistoryCollection,
  fetchHistoricalData,
  computeRelativeScores,
  getStats,
  runFullPipeline
} = require('../services/fundHistoryService');
const FundHistory = require('../models/FundHistory');

// GET /api/fund-history/stats
router.get('/stats', async (req, res) => {
  try {
    const stats = await getStats();
    res.json({ success: true, stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/fund-history/seed - seed the collection with fund list
router.post('/seed', async (req, res) => {
  try {
    const { maxPerCategory = 30 } = req.body;
    const result = await seedFundHistoryCollection(maxPerCategory);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/fund-history/fetch - fetch historical data for pending funds
router.post('/fetch', async (req, res) => {
  try {
    const { limit = 50 } = req.body;
    // Run async, return immediately
    res.json({ success: true, message: `Fetching historical data for up to ${limit} funds in background...` });
    fetchHistoricalData(limit).then(computeRelativeScores).catch(console.error);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/fund-history/pipeline - run full pipeline
router.post('/pipeline', async (req, res) => {
  try {
    const { maxPerCategory = 30, fetchLimit = 100 } = req.body;
    res.json({ success: true, message: 'Pipeline started in background. Check /stats for progress.' });
    runFullPipeline(maxPerCategory, fetchLimit).catch(console.error);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/fund-history/top/:category - get top funds by category
router.get('/top/:category', async (req, res) => {
  try {
    const { category } = req.params;
    const { limit = 10 } = req.query;
    
    const funds = await FundHistory.find({
      internalCategory: category,
      status: 'fetched'
    })
    .sort({ 'metrics.finalScore': -1 })
    .limit(parseInt(limit))
    .select('schemeCode schemeName internalCategory riskCategory metrics dataPoints')
    .lean();
    
    res.json({ success: true, category, count: funds.length, funds });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
