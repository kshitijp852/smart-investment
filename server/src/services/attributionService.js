/**
 * Portfolio Attribution Analysis Service
 *
 * Implements three academically grounded performance evaluation methods that go
 * beyond simple return-vs-index comparison:
 *
 *  1. Jensen's Alpha
 *     Measures excess return after accounting for the portfolio's systematic risk (beta).
 *     A positive alpha means the fund selection added value above what beta alone predicts.
 *     Reference: Jensen (1968), "The Performance of Mutual Funds 1945–1964"
 *
 *  2. Information Ratio (IR)
 *     IR = Active Return / Tracking Error
 *     Measures consistency of outperformance, not just magnitude.
 *     IR > 0.5 is considered strong; IR > 1.0 is exceptional.
 *     Computed from rolling windows when NAV data is available (more accurate),
 *     falling back to discrete period approximation otherwise.
 *
 *  3. Brinson-Hood-Beebower (BHB) Attribution
 *     Decomposes active return into three effects per asset category:
 *       - Allocation Effect  : did overweighting/underweighting categories pay off?
 *       - Selection Effect   : were the chosen funds better than their category benchmark?
 *       - Interaction Effect : combined impact of both decisions simultaneously
 *     Reference: Brinson, Hood & Beebower (1986), Journal of Portfolio Management
 *
 *  4. Rolling Return Consistency
 *     Slides a 1Y or 3Y window across full NAV history to compute what % of all
 *     historical periods the portfolio beat the benchmark — a measure of robustness
 *     that point-to-point CAGR cannot capture.
 */

const NAV = require('../models/NAV');
const {
  fetchBenchmarkReturns,
  calculateBlendedBenchmark,
  calculateBasketReturns,
  getBenchmarkForCategory
} = require('./benchmarkService');

// India 10-year G-Sec yield used as risk-free rate proxy
const RISK_FREE_RATE = 0.065;

// Nifty 50 proxy used as the single benchmark series for rolling analysis
const ROLLING_BENCHMARK_SCHEME = '120716';

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Binary search: return the record at or immediately before targetDate.
 * Assumes records are sorted ascending by date.
 * O(log n) per call — important for rolling window loops.
 *
 * @param {Array}  records    - Sorted NAV records [{ date, nav }]
 * @param {Date}   targetDate
 * @returns {Object|null}
 */
function findClosestRecord(records, targetDate) {
  const target = new Date(targetDate).getTime();
  let lo = 0, hi = records.length - 1, result = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = new Date(records[mid].date).getTime();
    if (t <= target) { result = records[mid]; lo = mid + 1; }
    else              { hi = mid - 1; }
  }
  return result;
}

/**
 * Compute annualised CAGR between two NAV records.
 *
 * @param {number} navStart
 * @param {number} navEnd
 * @param {number} years
 * @returns {number}
 */
function cagr(navStart, navEnd, years) {
  if (navStart === 0) return 0;
  return years >= 1
    ? Math.pow(navEnd / navStart, 1 / years) - 1
    : (navEnd - navStart) / navStart;
}

/**
 * Sample standard deviation of an array.
 *
 * @param {number[]} values
 * @returns {number}
 */
function sampleStd(values) {
  if (values.length < 2) return 0;
  const m = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + Math.pow(v - m, 2), 0) / (values.length - 1);
  return Math.sqrt(variance);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Portfolio Beta
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute allocation-weighted portfolio beta from individual fund betas.
 * Uses fund.metrics.beta (computed against Nifty 50 proxy in advancedAnalytics).
 *
 * @param {Array} basket - Array of fund objects with .metrics.beta and .allocation
 * @returns {number}
 */
function computePortfolioBeta(basket) {
  const total = basket.reduce((s, f) => s + (f.allocation || 0), 0);
  if (total === 0) return 1;
  return basket.reduce((sum, fund) => {
    const w = (fund.allocation || 0) / total;
    return sum + (fund.metrics?.beta ?? 1) * w;
  }, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Jensen's Alpha
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Jensen's Alpha: excess return above the risk-adjusted expected return.
 *
 *   α = Rp − [Rf + βp × (Rm − Rf)]
 *
 * Where:
 *   Rp = portfolio annualised return
 *   Rf = risk-free rate (RISK_FREE_RATE)
 *   βp = portfolio beta
 *   Rm = blended benchmark return
 *
 * Interpretation:
 *   α > 0  : fund selection added value beyond systematic risk
 *   α = 0  : portfolio matched what its beta predicted
 *   α < 0  : underperformed risk-adjusted expectation
 *
 * @param {number} portfolioReturn  - annualised decimal (e.g. 0.18 = 18%)
 * @param {number} benchmarkReturn  - annualised decimal
 * @param {number} portfolioBeta
 * @param {number} [rf]             - risk-free rate override
 * @returns {number}
 */
function computeJensensAlpha(portfolioReturn, benchmarkReturn, portfolioBeta, rf = RISK_FREE_RATE) {
  const expected = rf + portfolioBeta * (benchmarkReturn - rf);
  return portfolioReturn - expected;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Information Ratio (period approximation)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Approximate Information Ratio using discrete period active returns.
 * Used as fallback when rolling NAV data is unavailable.
 *
 *   IR ≈ mean(active returns) / std(active returns)
 *   where active = [Rp_1Y − Rb_1Y, Rp_3Y − Rb_3Y, Rp_5Y − Rb_5Y]
 *
 * Limitation: only 2–3 data points, so treat as directional signal only.
 *
 * @param {Object} basketReturns    - { '1Y': n, '3Y': n, '5Y': n }
 * @param {Object} benchmarkReturns - { '1Y': n, '3Y': n, '5Y': n }
 * @returns {number|null}
 */
function computeInformationRatioFromPeriods(basketReturns, benchmarkReturns) {
  const active = ['1Y', '3Y', '5Y']
    .filter(p => basketReturns[p] != null && benchmarkReturns[p] != null)
    .map(p => basketReturns[p] - benchmarkReturns[p]);

  if (active.length === 0) return null;
  const mean = active.reduce((s, r) => s + r, 0) / active.length;
  if (active.length === 1) return mean > 0 ? 0.5 : -0.5;
  const te = sampleStd(active);
  return te === 0 ? null : parseFloat((mean / te).toFixed(3));
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Rolling Return Consistency
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Slide a rolling window of `windowYears` across full NAV history.
 * For each 30-day step, compute portfolio CAGR vs benchmark CAGR.
 *
 * Outputs:
 *   consistencyScore  : % of periods portfolio beat benchmark (0–100)
 *   averageAlpha      : mean(portfolio − benchmark) across all windows
 *   trackingError     : std(portfolio − benchmark) — used for rolling IR
 *   informationRatio  : averageAlpha / trackingError (proper rolling IR)
 *   periods           : last 12 windows for UI/charting
 *
 * Benchmark proxy: UTI Nifty 50 Index Fund (120716) — single series for consistency.
 * Funds without NAV in the collection are skipped; windows where < 50% of
 * portfolio weight has data are also skipped to avoid distortion.
 *
 * @param {Array}  basket      - Fund objects with .allocation and .meta.schemeCode
 * @param {number} windowYears - 1 or 3
 * @returns {Object|null}
 */
async function computeRollingConsistency(basket, windowYears) {
  const windowDays = windowYears * 365;
  const stepDays   = 30;

  // Fetch benchmark NAV series upfront
  const benchmarkRecords = await NAV.find({ schemeCode: ROLLING_BENCHMARK_SCHEME })
    .sort({ date: 1 })
    .lean();

  if (benchmarkRecords.length < windowDays / 30) return null;

  // Fetch each fund's NAV series upfront (avoids repeated DB calls in loop)
  const allocationTotal = basket.reduce((s, f) => s + (f.allocation || 0), 0);
  const fundNAVMap = {};
  const fundWeights = {};

  await Promise.all(basket.map(async (fund) => {
    const sc = fund.meta?.schemeCode || fund.symbol;
    if (!sc || !/^\d+$/.test(String(sc))) return;

    const records = await NAV.find({ schemeCode: String(sc) })
      .sort({ date: 1 })
      .lean();

    if (records.length >= 2) {
      fundNAVMap[String(sc)] = records;
      fundWeights[String(sc)] = allocationTotal > 0
        ? (fund.allocation || 0) / allocationTotal
        : (fund.percentage || 0) / 100;
    }
  }));

  if (Object.keys(fundNAVMap).length === 0) return null;

  // Slide window backward from latest benchmark date
  const latestDate    = new Date(benchmarkRecords[benchmarkRecords.length - 1].date);
  const earliestDate  = new Date(benchmarkRecords[0].date);
  const windows       = [];
  let   currentEnd    = new Date(latestDate);

  while (true) {
    const currentStart = new Date(currentEnd);
    currentStart.setDate(currentStart.getDate() - windowDays);
    if (currentStart < earliestDate) break;

    // Benchmark return for this window
    const bEnd   = findClosestRecord(benchmarkRecords, currentEnd);
    const bStart = findClosestRecord(benchmarkRecords, currentStart);
    if (!bEnd || !bStart || bStart.nav === 0) {
      currentEnd.setDate(currentEnd.getDate() - stepDays);
      continue;
    }
    const benchReturn = cagr(bStart.nav, bEnd.nav, windowYears);

    // Portfolio weighted return for this window
    let weightedReturn = 0;
    let coveredWeight  = 0;

    for (const [sc, records] of Object.entries(fundNAVMap)) {
      const fEnd   = findClosestRecord(records, currentEnd);
      const fStart = findClosestRecord(records, currentStart);
      if (!fEnd || !fStart || fStart.nav === 0) continue;

      const w = fundWeights[sc] || 0;
      weightedReturn += cagr(fStart.nav, fEnd.nav, windowYears) * w;
      coveredWeight  += w;
    }

    // Skip window if less than 50% of portfolio weight has data
    if (coveredWeight < 0.5) {
      currentEnd.setDate(currentEnd.getDate() - stepDays);
      continue;
    }

    // Normalise for missing funds
    const portfolioReturn = weightedReturn / coveredWeight;

    windows.push({
      startDate:       currentStart.toISOString().split('T')[0],
      endDate:         currentEnd.toISOString().split('T')[0],
      portfolioReturn: parseFloat(portfolioReturn.toFixed(4)),
      benchmarkReturn: parseFloat(benchReturn.toFixed(4)),
      activeReturn:    parseFloat((portfolioReturn - benchReturn).toFixed(4)),
      beatBenchmark:   portfolioReturn > benchReturn
    });

    currentEnd.setDate(currentEnd.getDate() - stepDays);
  }

  if (windows.length === 0) return null;

  const wins         = windows.filter(w => w.beatBenchmark).length;
  const activeRets   = windows.map(w => w.activeReturn);
  const avgAlpha     = activeRets.reduce((s, r) => s + r, 0) / activeRets.length;
  const trackingErr  = sampleStd(activeRets);
  const rollingIR    = trackingErr > 0 ? avgAlpha / trackingErr : null;

  return {
    windowYears,
    totalPeriods:      windows.length,
    winCount:          wins,
    consistencyScore:  parseFloat((wins / windows.length * 100).toFixed(1)),
    averageAlpha:      parseFloat(avgAlpha.toFixed(4)),
    trackingError:     parseFloat(trackingErr.toFixed(4)),
    informationRatio:  rollingIR !== null ? parseFloat(rollingIR.toFixed(3)) : null,
    recentPeriods:     windows.slice(0, 12)   // newest 12 windows for UI
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. BHB Attribution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Brinson-Hood-Beebower attribution decomposition.
 *
 * For each asset category i:
 *
 *   Allocation Effect   = (Wp_i − Wb_i) × (Rb_i − Rb)
 *   Selection Effect    = Wb_i           × (Rp_i − Rb_i)
 *   Interaction Effect  = (Wp_i − Wb_i) × (Rp_i − Rb_i)
 *   Total Active Return = Σ (Allocation + Selection + Interaction)
 *
 * Interpretation:
 *   Allocation > 0  : overweighting outperforming categories was the right call
 *   Selection > 0   : chosen funds beat their category benchmark index
 *   Interaction     : joint effect of both decisions
 *
 * @param {Array}  basket        - Fund objects
 * @param {Object} policyWeights - Strategy's target allocation { large_cap: 0.25, ... }
 * @param {string} period        - '1Y' | '3Y' | '5Y'
 * @returns {Object}
 */
async function computeBHBAttribution(basket, policyWeights, period = '3Y') {
  const allocationTotal = basket.reduce((s, f) => s + (f.allocation || 0), 0);

  // Step 1: actual portfolio weights and returns per category (Wp_i, Rp_i)
  const catData = {};
  basket.forEach(fund => {
    const cat = fund.category || 'flexi_cap';
    const w   = allocationTotal > 0
      ? (fund.allocation || 0) / allocationTotal
      : (fund.percentage || 0) / 100;

    if (!catData[cat]) catData[cat] = { weight: 0, weightedReturn: 0 };
    catData[cat].weight         += w;
    catData[cat].weightedReturn += (fund.expectedReturn || 0) * w;
  });

  // Normalise per-category return by category weight to get pure Rp_i
  Object.keys(catData).forEach(cat => {
    catData[cat].Rp = catData[cat].weight > 0
      ? catData[cat].weightedReturn / catData[cat].weight
      : 0;
  });

  // Step 2: policy benchmark weights (Wb_i) — normalise to sum to 1
  const policyTotal = policyWeights
    ? Object.values(policyWeights).reduce((s, w) => s + w, 0)
    : 1;
  const Wb = {};
  const allCategories = new Set([
    ...Object.keys(catData),
    ...Object.keys(policyWeights || {})
  ]);
  allCategories.forEach(cat => {
    Wb[cat] = policyWeights?.[cat]
      ? policyWeights[cat] / policyTotal
      : 0;
  });

  // Step 3: benchmark returns per category (Rb_i) from NAV collection
  const Rb_i = {};
  await Promise.all([...allCategories].map(async cat => {
    const idx     = getBenchmarkForCategory(cat);
    const returns = await fetchBenchmarkReturns(idx);
    Rb_i[cat]     = returns[period] ?? returns['1Y'] ?? 0;
  }));

  // Step 4: total blended benchmark return Rb = Σ Wb_i × Rb_i
  const Rb = [...allCategories].reduce((sum, cat) => {
    return sum + (Wb[cat] || 0) * (Rb_i[cat] || 0);
  }, 0);

  // Step 5: BHB decomposition per category
  let totalAlloc = 0, totalSel = 0, totalInter = 0;
  const byCategory = [];

  allCategories.forEach(cat => {
    const Wp    = catData[cat]?.weight || 0;
    const wb    = Wb[cat] || 0;
    const Rp    = catData[cat]?.Rp    || 0;
    const Rb_c  = Rb_i[cat] || 0;

    const alloc  = (Wp - wb) * (Rb_c - Rb);
    const sel    = wb * (Rp - Rb_c);
    const inter  = (Wp - wb) * (Rp - Rb_c);

    totalAlloc += alloc;
    totalSel   += sel;
    totalInter += inter;

    byCategory.push({
      category:         cat,
      portfolioWeight:  parseFloat((Wp * 100).toFixed(2)),
      benchmarkWeight:  parseFloat((wb * 100).toFixed(2)),
      portfolioReturn:  parseFloat((Rp * 100).toFixed(2)),
      benchmarkReturn:  parseFloat((Rb_c * 100).toFixed(2)),
      allocationEffect: parseFloat((alloc * 100).toFixed(4)),
      selectionEffect:  parseFloat((sel   * 100).toFixed(4)),
      interactionEffect:parseFloat((inter * 100).toFixed(4)),
      totalEffect:      parseFloat(((alloc + sel + inter) * 100).toFixed(4))
    });
  });

  const totalActive = totalAlloc + totalSel + totalInter;

  return {
    period,
    totalActiveReturn:    parseFloat((totalActive * 100).toFixed(4)),
    allocationEffect:     parseFloat((totalAlloc  * 100).toFixed(4)),
    selectionEffect:      parseFloat((totalSel    * 100).toFixed(4)),
    interactionEffect:    parseFloat((totalInter  * 100).toFixed(4)),
    portfolioBeatsOnAllocation: totalAlloc > 0,
    portfolioBeatsOnSelection:  totalSel   > 0,
    dominantSource: Math.abs(totalAlloc) > Math.abs(totalSel)
      ? 'allocation'
      : 'selection',
    byCategory: byCategory.sort((a, b) => Math.abs(b.totalEffect) - Math.abs(a.totalEffect))
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Full Attribution Report
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute the complete attribution report for a basket.
 *
 * Combines Jensen's Alpha, Information Ratio, BHB decomposition, and rolling
 * consistency into a single object ready to attach to the portfolio response.
 *
 * Rolling analysis (heavy — queries NAV per fund) runs in parallel for 1Y and
 * 3Y windows and fails gracefully if NAV data is unavailable.
 *
 * @param {Array}  basket        - Generated fund bucket
 * @param {number} duration      - Investment horizon in years
 * @param {Object} policyWeights - Strategy allocation { cat: fraction }
 * @returns {Object}
 */
async function computeFullAttributionReport(basket, duration, policyWeights) {
  // Fetch basket and benchmark returns in parallel
  const [basketReturns, blendedBenchmark] = await Promise.all([
    calculateBasketReturns(basket, duration),
    calculateBlendedBenchmark(basket)
  ]);

  const benchmarkReturns = blendedBenchmark.benchmarkReturn;
  const portfolioBeta    = computePortfolioBeta(basket);

  // Select most meaningful period given the investment horizon
  const primaryPeriod   = duration >= 5 ? '5Y' : duration >= 3 ? '3Y' : '1Y';
  const Rp              = basketReturns[primaryPeriod]    || 0;
  const Rm              = benchmarkReturns[primaryPeriod] || 0;

  // Jensen's Alpha
  const alpha = computeJensensAlpha(Rp, Rm, portfolioBeta);

  // BHB attribution
  const bhb = await computeBHBAttribution(basket, policyWeights, primaryPeriod);

  // Rolling consistency (both windows in parallel; non-fatal on failure)
  const [rolling1Y, rolling3Y] = await Promise.all([
    computeRollingConsistency(basket, 1).catch(() => null),
    duration >= 3
      ? computeRollingConsistency(basket, 3).catch(() => null)
      : Promise.resolve(null)
  ]);

  // Information Ratio: prefer rolling (statistically sound), fallback to period approx
  const rollingIR  = rolling3Y?.informationRatio ?? rolling1Y?.informationRatio ?? null;
  const periodIR   = computeInformationRatioFromPeriods(basketReturns, benchmarkReturns);
  const ir         = rollingIR ?? periodIR;
  const irSource   = rollingIR != null ? 'rolling' : 'period_approx';

  // Human-readable interpretation for UI / paper
  const alphaSignal = alpha > 0.02 ? 'strong_positive'
                    : alpha > 0    ? 'weak_positive'
                    : alpha > -0.02 ? 'weak_negative'
                    : 'strong_negative';

  const irSignal = ir == null     ? 'insufficient_data'
                 : ir > 1.0       ? 'exceptional'
                 : ir > 0.5       ? 'good'
                 : ir > 0         ? 'marginal'
                 : 'negative';

  const verdict = alpha > 0 && ir != null && ir > 0.5
    ? 'fund_selection_adds_consistent_value'
    : alpha > 0
    ? 'outperforms_but_inconsistently'
    : 'underperforms_risk_adjusted_benchmark';

  return {
    summary: {
      primaryPeriod,
      portfolioReturn:  parseFloat((Rp    * 100).toFixed(2)),
      benchmarkReturn:  parseFloat((Rm    * 100).toFixed(2)),
      activeReturn:     parseFloat(((Rp - Rm) * 100).toFixed(2)),
      portfolioBeta:    parseFloat(portfolioBeta.toFixed(3)),
      jensensAlpha:     parseFloat((alpha * 100).toFixed(4)),
      informationRatio: ir != null ? parseFloat(ir.toFixed(3)) : null,
      irSource,
      verdict,
      interpretation: {
        alphaSignal,
        irSignal,
        dominantAttributionSource: bhb.dominantSource
      }
    },

    jensensAlpha: {
      value:         parseFloat((alpha * 100).toFixed(4)),
      riskFreeRate:  RISK_FREE_RATE * 100,
      portfolioBeta,
      portfolioReturn: parseFloat((Rp * 100).toFixed(2)),
      benchmarkReturn: parseFloat((Rm * 100).toFixed(2)),
      // Full formula string — useful for paper/documentation
      formula: [
        `α = Rp − [Rf + β×(Rm−Rf)]`,
        `  = ${(Rp*100).toFixed(2)}% − [${(RISK_FREE_RATE*100).toFixed(1)}% + `,
        `    ${portfolioBeta.toFixed(3)} × (${(Rm*100).toFixed(2)}% − ${(RISK_FREE_RATE*100).toFixed(1)}%)]`,
        `  = ${(alpha*100).toFixed(4)}%`
      ].join(''),
      signal: alphaSignal
    },

    informationRatio: {
      value:          ir,
      source:         irSource,
      trackingError:  rolling3Y?.trackingError ?? rolling1Y?.trackingError ?? null,
      interpretation: irSignal,
      thresholds:     { exceptional: 1.0, good: 0.5, marginal: 0 }
    },

    bhbAttribution: bhb,

    rollingConsistency: {
      oneYear:   rolling1Y,
      threeYear: rolling3Y
    }
  };
}

module.exports = {
  computePortfolioBeta,
  computeJensensAlpha,
  computeInformationRatioFromPeriods,
  computeRollingConsistency,
  computeBHBAttribution,
  computeFullAttributionReport
};
