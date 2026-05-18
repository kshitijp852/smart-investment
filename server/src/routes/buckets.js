const express = require('express');
const router = express.Router();
const FinancialData = require('../models/FinancialData');
const { cagr, computeReturns, recencyWeightedCAGR } = require('../utils/analytics');
const {
  sharpeRatio,
  sortinoRatio,
  beta,
  treynorRatio,
  alpha,
  informationRatio,
  standardDeviation,
  calculateFundScore,
  generateMarketReturns,
  getExpenseRatioForCategory,
  getTurnoverRatioForCategory
} = require('../utils/advancedAnalytics');
const { getMarketReturns, getFallbackReturns } = require('../services/marketDataService');
const {
  compareWithBenchmark,
  generatePerformanceChartData
} = require('../services/benchmarkService');

// Generate multiple diversified bucket options with advanced scoring
router.post('/generate', async (req, res) => {
  try {
    const { amount = 100000, duration = 3, riskLevel = 'medium' } = req.body;
    
    // Fetch all mutual funds
    const allFunds = await FinancialData.find({ type: 'mutual_fund' }).lean();
    
    if (allFunds.length === 0) {
      return res.status(404).json({ 
        message: 'No mutual funds available. Please load sample data first.' 
      });
    }
    
    // Fetch real Nifty 50 market returns once for beta/alpha computation
    let marketReturnsPool;
    try {
      marketReturnsPool = await getMarketReturns(120);
    } catch (_) {
      marketReturnsPool = getFallbackReturns(120);
    }

    // Calculate comprehensive metrics for each fund
    const fundsWithMetrics = allFunds.map(fund => {
      const priceHistory = fund.priceHistory || [];
      const returns = computeReturns(priceHistory);
      if (!returns || returns.length < 2) return null;

      const mktLen = returns.length;
      const marketReturns = marketReturnsPool.length >= mktLen
        ? marketReturnsPool.slice(-mktLen)
        : [...getFallbackReturns(mktLen - marketReturnsPool.length), ...marketReturnsPool];

      const fundCAGR = recencyWeightedCAGR(priceHistory) || cagr(priceHistory) || 0;
      const fundBeta = beta(returns, marketReturns);

      return {
        ...fund,
        calculatedReturn: fundCAGR,
        metrics: {
          sharpeRatio:       sharpeRatio(returns),
          sortinoRatio:      sortinoRatio(returns),
          beta:              fundBeta,
          treynorRatio:      treynorRatio(returns, fundBeta),
          alpha:             alpha(returns, marketReturns, fundBeta),
          informationRatio:  informationRatio(returns, marketReturns),
          standardDeviation: standardDeviation(returns),
          expenseRatio:      getExpenseRatioForCategory(fund.meta?.category),
          turnoverRatio:     getTurnoverRatioForCategory(fund.meta?.category)
        }
      };
    }).filter(f => f !== null);

    // Per-category metric pools for category-aware normalization
    const metricsByCategory = {};
    fundsWithMetrics.forEach(fund => {
      const cat = fund.meta?.category || 'other';
      if (!metricsByCategory[cat]) metricsByCategory[cat] = [];
      metricsByCategory[cat].push(fund.metrics);
    });

    const allMetrics = fundsWithMetrics.map(f => f.metrics);
    const scoredFunds = fundsWithMetrics.map(fund => {
      const cat             = fund.meta?.category || 'other';
      const categoryMetrics = metricsByCategory[cat];
      const scoreData       = calculateFundScore(fund.metrics, allMetrics, categoryMetrics, riskLevel);
      return {
        ...fund,
        finalScore:     scoreData.finalScore,
        scoreBreakdown: scoreData
      };
    });
    
    // Define bucket allocation strategies based on risk level
    const bucketStrategies = {
      low: {
        name: 'Conservative Portfolio',
        description: 'Focus on capital preservation with steady returns',
        allocation: {
          debt: 0.40,      // 40% Debt funds
          liquid: 0.25,    // 25% Liquid funds
          balanced: 0.20,  // 20% Balanced funds
          large_cap: 0.10, // 10% Large cap
          index: 0.05      // 5% Index funds
        },
        icon: '🛡️'
      },
      medium: {
        name: 'Balanced Portfolio',
        description: 'Mix of growth and stability for moderate returns',
        allocation: {
          large_cap: 0.25,   // 25% Large cap
          flexi_cap: 0.20,   // 20% Flexi cap
          balanced: 0.20,    // 20% Balanced funds
          mid_cap: 0.15,     // 15% Mid cap
          debt: 0.10,        // 10% Debt funds
          index: 0.05,       // 5% Index funds
          elss: 0.05         // 5% ELSS (tax saving)
        },
        icon: '⚖️'
      },
      high: {
        name: 'Aggressive Portfolio',
        description: 'Maximum growth potential with higher volatility',
        allocation: {
          mid_cap: 0.25,     // 25% Mid cap
          small_cap: 0.20,   // 20% Small cap
          large_cap: 0.20,   // 20% Large cap
          flexi_cap: 0.15,   // 15% Flexi cap
          elss: 0.10,        // 10% ELSS
          balanced: 0.05,    // 5% Balanced funds
          index: 0.05        // 5% Index funds
        },
        icon: '🚀'
      }
    };
    
    const strategy = bucketStrategies[riskLevel];
    
    // Select top funds for each category based on allocation
    const bucket = [];
    let totalWeightedReturn = 0;
    let totalWeightedRisk = 0;
    
    for (const [category, percentage] of Object.entries(strategy.allocation)) {
      // Get top funds in this category based on final score
      const categoryFunds = scoredFunds
        .filter(f => f.meta?.category === category)
        .sort((a, b) => {
          // Primary sort by final score
          if (Math.abs(b.finalScore - a.finalScore) > 0.1) {
            return b.finalScore - a.finalScore;
          }
          // Tie-breaker 1: Higher Sortino
          if (Math.abs(b.metrics.sortinoRatio - a.metrics.sortinoRatio) > 0.1) {
            return b.metrics.sortinoRatio - a.metrics.sortinoRatio;
          }
          // Tie-breaker 2: Lower SD
          if (Math.abs(a.metrics.standardDeviation - b.metrics.standardDeviation) > 0.01) {
            return a.metrics.standardDeviation - b.metrics.standardDeviation;
          }
          // Tie-breaker 3: Lower expense ratio
          return a.metrics.expenseRatio - b.metrics.expenseRatio;
        })
        .slice(0, 2); // Top 2 funds per category
      
      if (categoryFunds.length > 0) {
        // Distribute percentage among selected funds
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
            // Include detailed metrics
            finalScore: fund.finalScore,
            metrics: {
              sharpeRatio: fund.metrics.sharpeRatio,
              sortinoRatio: fund.metrics.sortinoRatio,
              treynorRatio: fund.metrics.treynorRatio,
              alpha: fund.metrics.alpha,
              beta: fund.metrics.beta,
              informationRatio: fund.metrics.informationRatio,
              standardDeviation: fund.metrics.standardDeviation,
              expenseRatio: fund.metrics.expenseRatio,
              turnoverRatio: fund.metrics.turnoverRatio
            },
            scoreBreakdown: fund.scoreBreakdown
          });
          
          // Calculate weighted metrics
          totalWeightedReturn += fund.calculatedReturn * perFundPercentage;
          totalWeightedRisk += fund.metrics.standardDeviation * perFundPercentage;
        });
      }
    }
    
    // Calculate bucket summary
    const totalProjectedValue = bucket.reduce((sum, f) => sum + f.projectedValue, 0);
    const totalGain = totalProjectedValue - amount;
    const overallReturn = totalWeightedReturn;
    
    // Group by category for display
    const categorySummary = {};
    bucket.forEach(fund => {
      if (!categorySummary[fund.category]) {
        categorySummary[fund.category] = {
          totalAllocation: 0,
          totalPercentage: 0,
          funds: []
        };
      }
      categorySummary[fund.category].totalAllocation += fund.allocation;
      categorySummary[fund.category].totalPercentage += fund.percentage;
      categorySummary[fund.category].funds.push(fund);
    });
    
    // Calculate benchmark comparison
    let benchmarkComparison = null;
    let chartData = null;
    try {
      benchmarkComparison = await compareWithBenchmark(bucket, duration);
      chartData = generatePerformanceChartData(
        benchmarkComparison.basketReturn,
        benchmarkComparison.benchmarkReturn,
        duration,
        amount
      );
    } catch (err) {
      console.error('Error calculating benchmark:', err);
    }

    res.json({
      generatedAt: new Date(),
      input: { amount, duration, riskLevel },
      strategy: {
        name: strategy.name,
        description: strategy.description,
        icon: strategy.icon
      },
      summary: {
        totalInvestment: amount,
        totalProjectedValue: totalProjectedValue,
        totalGain: totalGain,
        overallReturn: overallReturn,
        annualizedReturn: overallReturn * 100,
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
    });
    
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
