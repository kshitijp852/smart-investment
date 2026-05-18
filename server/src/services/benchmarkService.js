// Benchmark Service for Blended Index Calculation
const axios = require('axios');
const Cache = require('../models/Cache');
const NAV = require('../models/NAV');
const { getFallbackReturns } = require('./marketDataService');

// Benchmark mapping for each category
const BENCHMARK_MAP = {
  'large_cap': 'NIFTY 50 TRI',
  'mid_cap': 'NIFTY Midcap 150 TRI',
  'small_cap': 'NIFTY Smallcap 250 TRI',
  'flexi_cap': 'NIFTY 500 TRI',
  'multi_cap': 'NIFTY 500 TRI',
  'elss': 'NIFTY 500 TRI',
  'value': 'NIFTY 500 TRI',
  'contra': 'NIFTY 500 TRI',
  'large_and_midcap': 'NIFTY 200 TRI',
  'hybrid_aggressive': 'CRISIL Hybrid 35+ TRI',
  'balanced': 'CRISIL Hybrid 35+ TRI',
  'hybrid_conservative': 'CRISIL Hybrid 15+ TRI',
  'debt': 'NIFTY 10yr G-Sec Index',
  'liquid': 'NIFTY Liquid Index',
  'index': 'NIFTY 50 TRI'
};

// Benchmark proxy scheme codes from our NAV collection
// Used to compute real returns instead of hardcoded values
const BENCHMARK_SCHEME_CODES = {
  'NIFTY 50 TRI': '120716',           // UTI Nifty 50 Index Fund - Direct
  'NIFTY Midcap 150 TRI': '120594',   // Edelweiss Mid Cap (proxy)
  'NIFTY Smallcap 250 TRI': '125352', // Axis Small Cap (proxy)
  'NIFTY 500 TRI': '100668',          // UTI Flexi Cap (proxy)
  'NIFTY 200 TRI': '120716',          // Nifty 50 as fallback
  'CRISIL Hybrid 35+ TRI': '120716',  // Nifty 50 as fallback
  'CRISIL Hybrid 15+ TRI': '119551',  // Debt fund proxy
  'NIFTY 10yr G-Sec Index': '119551', // Axis Banking PSU Debt proxy
  'NIFTY Liquid Index': '119551',     // Same debt proxy
};

/**
 * Compute annualised CAGR from getFallbackReturns() monthly array.
 * Used when NAV collection lacks sufficient history for a benchmark.
 */
function computeCAGRFromFallback(years) {
  const months = years * 12;
  const monthly = getFallbackReturns(months);
  const compound = monthly.reduce((acc, r) => acc * (1 + r), 1);
  return parseFloat((Math.pow(compound, 1 / years) - 1).toFixed(4));
}

/**
 * Get benchmark index for a fund category
 */
function getBenchmarkForCategory(category) {
  return BENCHMARK_MAP[category] || 'NIFTY 500 TRI';
}

/**
 * Fetch benchmark returns — queries NAV collection via BENCHMARK_SCHEME_CODES.
 * Falls back to deterministic getFallbackReturns() when NAV history is insufficient.
 */
async function fetchBenchmarkReturns(benchmarkName) {
  try {
    const cacheKey = `benchmark_${benchmarkName}`;
    const cached = await Cache.findOne({ key: cacheKey });

    if (cached && cached.timestamp) {
      const cacheAge = Date.now() - new Date(cached.timestamp).getTime();
      if (cacheAge < 24 * 60 * 60 * 1000) {
        return cached.data;
      }
    }

    const schemeCode = BENCHMARK_SCHEME_CODES[benchmarkName];
    let returns = null;

    if (schemeCode) {
      const records = await NAV.find({ schemeCode }).sort({ date: 1 }).lean();

      if (records.length >= 2) {
        const latest = records[records.length - 1];
        const latestDate = new Date(latest.date);

        const calcReturn = (daysBack) => {
          const targetDate = new Date(latestDate);
          targetDate.setDate(targetDate.getDate() - daysBack);
          const past = [...records].reverse().find(r => new Date(r.date) <= targetDate);
          if (!past || past.nav === 0) return null;
          const years = daysBack / 365;
          return years >= 1
            ? Math.pow(latest.nav / past.nav, 1 / years) - 1
            : (latest.nav - past.nav) / past.nav;
        };

        const r1Y = calcReturn(365);
        const r3Y = calcReturn(1095);
        const r5Y = calcReturn(1825);

        if (r1Y !== null) {
          returns = {
            '1Y': parseFloat(r1Y.toFixed(4)),
            '3Y': r3Y !== null ? parseFloat(r3Y.toFixed(4)) : computeCAGRFromFallback(3),
            '5Y': r5Y !== null ? parseFloat(r5Y.toFixed(4)) : computeCAGRFromFallback(5),
            'SI': parseFloat(r1Y.toFixed(4)),
            source: 'real_nav'
          };
        }
      }
    }

    if (!returns) {
      returns = {
        '1Y': computeCAGRFromFallback(1),
        '3Y': computeCAGRFromFallback(3),
        '5Y': computeCAGRFromFallback(5),
        'SI': computeCAGRFromFallback(1),
        source: 'fallback'
      };
    }

    await Cache.findOneAndUpdate(
      { key: cacheKey },
      { key: cacheKey, data: returns, timestamp: new Date() },
      { upsert: true, new: true }
    );

    return returns;
  } catch (error) {
    console.error('Error fetching benchmark returns:', error);
    return {
      '1Y': computeCAGRFromFallback(1),
      '3Y': computeCAGRFromFallback(3),
      '5Y': computeCAGRFromFallback(5),
      'SI': computeCAGRFromFallback(1),
      source: 'fallback'
    };
  }
}

/**
 * Calculate blended benchmark return for a basket
 */
async function calculateBlendedBenchmark(basket) {
  try {
    const categoryWeights = {};
    const benchmarkComponents = [];

    // Normalize: handle both percentage (sum ~100) and raw allocation amounts
    const total = basket.reduce((sum, f) => sum + (f.percentage || f.allocation || 0), 0);
    const useAllocation = total > 200;

    basket.forEach(fund => {
      const category = fund.category || 'flexi_cap';
      const weight = useAllocation
        ? (fund.allocation || 0) / total
        : (fund.percentage || 0) / 100;

      if (!categoryWeights[category]) categoryWeights[category] = 0;
      categoryWeights[category] += weight;
    });

    // Weights already normalized since we divided by total above
    const blendedReturns = { '1Y': 0, '3Y': 0, '5Y': 0, 'SI': 0 };

    for (const [category, weight] of Object.entries(categoryWeights)) {
      const benchmarkIndex = getBenchmarkForCategory(category);
      const benchmarkReturns = await fetchBenchmarkReturns(benchmarkIndex);

      benchmarkComponents.push({
        category,
        benchmarkIndex,
        weight: weight * 100
      });

      Object.keys(blendedReturns).forEach(period => {
        blendedReturns[period] += (benchmarkReturns[period] || 0) * weight;
      });
    }

    return {
      benchmarkName: 'Blended Index',
      benchmarkComponents,
      benchmarkReturn: blendedReturns
    };
  } catch (error) {
    console.error('Error calculating blended benchmark:', error);
    throw error;
  }
}

/**
 * Calculate basket returns for different time periods
 * Looks up real CAGR values from FundHistory by schemeCode.
 * Falls back to fund.expectedReturn if not found.
 */
async function calculateBasketReturns(basket, duration) {
  const FundHistory = require('../models/FundHistory');
  const basketReturns = { '1Y': 0, '3Y': 0, '5Y': 0, 'SI': 0 };

  // Normalize weights — handle both percentage (sum ~100) and raw allocation amounts
  const total = basket.reduce((sum, f) => sum + (f.percentage || f.allocation || 0), 0);
  const useAllocation = total > 200;

  for (const fund of basket) {
    const weight = useAllocation
      ? (fund.allocation || 0) / total
      : (fund.percentage || 0) / 100;

    if (weight <= 0) continue;

    // Try to get real period CAGR from FundHistory
    const schemeCode = fund.meta?.schemeCode || fund.symbol || fund.schemeCode;
    let cagr1Y = null, cagr3Y = null, cagr5Y = null;

    if (schemeCode) {
      try {
        const fh = await FundHistory.findOne(
          { schemeCode: String(schemeCode), status: 'fetched' },
          { 'metrics.cagr1Y': 1, 'metrics.cagr3Y': 1, 'metrics.cagr5Y': 1 }
        ).lean();

        if (fh?.metrics) {
          cagr1Y = fh.metrics.cagr1Y ?? null;
          cagr3Y = fh.metrics.cagr3Y ?? null;
          cagr5Y = fh.metrics.cagr5Y ?? null;
        }
      } catch (e) {
        // DB lookup failed — fall through to expectedReturn
      }
    }

    // Fall back to expectedReturn if CAGR not available
    const fallback = fund.expectedReturn || 0;
    basketReturns['1Y'] += (cagr1Y ?? fallback) * weight;
    basketReturns['3Y'] += (cagr3Y ?? fallback) * weight;
    basketReturns['5Y'] += (cagr5Y ?? fallback) * weight;
    basketReturns['SI'] += fallback * weight;
  }

  return basketReturns;
}

/**
 * Compare basket performance against blended benchmark
 */
async function compareWithBenchmark(basket, duration) {
  try {
    // Calculate basket returns (now async — queries FundHistory for real CAGR)
    const basketReturn = await calculateBasketReturns(basket, duration);

    // Calculate blended benchmark
    const benchmarkData = await calculateBlendedBenchmark(basket);

    // Calculate differences
    const difference = {};
    const beatsBenchmark = {};

    Object.keys(basketReturn).forEach(period => {
      difference[period] = basketReturn[period] - benchmarkData.benchmarkReturn[period];
      beatsBenchmark[period] = difference[period] > 0;
    });

    return {
      basketReturn: basketReturn,
      benchmarkName: benchmarkData.benchmarkName,
      benchmarkComponents: benchmarkData.benchmarkComponents,
      benchmarkReturn: benchmarkData.benchmarkReturn,
      difference: difference,
      beatsBenchmark: beatsBenchmark
    };
  } catch (error) {
    console.error('Error comparing with benchmark:', error);
    throw error;
  }
}

/**
 * Generate performance chart data
 */
function generatePerformanceChartData(basketReturn, benchmarkReturn, duration, initialInvestment) {
  const periods = ['1Y', '3Y', '5Y', 'SI'];
  const chartData = [];

  periods.forEach(period => {
    const years = period === '1Y' ? 1 : period === '3Y' ? 3 : period === '5Y' ? 5 : duration;
    
    if (years <= duration) {
      const basketValue = initialInvestment * Math.pow(1 + basketReturn[period], years);
      const benchmarkValue = initialInvestment * Math.pow(1 + benchmarkReturn[period], years);
      
      chartData.push({
        period: period,
        years: years,
        basketValue: basketValue,
        benchmarkValue: benchmarkValue,
        basketReturn: basketReturn[period] * 100,
        benchmarkReturn: benchmarkReturn[period] * 100
      });
    }
  });

  return chartData;
}



/**
 * Calculate blended benchmark using real NAV data
 * @param {Array} holdings - Array of {schemeCode, allocation}
 * @param {Date} startDate - Start date for comparison
 * @param {Date} endDate - End date for comparison (default: today)
 */
async function calculateBlendedBenchmarkWithNAV(holdings, startDate, endDate = new Date()) {
  try {
    const benchmarkComponents = [];
    let totalWeight = 0;
    
    // Get category for each holding
    for (const holding of holdings) {
      const latestNAV = await NAV.getLatestNAV(holding.schemeCode);
      
      if (!latestNAV) continue;
      
      const category = latestNAV.category;
      const benchmarkIndex = getBenchmarkForCategory(category);
      const weight = holding.allocation / 100;
      
      benchmarkComponents.push({
        schemeCode: holding.schemeCode,
        schemeName: latestNAV.schemeName,
        category: category,
        benchmarkIndex: benchmarkIndex,
        weight: holding.allocation
      });
      
      totalWeight += weight;
    }
    
    // Normalize weights
    benchmarkComponents.forEach(comp => {
      comp.weight = (comp.weight / (totalWeight * 100)) * 100;
    });
    
    // Calculate weighted benchmark returns
    const benchmarkReturns = await fetchBenchmarkReturns('NIFTY 500 TRI');
    
    return {
      benchmarkName: 'Blended Index',
      benchmarkComponents: benchmarkComponents,
      benchmarkReturn: benchmarkReturns,
      startDate: startDate,
      endDate: endDate
    };
  } catch (error) {
    console.error('Error calculating blended benchmark with NAV:', error);
    throw error;
  }
}

/**
 * Compare portfolio performance with blended benchmark using real NAV data
 * @param {Array} holdings - Array of {schemeCode, units, investmentDate}
 */
async function comparePortfolioWithBenchmark(holdings) {
  try {
    const portfolioReturns = {};
    const benchmarkData = [];
    
    for (const holding of holdings) {
      const { schemeCode, units, investmentDate } = holding;
      
      // Get investment NAV
      const investmentNAV = await NAV.findOne({
        schemeCode,
        date: { $lte: new Date(investmentDate) }
      }).sort({ date: -1 }).limit(1);
      
      if (!investmentNAV) continue;
      
      // Get latest NAV
      const latestNAV = await NAV.getLatestNAV(schemeCode);
      
      if (!latestNAV) continue;
      
      // Calculate return
      const investedAmount = units * investmentNAV.nav;
      const currentValue = units * latestNAV.nav;
      const returnPct = ((currentValue - investedAmount) / investedAmount) * 100;
      
      portfolioReturns[schemeCode] = {
        schemeName: latestNAV.schemeName,
        category: latestNAV.category,
        return: returnPct,
        investedAmount: investedAmount,
        currentValue: currentValue
      };
      
      // Get benchmark for category
      const benchmarkIndex = getBenchmarkForCategory(latestNAV.category);
      benchmarkData.push({
        category: latestNAV.category,
        benchmarkIndex: benchmarkIndex,
        weight: investedAmount
      });
    }
    
    // Calculate total invested
    const totalInvested = Object.values(portfolioReturns)
      .reduce((sum, h) => sum + h.investedAmount, 0);
    
    // Calculate weighted portfolio return
    const portfolioReturn = Object.values(portfolioReturns)
      .reduce((sum, h) => sum + (h.return * h.investedAmount / totalInvested), 0);
    
    // Calculate weighted benchmark return
    const benchmarkReturn = await calculateWeightedBenchmarkReturn(benchmarkData, totalInvested);
    
    return {
      success: true,
      portfolioReturn: portfolioReturn,
      benchmarkReturn: benchmarkReturn,
      difference: portfolioReturn - benchmarkReturn,
      beatsBenchmark: portfolioReturn > benchmarkReturn,
      holdings: portfolioReturns,
      benchmarkComponents: benchmarkData
    };
  } catch (error) {
    console.error('Error comparing portfolio with benchmark:', error);
    throw error;
  }
}

/**
 * Calculate weighted benchmark return
 */
async function calculateWeightedBenchmarkReturn(benchmarkData, totalInvested) {
  let weightedReturn = 0;
  
  for (const data of benchmarkData) {
    const weight = data.weight / totalInvested;
    const benchmarkReturns = await fetchBenchmarkReturns(data.benchmarkIndex);
    
    // Use 1Y return as default
    const benchmarkReturn = benchmarkReturns['1Y'] || 0.12;
    weightedReturn += benchmarkReturn * weight * 100;
  }
  
  return weightedReturn;
}

module.exports = {
  getBenchmarkForCategory,
  fetchBenchmarkReturns,
  calculateBlendedBenchmark,
  calculateBasketReturns,
  compareWithBenchmark,
  generatePerformanceChartData,
  calculateBlendedBenchmarkWithNAV,
  comparePortfolioWithBenchmark,
  BENCHMARK_MAP
};

