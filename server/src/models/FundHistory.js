const mongoose = require('mongoose');

// Stores monthly NAV snapshots for metric calculation
const FundHistorySchema = new mongoose.Schema({
  schemeCode: { type: String, required: true, unique: true, index: true },
  schemeName: { type: String, required: true },
  category: { type: String, required: true, index: true },
  internalCategory: { type: String, index: true }, // large_cap, mid_cap etc
  riskCategory: { type: String, default: 'medium' },
  
  // Monthly price history (last 5 years, sampled monthly)
  priceHistory: [{
    date: Date,
    close: Number
  }],
  
  // Pre-computed metrics (refreshed periodically)
  metrics: {
    cagr1Y: Number,
    cagr3Y: Number,
    cagr5Y: Number,
    sharpeRatio: Number,
    sortinoRatio: Number,
    beta: Number,
    alpha: Number,
    treynorRatio: Number,
    informationRatio: Number,
    standardDeviation: Number,
    maxDrawdown: Number,
    finalScore: Number
  },
  
  lastFetched: { type: Date, default: null },
  dataPoints: { type: Number, default: 0 },
  status: { type: String, enum: ['pending', 'fetched', 'failed'], default: 'pending' }
}, { timestamps: true });

FundHistorySchema.index({ internalCategory: 1, 'metrics.finalScore': -1 });

module.exports = mongoose.model('FundHistory', FundHistorySchema);
