
// Simple analytics helpers: compute returns, volatility, CAGR, Sharpe-like metric
function computeReturns(history){
  // history: [{date, close}] chronological
  if (!history || history.length<2) return null;
  const returns = [];
  for (let i=1;i<history.length;i++){
    const r = (history[i].close - history[i-1].close)/history[i-1].close;
    returns.push(r);
  }
  return returns;
}

function mean(arr){
  if (!arr || arr.length===0) return 0;
  return arr.reduce((a,b)=>a+b,0)/arr.length;
}

function std(arr){
  if (!arr || arr.length<2) return 0;
  const m = mean(arr);
  const v = arr.reduce((s,x)=>s + (x-m)*(x-m),0)/(arr.length-1);
  return Math.sqrt(v);
}

function cagr(history){
  if (!history || history.length<2) return 0;
  const start = history[0].close;
  const end = history[history.length-1].close;
  const years = (new Date(history[history.length-1].date).getTime() - new Date(history[0].date).getTime())/(1000*60*60*24*365);
  if (years<=0) return 0;
  return Math.pow(end/start, 1/years)-1;
}

// Sharpe-like: (mean monthly return *12 - rf) / (std monthly * sqrt(12))
function sharpeLike(history, riskFree=0.03){
  const r = computeReturns(history);
  if (!r) return 0;
  const m = mean(r);
  const s = std(r);
  if (s===0) return 0;
  const annualReturn = Math.pow(1+m,12)-1;
  const annualStd = s*Math.sqrt(12);
  return (annualReturn - riskFree)/annualStd;
}

/**
 * Apply category-based bounds to expected returns
 * Prevents unrealistic projections by capping historical CAGR
 * @param {number} cagr - Historical CAGR from price data
 * @param {string} category - Fund category (liquid, debt, large_cap, etc.)
 * @returns {number} - Bounded expected return
 */
function applyExpectedReturnBounds(cagr, category) {
  const fs = require('fs');
  const path = require('path');
  
  try {
    // Load expected returns config
    const configPath = path.join(__dirname, '../config/expected-returns.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    
    // Normalize category (handle undefined, convert to lowercase)
    const normalizedCategory = (category || 'default').toLowerCase();
    
    // Get bounds for category, fallback to default
    const bounds = config[normalizedCategory] || config['default'];
    
    // Clamp CAGR within bounds
    const boundedReturn = Math.max(bounds.min, Math.min(bounds.max, cagr));
    
    return boundedReturn;
  } catch (error) {
    console.error('Error loading expected returns config:', error);
    // Fallback: clamp to conservative 5-12% range
    return Math.max(0.05, Math.min(0.12, cagr));
  }
}

/**
 * Recency-weighted CAGR — blends sub-period returns with decaying weights.
 *
 * Weights: 1Y = 50%, 3Y = 30%, 5Y = 20%
 * Rationale: recent performance predicts near-term outcomes better than
 * a single long-horizon point-to-point CAGR that can be dominated by
 * a single strong or weak period from years ago.
 *
 * Falls back gracefully:
 *   Only 1Y + 3Y available → 60/40 blend
 *   Only 1Y available      → use 1Y CAGR
 *   None available          → overall CAGR (original behaviour)
 *
 * @param {Array} history - [{date, close}] sorted chronologically
 * @returns {number}
 */
function recencyWeightedCAGR(history) {
  if (!history || history.length < 2) return 0;

  const sorted     = [...history].sort((a, b) => new Date(a.date) - new Date(b.date));
  const latest     = sorted[sorted.length - 1];
  const latestDate = new Date(latest.date);
  const latestNav  = latest.close ?? latest.nav ?? 0;
  if (latestNav === 0) return 0;

  const findAt = (daysBack) => {
    const target = new Date(latestDate);
    target.setDate(target.getDate() - daysBack);
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (new Date(sorted[i].date) <= target) return sorted[i];
    }
    return null;
  };

  const rec1Y = findAt(365);
  const rec3Y = findAt(1095);
  const rec5Y = findAt(1825);

  const nav = (r) => r?.close ?? r?.nav ?? 0;

  const r1Y = rec1Y && nav(rec1Y) > 0 ? (latestNav / nav(rec1Y)) - 1 : null;
  const r3Y = rec3Y && nav(rec3Y) > 0 ? Math.pow(latestNav / nav(rec3Y), 1 / 3) - 1 : null;
  const r5Y = rec5Y && nav(rec5Y) > 0 ? Math.pow(latestNav / nav(rec5Y), 1 / 5) - 1 : null;

  if (r1Y !== null && r3Y !== null && r5Y !== null) return r1Y * 0.50 + r3Y * 0.30 + r5Y * 0.20;
  if (r1Y !== null && r3Y !== null)                 return r1Y * 0.60 + r3Y * 0.40;
  if (r1Y !== null)                                  return r1Y;
  return cagr(history);
}

module.exports = { computeReturns, mean, std, cagr, recencyWeightedCAGR, sharpeLike, applyExpectedReturnBounds };
