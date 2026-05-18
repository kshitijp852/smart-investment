# Technical Dump — Part 4: Scoring Algorithm & Portfolio Generation

## 5. THE SCORING ALGORITHM — EXACT LOGIC

**File:** `server/src/utils/advancedAnalytics.js`

The scoring system computes 9 financial ratios per fund, normalizes them across all funds in the pool, then applies weighted combination to produce a 0-100 score.

---

### The 9 Ratios

**1. Sharpe Ratio**
```
annualReturn = (1 + avgMonthlyReturn)^12 - 1
annualStd = monthlyStd * sqrt(12)
Sharpe = (annualReturn - riskFreeRate) / annualStd
riskFreeRate = 0.06 (6%)
```
Measures: excess return per unit of total risk

**2. Sortino Ratio**
```
downsideReturns = returns.filter(r => r < 0)
downsideVariance = sum(r^2) / count(downsideReturns)
downsideStd = sqrt(downsideVariance)
annualDownsideStd = downsideStd * sqrt(12)
Sortino = (annualReturn - riskFreeRate) / annualDownsideStd
```
Measures: excess return per unit of downside risk only

**3. Beta**
```
covariance = sum((fundReturn_i - fundMean) * (marketReturn_i - marketMean)) / n
marketVariance = sum((marketReturn_i - marketMean)^2) / n
Beta = covariance / marketVariance
```
Measures: fund volatility relative to market
⚠️ IMPORTANT: `marketReturns` is SYNTHETIC (random ~12% annual with noise), not real Nifty 50 data

**4. Treynor Ratio**
```
Treynor = (annualReturn - riskFreeRate) / Beta
```
Measures: excess return per unit of systematic (market) risk

**5. Alpha (Jensen's Alpha)**
```
expectedReturn = riskFreeRate + Beta * (marketReturn - riskFreeRate)
Alpha = actualAnnualReturn - expectedReturn
```
Measures: excess return above CAPM-predicted return
⚠️ Uses synthetic market returns — not real alpha

**6. Information Ratio**
```
excessReturns = fundReturns[i] - benchmarkReturns[i]  (per period)
trackingError = std(excessReturns)
annualExcessReturn = (1 + mean(excessReturns))^12 - 1
annualTrackingError = trackingError * sqrt(12)
IR = annualExcessReturn / annualTrackingError
```
Measures: consistency of outperformance vs benchmark
⚠️ Benchmark is also synthetic

**7. Standard Deviation (Volatility)**
```
SD = monthlyStd * sqrt(12)  (annualized)
```
Measures: total return volatility

**8. Expense Ratio**
- For curated funds: `0.005 + Math.random() * 0.02` (RANDOM — not real data)
- For FundHistory funds: hardcoded `0.01`
⚠️ This is a known limitation — not real expense ratio data

**9. Turnover Ratio**
- For curated funds: `0.2 + Math.random() * 0.8` (RANDOM — not real data)
- For FundHistory funds: hardcoded `0.5`
⚠️ This is a known limitation — not real turnover data

---

### Normalization

Each metric is normalized to [0, 1] using min-max across all funds in the current pool:

```javascript
normalize(value, min, max) = max(0, min(1, (value - min) / (max - min)))
```

For metrics where LOWER is better (SD, Beta deviation from 1, Expense, Turnover):
```
normalizedValue = 1 - normalize(value, min, max)
```

For Beta specifically:
```
betaNorm = 1 - normalize(|beta - 1|, 0, max(|beta_i - 1|))
```
(Funds with beta closest to 1 score highest)

---

### Weighted Scoring

```
A) Risk-Adjusted Performance (45% total weight):
   sharpeNorm  × 0.20
   sortinoNorm × 0.15
   treynorNorm × 0.10

B) Stability & Volatility (25% total weight):
   sdNorm      × 0.15
   betaNorm    × 0.10

C) Manager Skill & Consistency (20% total weight):
   alphaNorm   × 0.12
   infoRatioNorm × 0.08

D) Cost Efficiency (10% total weight):
   expenseNorm × 0.06
   turnoverNorm × 0.04

finalScore = (A × 0.45) + (B × 0.25) + (C × 0.20) + (D × 0.10)
finalScore_0_to_100 = finalScore × 100
```

**Note:** The outer weights (0.45, 0.25, 0.20, 0.10) are redundant — the inner weights already sum to 1.0. The outer multiplication doesn't change relative rankings but scales the sub-scores.

---

### Fund Selection Within Category (Tiebreaker Order)

```javascript
.sort((a, b) => {
  if (|b.finalScore - a.finalScore| > 0.1) return b.finalScore - a.finalScore;
  if (|b.sortinoRatio - a.sortinoRatio| > 0.1) return b.sortinoRatio - a.sortinoRatio;
  if (|a.SD - b.SD| > 0.01) return a.SD - b.SD;  // lower SD preferred
  return a.expenseRatio - b.expenseRatio;  // lower expense preferred
})
.slice(0, 2)  // top 2 per category
```

---

## 6. PORTFOLIO GENERATION — EXACT LOGIC

**File:** `server/src/routes/buckets-multi.js`

### Step 1: Data Source Selection

```javascript
if (FundHistory.count({ status: 'fetched' }) >= 20) {
  // Use FundHistory (429 funds with pre-computed metrics)
  dataSource = 'fund_history'
} else {
  // Fall back to FinancialData (57 curated funds)
  dataSource = 'curated'
}
```

### Step 2: Compute Metrics

**For FundHistory funds:** Use pre-computed metrics directly (no recalculation)

**For curated funds:** Compute all 9 ratios fresh from priceHistory on every request

### Step 3: Score All Funds

`calculateFundScore(fund.metrics, allMetrics)` — normalizes across the entire pool

### Step 4: Apply Allocation Strategy

Three hardcoded strategies:

**Conservative (low risk):**
```
debt:      40%
liquid:    25%
balanced:  20%
large_cap: 10%
index:      5%
```

**Balanced (medium risk):**
```
large_cap:  25%
flexi_cap:  20%
balanced:   20%
mid_cap:    15%
debt:       10%
index:       5%
elss:        5%
```

**Aggressive (high risk):**
```
mid_cap:    25%
small_cap:  20%
large_cap:  20%
flexi_cap:  15%
elss:       10%
balanced:    5%
index:       5%
```

### Step 5: Select Top 2 Funds Per Category

For each category in the strategy:
1. Filter funds by `meta.category === category`
2. Sort by score (with tiebreakers above)
3. Take top 2
4. Split category allocation equally between the 2 funds

### Step 6: Calculate Projections

```
allocation = amount × (categoryPercentage / numFundsInCategory)
projectedValue = allocation × (1 + expectedReturn)^duration
projectedGain = projectedValue - allocation
```

`expectedReturn` = `applyExpectedReturnBounds(cagr, category)` — clamps to JSON config bounds

### Step 7: Generate 3 Bucket Options

Always returns 3 options:
1. **Recommended** — user's chosen risk level, `isRecommended: true`
2. **Conservative Alternative** — if user didn't choose low
3. **Aggressive Alternative** — if user didn't choose high
4. **Balanced Alternative** — if user chose low or high

(Maximum 3 options returned)

### Step 8: Benchmark Comparison

For each bucket option:
1. `calculateBlendedBenchmark(bucket)` — weighted benchmark by category
2. `comparePortfolioWithBenchmarkHistorical(bucket, benchmarkData)` — tries real NAV data
3. If no historical data: falls back to `compareWithBenchmark()` (projected returns)
4. `generatePerformanceChartData()` — generates chart points for 1Y/3Y/5Y/SI

**Benchmark data is MOCK** — hardcoded returns in `benchmarkService.js`:
```javascript
'NIFTY 50 TRI': { '1Y': 0.24, '3Y': 0.16, '5Y': 0.17, 'SI': 0.13 }
'NIFTY Midcap 150 TRI': { '1Y': 0.42, '3Y': 0.28, '5Y': 0.25, 'SI': 0.18 }
// etc.
```

### Expected Return Bounds (from expected-returns.json)

| Category | Min | Max |
|---|---|---|
| liquid | 4% | 8% |
| debt | 6% | 11% |
| balanced | 10% | 22% |
| large_cap | 12% | 30% |
| flexi_cap | 14% | 35% |
| elss | 14% | 35% |
| index | 10% | 26% |
| mid_cap | 15% | 55% |
| small_cap | 18% | 60% |
