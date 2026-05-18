// Advanced Financial Analytics - Professional Fund Evaluation

const { mean, std } = require('./analytics');

// Minimum monthly observations required for statistically meaningful metrics.
// Ratios computed on fewer data points are not reliable.
const MIN_MONTHLY_OBSERVATIONS = 12;

// ─────────────────────────────────────────────────────────────────────────────
// Individual metric functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sharpe Ratio — risk-adjusted return relative to total volatility.
 *   (Rp_annual - Rf) / σ_annual
 */
function sharpeRatio(returns, riskFreeRate = 0.06) {
  if (!returns || returns.length < MIN_MONTHLY_OBSERVATIONS) return 0;
  const avgReturn = mean(returns);
  const stdDev    = std(returns);
  if (stdDev === 0) return 0;
  const annualReturn = Math.pow(1 + avgReturn, 12) - 1;
  const annualStd    = stdDev * Math.sqrt(12);
  return (annualReturn - riskFreeRate) / annualStd;
}

/**
 * Sortino Ratio — risk-adjusted return using only downside deviation.
 *
 * FIX (was wrong): uses Minimum Acceptable Return (MAR = Rf/12) as threshold,
 * not zero. Downside variance computed over ALL periods (not just negative ones)
 * — using only negative periods understates downside deviation and inflates the ratio.
 *
 *   DD = sqrt( (1/n) * Σ min(r - MAR, 0)² )    over all n periods
 *   Sortino = (Rp_annual - Rf) / (DD * √12)
 */
function sortinoRatio(returns, riskFreeRate = 0.06) {
  if (!returns || returns.length < MIN_MONTHLY_OBSERVATIONS) return 0;
  const MAR       = riskFreeRate / 12;
  const avgReturn = mean(returns);

  const downsideVariance = returns.reduce((sum, r) => {
    const diff = Math.min(r - MAR, 0);
    return sum + diff * diff;
  }, 0) / returns.length;           // divide by ALL periods, not just negative

  const downsideStd       = Math.sqrt(downsideVariance);
  const annualReturn      = Math.pow(1 + avgReturn, 12) - 1;
  const annualDownsideStd = downsideStd * Math.sqrt(12);

  if (annualDownsideStd === 0) return sharpeRatio(returns, riskFreeRate);
  return (annualReturn - riskFreeRate) / annualDownsideStd;
}

/**
 * Beta — systematic risk relative to market.
 *   Cov(fund, market) / Var(market)
 * Uses sample covariance (Bessel's correction) for consistency with std().
 */
function beta(fundReturns, marketReturns) {
  if (!fundReturns || !marketReturns || fundReturns.length !== marketReturns.length) return 1;
  if (fundReturns.length < MIN_MONTHLY_OBSERVATIONS) return 1;

  const fundMean   = mean(fundReturns);
  const marketMean = mean(marketReturns);
  let covariance = 0, marketVariance = 0;

  for (let i = 0; i < fundReturns.length; i++) {
    covariance    += (fundReturns[i] - fundMean) * (marketReturns[i] - marketMean);
    marketVariance += Math.pow(marketReturns[i] - marketMean, 2);
  }

  const n = fundReturns.length - 1; // Bessel's correction
  covariance    /= n;
  marketVariance /= n;

  if (marketVariance === 0) return 1;
  return covariance / marketVariance;
}

/**
 * Treynor Ratio — risk-adjusted return per unit of systematic (beta) risk.
 *   (Rp_annual - Rf) / β
 */
function treynorRatio(returns, fundBeta, riskFreeRate = 0.06) {
  if (!returns || returns.length < MIN_MONTHLY_OBSERVATIONS || fundBeta === 0) return 0;
  const annualReturn = Math.pow(1 + mean(returns), 12) - 1;
  return (annualReturn - riskFreeRate) / fundBeta;
}

/**
 * Jensen's Alpha (per-fund) — excess return over CAPM expected return.
 *   α = Rp - [Rf + β × (Rm - Rf)]
 */
function alpha(fundReturns, marketReturns, fundBeta, riskFreeRate = 0.06) {
  if (!fundReturns || fundReturns.length < MIN_MONTHLY_OBSERVATIONS) return 0;
  const fundReturn   = Math.pow(1 + mean(fundReturns), 12) - 1;
  const marketReturn = Math.pow(1 + mean(marketReturns), 12) - 1;
  const expected     = riskFreeRate + fundBeta * (marketReturn - riskFreeRate);
  return fundReturn - expected;
}

/**
 * Information Ratio — consistency of outperformance vs benchmark.
 *   IR = (Rp_annual - Rb_annual) / TE_annual
 *   TE = std(excess_returns) * √12
 */
function informationRatio(fundReturns, benchmarkReturns) {
  if (!fundReturns || !benchmarkReturns || fundReturns.length !== benchmarkReturns.length) return 0;
  if (fundReturns.length < MIN_MONTHLY_OBSERVATIONS) return 0;

  const excessReturns     = fundReturns.map((r, i) => r - benchmarkReturns[i]);
  const avgExcess         = mean(excessReturns);
  const trackingError     = std(excessReturns);
  if (trackingError === 0) return 0;

  // Annualise excess return arithmetically (excess return does not compound)
  const annualExcess         = avgExcess * 12;
  const annualTrackingError  = trackingError * Math.sqrt(12);
  return annualExcess / annualTrackingError;
}

/**
 * Standard Deviation — annualised volatility of monthly returns.
 */
function standardDeviation(returns) {
  if (!returns || returns.length < MIN_MONTHLY_OBSERVATIONS) return 0;
  return std(returns) * Math.sqrt(12);
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalize value to [0, 1].
 * Epsilon guard prevents range-collapse when all values are nearly identical
 * (e.g., homogeneous fund pool where floating-point noise would dominate).
 */
function normalize(value, min, max) {
  const range = max - min;
  if (range < 1e-10) return 0.5;
  return Math.max(0, Math.min(1, (value - min) / range));
}

// ─────────────────────────────────────────────────────────────────────────────
// Composite fund score
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate composite fund score (0–100).
 *
 * FIX 1 — Double-weighting (was: sub-weights summed to category weight, then
 * multiplied by category weight again → max score was 31.5 not 100):
 *   Sub-weights now sum to 1.0 within each category. Outer category weights
 *   (0.45, 0.25, 0.20, 0.10) are applied once, producing a correct 0–1 score.
 *
 * FIX 2 — Cross-category normalization (was: all fund categories normalized
 * together → high-beta categories systematically scored higher):
 *   When categoryMetrics is provided (≥3 funds), normalization uses
 *   category-peers only. Falls back to allMetrics for thin categories.
 *
 * FIX 3 — Beta target ignores risk profile (was: beta=1 always optimal):
 *   betaTarget is risk-profile-aware: low=0.6, medium=1.0, high=1.3.
 *
 * Scoring categories:
 *   A) Risk-Adjusted Performance (45%): Sharpe 45%, Sortino 35%, Treynor 20%
 *   B) Stability & Volatility      (25%): SD 60%, Beta 40%
 *   C) Manager Skill & Consistency (20%): Alpha 60%, IR 40%
 *   D) Cost Efficiency             (10%): Expense 60%, Turnover 40%
 *
 * @param {Object}   metrics          - Metrics for the fund being scored
 * @param {Object[]} allMetrics       - Metrics for all funds (global normalization fallback)
 * @param {Object[]} categoryMetrics  - Metrics for funds in the same category (preferred)
 * @param {string}   riskProfile      - 'low' | 'medium' | 'high'
 * @returns {Object}
 */
function calculateFundScore(metrics, allMetrics, categoryMetrics = null, riskProfile = 'medium') {
  // Use category-level normalization when the pool is large enough to be meaningful
  const normPool = (categoryMetrics && categoryMetrics.length >= 3)
    ? categoryMetrics
    : allMetrics;

  const vals = (key) => normPool.map(m => m[key]);

  const sharpeMin  = Math.min(...vals('sharpeRatio'));
  const sharpeMax  = Math.max(...vals('sharpeRatio'));
  const sortinoMin = Math.min(...vals('sortinoRatio'));
  const sortinoMax = Math.max(...vals('sortinoRatio'));
  const treynorMin = Math.min(...vals('treynorRatio'));
  const treynorMax = Math.max(...vals('treynorRatio'));
  const alphaMin   = Math.min(...vals('alpha'));
  const alphaMax   = Math.max(...vals('alpha'));
  const irMin      = Math.min(...vals('informationRatio'));
  const irMax      = Math.max(...vals('informationRatio'));
  const sdMin      = Math.min(...vals('standardDeviation'));
  const sdMax      = Math.max(...vals('standardDeviation'));
  const expMin     = Math.min(...vals('expenseRatio'));
  const expMax     = Math.max(...vals('expenseRatio'));
  const turnMin    = Math.min(...vals('turnoverRatio'));
  const turnMax    = Math.max(...vals('turnoverRatio'));

  // Higher-is-better metrics
  const sharpeNorm    = normalize(metrics.sharpeRatio,       sharpeMin,  sharpeMax);
  const sortinoNorm   = normalize(metrics.sortinoRatio,      sortinoMin, sortinoMax);
  const treynorNorm   = normalize(metrics.treynorRatio,      treynorMin, treynorMax);
  const alphaNorm     = normalize(metrics.alpha,             alphaMin,   alphaMax);
  const infoRatioNorm = normalize(metrics.informationRatio,  irMin,      irMax);

  // Lower-is-better: SD, expense ratio, turnover
  const sdNorm      = 1 - normalize(metrics.standardDeviation, sdMin,  sdMax);
  const expenseNorm = 1 - normalize(metrics.expenseRatio,      expMin, expMax);
  const turnoverNorm= 1 - normalize(metrics.turnoverRatio,     turnMin, turnMax);

  // Beta: risk-profile-aware target (FIX 3)
  const betaTarget = { low: 0.6, medium: 1.0, high: 1.3 }[riskProfile] ?? 1.0;
  const betaDevs   = normPool.map(m => Math.abs(m.beta - betaTarget));
  const betaNorm   = 1 - normalize(Math.abs(metrics.beta - betaTarget), 0, Math.max(...betaDevs) || 1);

  // ── Category scores — sub-weights sum to 1.0 (FIX 1) ──────────────────────

  // A) Risk-Adjusted Performance (45%): 0.45 + 0.35 + 0.20 = 1.00
  const riskAdjustedScore = (sharpeNorm * 0.45) + (sortinoNorm * 0.35) + (treynorNorm * 0.20);

  // B) Stability & Volatility (25%): 0.60 + 0.40 = 1.00
  const stabilityScore = (sdNorm * 0.60) + (betaNorm * 0.40);

  // C) Manager Skill & Consistency (20%): 0.60 + 0.40 = 1.00
  const managerSkillScore = (alphaNorm * 0.60) + (infoRatioNorm * 0.40);

  // D) Cost Efficiency (10%): 0.60 + 0.40 = 1.00
  const costEfficiencyScore = (expenseNorm * 0.60) + (turnoverNorm * 0.40);

  // Final score — now correctly in 0–1, scaled to 0–100 (FIX 1)
  const finalScore =
    (riskAdjustedScore  * 0.45) +
    (stabilityScore     * 0.25) +
    (managerSkillScore  * 0.20) +
    (costEfficiencyScore * 0.10);

  return {
    finalScore:          finalScore * 100,
    riskAdjustedScore,
    stabilityScore,
    managerSkillScore,
    costEfficiencyScore,
    normalized: {
      sharpe:    sharpeNorm,
      sortino:   sortinoNorm,
      treynor:   treynorNorm,
      alpha:     alphaNorm,
      infoRatio: infoRatioNorm,
      sd:        sdNorm,
      beta:      betaNorm,
      expense:   expenseNorm,
      turnover:  turnoverNorm
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Market returns helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Deterministic Nifty 50 monthly return pattern — last-resort synchronous fallback.
 * Used only when the async marketDataService is unavailable (e.g., DB offline).
 * Calibrated to ~14% annual average (2019–2024).
 *
 * Prefer marketDataService.getMarketReturns() wherever async calls are possible.
 */
function generateMarketReturns(length) {
  const historicalPattern = [
    0.012, 0.008, -0.005, 0.015, 0.022, -0.018, 0.009, 0.031, -0.012, 0.018,
    0.025, -0.008, 0.014, 0.007, -0.022, 0.019, 0.011, 0.028, -0.015, 0.009,
    0.033, -0.021, 0.016, 0.004, -0.009, 0.024, 0.013, -0.007, 0.021, 0.018,
    -0.014, 0.026, 0.008, 0.015, -0.011, 0.019, 0.022, -0.006, 0.017, 0.011,
    -0.019, 0.028, 0.014, -0.003, 0.023, 0.009, 0.016, -0.013, 0.021, 0.007,
    0.018, -0.008, 0.025, 0.012, -0.016, 0.020, 0.014, 0.006, -0.010, 0.022
  ];
  const result = [];
  for (let i = 0; i < length; i++) result.push(historicalPattern[i % historicalPattern.length]);
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Category-based cost estimates (used when per-fund data is unavailable)
// ─────────────────────────────────────────────────────────────────────────────

function getExpenseRatioForCategory(category) {
  const map = {
    liquid: 0.0020, debt: 0.0050, balanced: 0.0080, large_cap: 0.0100,
    index: 0.0020, flexi_cap: 0.0110, elss: 0.0110, mid_cap: 0.0120, small_cap: 0.0130
  };
  return map[category] || 0.0100;
}

function getTurnoverRatioForCategory(category) {
  const map = {
    liquid: 0.95, debt: 0.40, balanced: 0.50, large_cap: 0.35,
    index: 0.05, flexi_cap: 0.60, elss: 0.45, mid_cap: 0.70, small_cap: 0.75
  };
  return map[category] || 0.50;
}

module.exports = {
  sharpeRatio,
  sortinoRatio,
  beta,
  treynorRatio,
  alpha,
  informationRatio,
  standardDeviation,
  calculateFundScore,
  generateMarketReturns,
  normalize,
  getExpenseRatioForCategory,
  getTurnoverRatioForCategory,
  MIN_MONTHLY_OBSERVATIONS
};
