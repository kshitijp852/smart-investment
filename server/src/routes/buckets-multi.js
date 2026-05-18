const express = require('express');
const router = express.Router();
const axios = require('axios');
const FinancialData = require('../models/FinancialData');
const FundHistory = require('../models/FundHistory');
const { cagr, computeReturns, applyExpectedReturnBounds } = require('../utils/analytics');
const {
  sharpeRatio, sortinoRatio, beta, treynorRatio,
  alpha, informationRatio, standardDeviation,
  calculateFundScore, generateMarketReturns,
  getExpenseRatioForCategory, getTurnoverRatioForCategory
} = require('../utils/advancedAnalytics');
const {
  compareWithBenchmark, generatePerformanceChartData, calculateBlendedBenchmark
} = require('../services/benchmarkService');
const {
  comparePortfolioWithBenchmarkHistorical
} = require('../services/historicalReturnsService');

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:5002';

/**
 * Returns the target total number of funds for a portfolio
 * based on investment amount and risk level.
 *
 * Amount tiers:
 *   < 50,000       → 3–4 funds
 *   50,000–200,000 → 4–6 funds
 *   200,000–1,000,000 → 6–8 funds
 *   > 1,000,000    → 8–10 funds
 *
 * Risk caps:
 *   low    → max 5 funds
 *   medium → max 8 funds
 *   high   → max 10 funds
 */
function getTargetFundCount(amount, riskLevel) {
  // Amount-based range
  let amountMin, amountMax;
  if (amount < 50000) {
    amountMin = 3; amountMax = 4;
  } else if (amount <= 200000) {
    amountMin = 4; amountMax = 6;
  } else if (amount <= 1000000) {
    amountMin = 6; amountMax = 8;
  } else {
    amountMin = 8; amountMax = 10;
  }

  // Risk-based cap
  const riskCap = { low: 5, medium: 8, high: 10 }[riskLevel] ?? 8;

  // Use midpoint of amount range, then apply risk cap
  const amountTarget = Math.round((amountMin + amountMax) / 2);
  return Math.min(amountTarget, riskCap);
}

/**
 * Call the ML service to get SHAP explanation for a fund's metrics.
 * Returns null gracefully if the ML service is unavailable.
 */
async function getShapExplanation(fundMetrics) {
  if (!fundMetrics) return null;
  try {
    const response = await axios.post(
      `${ML_SERVICE_URL}/explain`,
      {
        sharpeRatio:      fundMetrics.sharpeRatio      ?? 0,
        sortinoRatio:     fundMetrics.sortinoRatio     ?? 0,
        alpha:            fundMetrics.alpha            ?? 0,
        beta:             fundMetrics.beta             ?? 1,
        treynorRatio:     fundMetrics.treynorRatio     ?? 0,
        informationRatio: fundMetrics.informationRatio ?? 0,
        stdDeviation:     fundMetrics.standardDeviation ?? 0,
        maxDrawdown:      fundMetrics.maxDrawdown      ?? 0,
        cagr1Y:           fundMetrics.cagr1Y           ?? 0,
      },
      { timeout: 3000 }  // 3s timeout — don't block portfolio generation
    );
    return response.data;
  } catch (err) {
    // ML service offline or slow — return null, don't fail the whole request
    return null;
  }
}

// Generate MULTIPLE diversified bucket options
router.post('/generate', async (req, res) => {
  try {
    const { amount = 100000, duration = 3, riskLevel = 'medium' } = req.body;

    // Try FundHistory first (richer dataset), fall back to curated funds
    const fundHistoryCount = await FundHistory.countDocuments({ status: 'fetched' });
    let allFunds = [];
    let dataSource = 'curated';

    if (fundHistoryCount >= 20) {
      // Use FundHistory - has pre-computed metrics for all 14k funds
      const historyFunds = await FundHistory.find({ status: 'fetched' }).lean();
      allFunds = historyFunds.map(f => ({
        symbol: f.schemeCode,
        name: f.schemeName,
        meta: { category: f.internalCategory, riskCategory: f.riskCategory, schemeCode: f.schemeCode },
        priceHistory: f.priceHistory,
        // Pre-computed metrics
        _precomputedMetrics: f.metrics,
        _finalScore: f.metrics?.finalScore || 0
      }));
      dataSource = 'fund_history';
      console.log(`Using FundHistory: ${allFunds.length} funds`);
    } else {
      // Fall back to curated funds
      allFunds = await FinancialData.find({ type: 'mutual_fund' }).lean();
      console.log(`Using curated funds: ${allFunds.length} funds`);
    }

    if (allFunds.length === 0) {
      return res.status(404).json({ message: 'No mutual funds available.' });
    }
    
    // Calculate comprehensive metrics for each fund
    const fundsWithMetrics = allFunds.map(fund => {
      // Use pre-computed metrics if available (FundHistory)
      if (fund._precomputedMetrics && fund._precomputedMetrics.sharpeRatio != null) {
        const m = fund._precomputedMetrics;
        const expectedReturn = m.cagr3Y || m.cagr1Y || getExpectedReturnForCategory(fund.meta?.category);
        return {
          ...fund,
          calculatedReturn: applyExpectedReturnBounds(expectedReturn, fund.meta?.category),
          metrics: {
            sharpeRatio: m.sharpeRatio || 0,
            sortinoRatio: m.sortinoRatio || 0,
            beta: m.beta || 1,
            treynorRatio: m.treynorRatio || 0,
            alpha: m.alpha || 0,
            informationRatio: m.informationRatio || 0,
            standardDeviation: m.standardDeviation || 0.15,
            expenseRatio: getExpenseRatioForCategory(fund.meta?.category),
            turnoverRatio: getTurnoverRatioForCategory(fund.meta?.category)
          }
        };
      }

      // Compute from price history (curated funds path)
      const priceHistory = fund.priceHistory || [];
      const returns = computeReturns(priceHistory);
      if (!returns || returns.length < 2) return null;

      const marketReturns = generateMarketReturns(returns.length);
      const fundCAGR = cagr(priceHistory) || 0;
      const fundBeta = beta(returns, marketReturns);

      return {
        ...fund,
        calculatedReturn: applyExpectedReturnBounds(fundCAGR, fund.meta?.category),
        metrics: {
          sharpeRatio: sharpeRatio(returns),
          sortinoRatio: sortinoRatio(returns),
          beta: fundBeta,
          treynorRatio: treynorRatio(returns, fundBeta),
          alpha: alpha(returns, marketReturns, fundBeta),
          informationRatio: informationRatio(returns, marketReturns),
          standardDeviation: standardDeviation(returns),
          expenseRatio: getExpenseRatioForCategory(fund.meta?.category),
          turnoverRatio: getTurnoverRatioForCategory(fund.meta?.category)
        }
      };
    }).filter(f => f !== null);
    
    // Calculate scores for all funds
    const allMetrics = fundsWithMetrics.map(f => f.metrics);
    const scoredFunds = fundsWithMetrics.map(fund => {
      const scoreData = calculateFundScore(fund.metrics, allMetrics);
      return {
        ...fund,
        finalScore: scoreData.finalScore,
        scoreBreakdown: scoreData
      };
    });
    
    // Define bucket allocation strategies
    const bucketStrategies = {
      low: {
        name: 'Conservative Portfolio',
        description: 'Focus on capital preservation with steady returns',
        allocation: {
          debt: 0.40, liquid: 0.25, balanced: 0.20, large_cap: 0.10, index: 0.05
        },
        icon: '🛡️',
        tag: 'Safe & Stable'
      },
      medium: {
        name: 'Balanced Portfolio',
        description: 'Mix of growth and stability for moderate returns',
        allocation: {
          large_cap: 0.25, flexi_cap: 0.20, balanced: 0.20, mid_cap: 0.15,
          debt: 0.10, index: 0.05, elss: 0.05
        },
        icon: '⚖️',
        tag: 'Balanced Growth'
      },
      high: {
        name: 'Aggressive Portfolio',
        description: 'Maximum growth potential with higher volatility',
        allocation: {
          mid_cap: 0.25, small_cap: 0.20, large_cap: 0.20, flexi_cap: 0.15,
          elss: 0.10, balanced: 0.05, index: 0.05
        },
        icon: '🚀',
        tag: 'High Growth'
      }
    };
    
    // Function to generate a bucket for a specific strategy
    const generateBucket = async (strategyKey) => {
      const strategy = bucketStrategies[strategyKey];
      const bucket = [];
      let totalWeightedReturn = 0;
      let totalWeightedRisk = 0;

      // Dynamic fund count: total target funds for this portfolio
      const targetFundCount = getTargetFundCount(amount, strategyKey);
      const numCategories = Object.keys(strategy.allocation).length;

      // How many funds to pick per category:
      // Spread target evenly, minimum 1, maximum 3
      // e.g. target=4, categories=7 → 1 per category (stops at 4 total)
      // e.g. target=8, categories=7 → 1-2 per category
      const fundsPerCategory = Math.max(1, Math.min(3, Math.ceil(targetFundCount / numCategories)));

      // Track total added so we don't exceed target
      let totalAdded = 0;
      
      for (const [category, percentage] of Object.entries(strategy.allocation)) {
        // Remaining slots for this category
        const remaining = targetFundCount - totalAdded;
        if (remaining <= 0) break;

        const sliceCount = Math.min(fundsPerCategory, remaining);

        const categoryFunds = scoredFunds
          .filter(f => f.meta?.category === category)
          .sort((a, b) => {
            if (Math.abs(b.finalScore - a.finalScore) > 0.1) return b.finalScore - a.finalScore;
            if (Math.abs(b.metrics.sortinoRatio - a.metrics.sortinoRatio) > 0.1) return b.metrics.sortinoRatio - a.metrics.sortinoRatio;
            if (Math.abs(a.metrics.standardDeviation - b.metrics.standardDeviation) > 0.01) return a.metrics.standardDeviation - b.metrics.standardDeviation;
            return a.metrics.expenseRatio - b.metrics.expenseRatio;
          })
          .slice(0, sliceCount);
        
        if (categoryFunds.length > 0) {
          const perFundPercentage = percentage / categoryFunds.length;
          
          categoryFunds.forEach(fund => {
            const allocation = amount * perFundPercentage;
            const projectedValue = allocation * Math.pow(1 + fund.calculatedReturn, duration);
            
            bucket.push({
              symbol: fund.symbol,
              name: fund.name,
              category: fund.meta?.category || category,
              riskCategory: fund.meta?.riskCategory || 'medium',
              allocation: allocation,
              percentage: perFundPercentage * 100,
              expectedReturn: fund.calculatedReturn,
              projectedValue: projectedValue,
              projectedGain: projectedValue - allocation,
              finalScore: fund.finalScore,
              metrics: fund.metrics,
              scoreBreakdown: fund.scoreBreakdown,
              meta: fund.meta // Include meta for schemeCode
            });
            
            totalWeightedReturn += fund.calculatedReturn * perFundPercentage;
            totalWeightedRisk += fund.metrics.standardDeviation * perFundPercentage;
            totalAdded++;
          });
        }
      }
      
      const totalInvestment = bucket.reduce((sum, f) => sum + f.allocation, 0);
      const totalProjectedValue = bucket.reduce((sum, f) => sum + f.projectedValue, 0);
      const totalGain = totalProjectedValue - totalInvestment;
      
      const categorySummary = {};
      bucket.forEach(fund => {
        if (!categorySummary[fund.category]) {
          categorySummary[fund.category] = { totalAllocation: 0, totalPercentage: 0, funds: [] };
        }
        categorySummary[fund.category].totalAllocation += fund.allocation;
        categorySummary[fund.category].totalPercentage += fund.percentage;
        categorySummary[fund.category].funds.push(fund);
      });

      // Attach SHAP explanations to each fund (parallel calls to ML service)
      await Promise.all(bucket.map(async (fund) => {
        fund.explanation = await getShapExplanation(fund.metrics);
      }));

      // Calculate benchmark comparison (async, but we'll handle it)
      let benchmarkComparison = null;
      let chartData = null;
      
      return {
        strategy: {
          name: strategy.name,
          description: strategy.description,
          icon: strategy.icon,
          tag: strategy.tag,
          riskLevel: strategyKey
        },
        summary: {
          totalInvestment: totalInvestment,
          totalProjectedValue: totalProjectedValue,
          totalGain: totalGain,
          overallReturn: totalWeightedReturn,
          annualizedReturn: totalWeightedReturn * 100,
          riskScore: totalWeightedRisk * 100,
          duration: duration
        },
        bucket: bucket,
        categorySummary: categorySummary,
        diversification: {
          fundCount: bucket.length,
          categoryCount: Object.keys(categorySummary).length
        },
        benchmarkComparison: benchmarkComparison,
        chartData: chartData
      };
    };
    
    // Generate 3 bucket options
    const bucketOptions = [];
    
    // 1. Recommended (user's selected risk level)
    const recommended = await generateBucket(riskLevel);
    recommended.isRecommended = true;
    recommended.label = 'Recommended';
    bucketOptions.push(recommended);
    
    // 2. Conservative Alternative (if not already low)
    if (riskLevel !== 'low') {
      const conservative = await generateBucket('low');
      conservative.isRecommended = false;
      conservative.label = 'Conservative Alternative';
      bucketOptions.push(conservative);
    }
    
    // 3. Aggressive Alternative (if not already high)
    if (riskLevel !== 'high') {
      const aggressive = await generateBucket('high');
      aggressive.isRecommended = false;
      aggressive.label = 'Aggressive Alternative';
      bucketOptions.push(aggressive);
    }
    
    // 4. Balanced Alternative (if user chose low or high)
    if (riskLevel !== 'medium') {
      const balanced = await generateBucket('medium');
      balanced.isRecommended = false;
      balanced.label = 'Balanced Alternative';
      bucketOptions.push(balanced);
    }
    
    // Add benchmark comparison to each bucket option using historical NAV data
    for (const option of bucketOptions) {
      try {
        // Get blended benchmark data
        const benchmarkData = await calculateBlendedBenchmark(option.bucket);
        
        // Calculate historical returns using NAV data
        const historicalComparison = await comparePortfolioWithBenchmarkHistorical(
          option.bucket,
          benchmarkData
        );
        
        // Check if we have valid historical data
        const hasHistoricalData = Object.values(historicalComparison.basketReturn).some(v => v !== null);
        
        // Always get projected returns for comparison
        const projectedComparison = await compareWithBenchmark(option.bucket, duration);
        
        if (hasHistoricalData) {
          // Use historical data as primary, but include projected
          const chart = generatePerformanceChartData(
            historicalComparison.basketReturn,
            historicalComparison.benchmarkReturn,
            duration,
            amount
          );
          option.benchmarkComparison = {
            ...historicalComparison,
            projectedReturn: projectedComparison.basketReturn,
            dataType: 'historical'
          };
          option.chartData = chart;
        } else {
          // Use projected returns with indicator
          console.log('No historical data available, using expected returns');
          const chart = generatePerformanceChartData(
            projectedComparison.basketReturn,
            projectedComparison.benchmarkReturn,
            duration,
            amount
          );
          option.benchmarkComparison = {
            ...projectedComparison,
            dataType: 'projected'
          };
          option.chartData = chart;
        }
      } catch (err) {
        console.error('Error calculating benchmark for option:', err);
        // Fallback to expected returns if error occurs
        try {
          const comparison = await compareWithBenchmark(option.bucket, duration);
          const chart = generatePerformanceChartData(
            comparison.basketReturn,
            comparison.benchmarkReturn,
            duration,
            amount
          );
          option.benchmarkComparison = {
            ...comparison,
            dataType: 'projected'
          };
          option.chartData = chart;
        } catch (fallbackErr) {
          console.error('Fallback benchmark calculation also failed:', fallbackErr);
        }
      }
    }
    
    res.json({
      generatedAt: new Date(),
      input: { amount, duration, riskLevel },
      bucketOptions: bucketOptions,
      totalOptions: bucketOptions.length
    });
    
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

function getExpectedReturnForCategory(cat) {
  const map = {
    large_cap: 0.12, mid_cap: 0.15, small_cap: 0.18,
    flexi_cap: 0.13, elss: 0.13, balanced: 0.10,
    debt: 0.07, liquid: 0.06, index: 0.12
  };
  return map[cat] || 0.12;
}

module.exports = router;
