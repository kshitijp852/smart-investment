/**
 * Fund History Service
 * Fetches 5-year historical NAV data from mfapi.in for quality funds
 * and pre-computes financial metrics for fast bucket generation
 */

const axios = require('axios');
const NAV = require('../models/NAV');
const FundHistory = require('../models/FundHistory');
const { cagr, computeReturns } = require('../utils/analytics');
const {
  sharpeRatio, sortinoRatio, beta, treynorRatio,
  alpha, informationRatio, standardDeviation,
  calculateFundScore, generateMarketReturns
} = require('../utils/advancedAnalytics');

const MFAPI_BASE = 'https://api.mfapi.in/mf';
const RATE_LIMIT_MS = 300; // 300ms between requests (~3 req/sec, safe for mfapi)
const BATCH_SIZE = 5;

// Map AMFI categories to internal categories
const CATEGORY_MAP = {
  'Equity Scheme - Large Cap Fund': 'large_cap',
  'Equity Scheme - Mid Cap Fund': 'mid_cap',
  'Equity Scheme - Small Cap Fund': 'small_cap',
  'Equity Scheme - Flexi Cap Fund': 'flexi_cap',
  'Equity Scheme - Multi Cap Fund': 'flexi_cap',
  'Equity Scheme - ELSS': 'elss',
  'Equity Scheme - Large & Mid Cap Fund': 'large_cap',
  'Hybrid Scheme - Aggressive Hybrid Fund': 'balanced',
  'Hybrid Scheme - Balanced Hybrid Fund': 'balanced',
  'Hybrid Scheme - Dynamic Asset Allocation or Balanced Advantage': 'balanced',
  'Debt Scheme - Corporate Bond Fund': 'debt',
  'Debt Scheme - Short Duration Fund': 'debt',
  'Debt Scheme - Medium Duration Fund': 'debt',
  'Debt Scheme - Banking and PSU Fund': 'debt',
  'Debt Scheme - Liquid Fund': 'liquid',
  'Debt Scheme - Overnight Fund': 'liquid',
  'Debt Scheme - Money Market Fund': 'liquid',
  'Other Scheme - Index Funds': 'index',
};

// Categories we care about for recommendations
const TARGET_CATEGORIES = Object.keys(CATEGORY_MAP);

/**
 * Step 1: Select quality funds from the NAV database
 * Picks Direct Growth plans only, one per unique fund name prefix
 */
async function selectQualityFunds(maxPerCategory = 30) {
  console.log('🔍 Selecting quality funds from NAV database...');
  
  const selected = [];
  
  for (const amfiCategory of TARGET_CATEGORIES) {
    const internalCat = CATEGORY_MAP[amfiCategory];
    
    // Get unique funds in this category, prefer Direct Growth plans
    const funds = await NAV.aggregate([
      { $match: { category: amfiCategory } },
      { $sort: { date: -1 } },
      {
        $group: {
          _id: '$schemeCode',
          schemeName: { $first: '$schemeName' },
          category: { $first: '$category' },
          nav: { $first: '$nav' },
          date: { $first: '$date' }
        }
      },
      // Prefer Direct Growth plans
      {
        $addFields: {
          isDirectGrowth: {
            $cond: {
              if: {
                $and: [
                  { $regexMatch: { input: '$schemeName', regex: /direct/i } },
                  { $regexMatch: { input: '$schemeName', regex: /growth/i } }
                ]
              },
              then: 1,
              else: 0
            }
          }
        }
      },
      { $sort: { isDirectGrowth: -1, nav: -1 } },
      { $limit: maxPerCategory }
    ]);
    
    for (const fund of funds) {
      selected.push({
        schemeCode: fund._id,
        schemeName: fund.schemeName,
        category: amfiCategory,
        internalCategory: internalCat,
        riskCategory: getRiskCategory(internalCat)
      });
    }
    
    console.log(`  ${amfiCategory}: ${funds.length} funds selected`);
  }
  
  console.log(`✅ Total selected: ${selected.length} funds`);
  return selected;
}

function getRiskCategory(internalCat) {
  const riskMap = {
    large_cap: 'medium', mid_cap: 'high', small_cap: 'high',
    flexi_cap: 'medium', elss: 'medium', balanced: 'low',
    debt: 'low', liquid: 'low', index: 'medium'
  };
  return riskMap[internalCat] || 'medium';
}

/**
 * Step 2: Seed FundHistory collection with selected funds
 */
async function seedFundHistoryCollection(maxPerCategory = 30) {
  const funds = await selectQualityFunds(maxPerCategory);
  
  let inserted = 0;
  let existing = 0;
  
  for (const fund of funds) {
    const exists = await FundHistory.findOne({ schemeCode: fund.schemeCode });
    if (!exists) {
      await FundHistory.create({
        schemeCode: fund.schemeCode,
        schemeName: fund.schemeName,
        category: fund.category,
        internalCategory: fund.internalCategory,
        riskCategory: fund.riskCategory,
        status: 'pending'
      });
      inserted++;
    } else {
      existing++;
    }
  }
  
  console.log(`📋 FundHistory seeded: ${inserted} new, ${existing} existing`);
  return { inserted, existing, total: funds.length };
}

/**
 * Step 3: Fetch historical data from mfapi.in for pending funds
 */
async function fetchHistoricalData(limit = 50) {
  const pendingFunds = await FundHistory.find({ status: 'pending' }).limit(limit);
  
  if (pendingFunds.length === 0) {
    console.log('✅ No pending funds to fetch');
    return { fetched: 0, failed: 0 };
  }
  
  console.log(`📥 Fetching historical data for ${pendingFunds.length} funds...`);
  let fetched = 0;
  let failed = 0;
  
  for (let i = 0; i < pendingFunds.length; i += BATCH_SIZE) {
    const batch = pendingFunds.slice(i, i + BATCH_SIZE);
    
    await Promise.all(batch.map(async (fund) => {
      try {
        await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
        
        const response = await axios.get(`${MFAPI_BASE}/${fund.schemeCode}`, {
          timeout: 15000
        });
        
        if (!response.data?.data?.length) {
          await FundHistory.updateOne({ schemeCode: fund.schemeCode }, { status: 'failed' });
          failed++;
          return;
        }
        
        // Sample monthly data points (take every ~22nd trading day)
        const allData = response.data.data.reverse(); // oldest first
        const monthly = sampleMonthly(allData);
        
        if (monthly.length < 12) {
          await FundHistory.updateOne({ schemeCode: fund.schemeCode }, { status: 'failed' });
          failed++;
          return;
        }
        
        const priceHistory = monthly.map(d => ({
          date: parseDate(d.date),
          close: parseFloat(d.nav)
        }));
        
        // Compute metrics
        const metrics = computeMetrics(priceHistory);
        
        await FundHistory.updateOne(
          { schemeCode: fund.schemeCode },
          {
            priceHistory,
            metrics,
            dataPoints: priceHistory.length,
            lastFetched: new Date(),
            status: 'fetched'
          }
        );
        
        fetched++;
        if (fetched % 10 === 0) {
          console.log(`  Progress: ${fetched}/${pendingFunds.length} fetched`);
        }
      } catch (err) {
        await FundHistory.updateOne({ schemeCode: fund.schemeCode }, { status: 'failed' });
        failed++;
      }
    }));
  }
  
  console.log(`✅ Historical fetch complete: ${fetched} fetched, ${failed} failed`);
  return { fetched, failed };
}

/**
 * Sample one data point per month from daily data
 */
function sampleMonthly(data) {
  const monthly = [];
  let lastMonth = null;
  
  for (const point of data) {
    const parts = point.date.split('-');
    const month = `${parts[2]}-${parts[1]}`; // YYYY-MM
    
    if (month !== lastMonth) {
      monthly.push(point);
      lastMonth = month;
    }
  }
  
  // Keep last 60 months (5 years)
  return monthly.slice(-60);
}

/**
 * Parse DD-MM-YYYY date format from mfapi
 */
function parseDate(dateStr) {
  const [dd, mm, yyyy] = dateStr.split('-');
  return new Date(`${yyyy}-${mm}-${dd}`);
}

/**
 * Compute all financial metrics from price history
 */
function computeMetrics(priceHistory) {
  const returns = computeReturns(priceHistory);
  
  if (!returns || returns.length < 6) {
    return { finalScore: 0 };
  }
  
  const marketReturns = generateMarketReturns(returns.length);
  
  const fundBeta = beta(returns, marketReturns);
  const fundSharpe = sharpeRatio(returns);
  const fundSortino = sortinoRatio(returns);
  const fundTreynor = treynorRatio(returns, fundBeta);
  const fundAlpha = alpha(returns, marketReturns, fundBeta);
  const fundInfoRatio = informationRatio(returns, marketReturns);
  const fundSD = standardDeviation(returns);
  
  // CAGR calculations
  const cagr1Y = priceHistory.length >= 12 ? calcCAGR(priceHistory, 12) : null;
  const cagr3Y = priceHistory.length >= 36 ? calcCAGR(priceHistory, 36) : null;
  const cagr5Y = priceHistory.length >= 60 ? calcCAGR(priceHistory, 60) : null;
  
  // Max drawdown
  const maxDrawdown = calcMaxDrawdown(priceHistory);
  
  return {
    cagr1Y, cagr3Y, cagr5Y,
    sharpeRatio: fundSharpe,
    sortinoRatio: fundSortino,
    beta: fundBeta,
    alpha: fundAlpha,
    treynorRatio: fundTreynor,
    informationRatio: fundInfoRatio,
    standardDeviation: fundSD,
    maxDrawdown,
    finalScore: 0 // Will be computed relatively across all funds
  };
}

function calcCAGR(priceHistory, months) {
  const recent = priceHistory.slice(-1)[0]?.close;
  const past = priceHistory.slice(-(months + 1))[0]?.close;
  if (!recent || !past || past === 0) return null;
  return Math.pow(recent / past, 12 / months) - 1;
}

function calcMaxDrawdown(priceHistory) {
  let peak = -Infinity;
  let maxDD = 0;
  for (const p of priceHistory) {
    if (p.close > peak) peak = p.close;
    const dd = (peak - p.close) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

/**
 * Step 4: Compute relative scores across all fetched funds
 */
async function computeRelativeScores() {
  const funds = await FundHistory.find({ status: 'fetched' }).lean();

  if (funds.length === 0) return;

  // Only use funds that have valid metrics (no NaN/null)
  const validFunds = funds.filter(f => {
    const m = f.metrics;
    return m && 
      isFinite(m.sharpeRatio) && isFinite(m.sortinoRatio) &&
      isFinite(m.beta) && isFinite(m.alpha) &&
      isFinite(m.treynorRatio) && isFinite(m.informationRatio) &&
      isFinite(m.standardDeviation);
  });

  console.log(`Computing scores for ${validFunds.length}/${funds.length} valid funds`);

  const allMetrics = validFunds.map(f => ({
    ...f.metrics,
    // Ensure expense/turnover are present (use category defaults if missing)
    expenseRatio: f.metrics.expenseRatio || 0.01,
    turnoverRatio: f.metrics.turnoverRatio || 0.5
  }));

  let updated = 0;
  let skipped = 0;

  for (const fund of validFunds) {
    try {
      const metricsWithCost = {
        ...fund.metrics,
        expenseRatio: fund.metrics.expenseRatio || 0.01,
        turnoverRatio: fund.metrics.turnoverRatio || 0.5
      };

      const scoreData = calculateFundScore(metricsWithCost, allMetrics);
      const finalScore = scoreData.finalScore;

      // Guard against NaN before writing
      if (!isFinite(finalScore) || isNaN(finalScore)) {
        skipped++;
        continue;
      }

      await FundHistory.updateOne(
        { schemeCode: fund.schemeCode },
        { 'metrics.finalScore': parseFloat(finalScore.toFixed(4)) }
      );
      updated++;
    } catch (err) {
      skipped++;
    }
  }

  console.log(`✅ Scores computed: ${updated} updated, ${skipped} skipped`);
}

/**
 * Get stats about the fund history collection
 */
async function getStats() {
  const total = await FundHistory.countDocuments();
  const fetched = await FundHistory.countDocuments({ status: 'fetched' });
  const pending = await FundHistory.countDocuments({ status: 'pending' });
  const failed = await FundHistory.countDocuments({ status: 'failed' });
  
  const byCategory = await FundHistory.aggregate([
    { $match: { status: 'fetched' } },
    { $group: { _id: '$internalCategory', count: { $sum: 1 } } },
    { $sort: { _id: 1 } }
  ]);
  
  return { total, fetched, pending, failed, byCategory };
}

/**
 * Full pipeline: seed + fetch + score
 */
async function runFullPipeline(maxPerCategory = 30, fetchLimit = 100) {
  console.log('🚀 Starting full fund history pipeline...');
  
  const seedResult = await seedFundHistoryCollection(maxPerCategory);
  const fetchResult = await fetchHistoricalData(fetchLimit);
  await computeRelativeScores();
  
  const stats = await getStats();
  console.log('📊 Pipeline complete:', stats);
  
  return { seedResult, fetchResult, stats };
}

module.exports = {
  selectQualityFunds,
  seedFundHistoryCollection,
  fetchHistoricalData,
  computeRelativeScores,
  computeMetrics,
  getStats,
  runFullPipeline,
  CATEGORY_MAP
};
