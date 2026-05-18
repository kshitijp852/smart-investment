# Issues & Fix Roadmap

## The 3 Most Damaging Issues (Core Product Unreliable)

### Issue 1 — Scores change randomly on every request
- `generateMarketReturns()` in `advancedAnalytics.js` uses `Math.random()`
- Beta, Alpha, Treynor, Information Ratio are all recalculated against synthetic random market data every time
- Result: clicking "Generate" twice gives different scores for the same fund

### Issue 2 — 10% of the score is Math.random()
- In `buckets-multi.js` (curated path): `expenseRatio = 0.005 + Math.random() * 0.02`
- In `buckets-multi.js` (curated path): `turnoverRatio = 0.2 + Math.random() * 0.8`
- These feed directly into the 10% Cost Efficiency component of the final score

### Issue 3 — Benchmark comparison shows fake data
- `benchmarkService.js` has hardcoded returns: `'NIFTY 50 TRI': { '1Y': 0.24, '3Y': 0.16, '5Y': 0.17 }`
- These never change regardless of actual market performance
- The "beats benchmark" indicator is meaningless

---

## Recommended Fix Order

### Week 1 — Fix the math (high impact, contained changes)
1. Replace `generateMarketReturns()` with real Nifty 50 monthly NAV data
   - Use mfapi.in scheme code `118834` (Nifty 50 index fund as proxy)
   - Fetch once, cache, reuse for all beta/alpha calculations
2. Pull real expense ratios from AMFI NAVAll.txt
   - Already being downloaded in `amfiService.js` — just need to parse the TER field
3. Fix benchmark service to use real index fund NAVs from the `navs` collection
   - Nifty 50 index funds are already in the database

### Week 2 — Activate what's already built
1. Uncomment `navSyncJob.start(24)` in `app.js`
2. Add a monthly cron/setInterval to refresh FundHistory metrics
3. Wire `client/src/services/api.js` properly in `App.jsx` (currently unused)

### Week 3 — Add visible features
1. Historical performance chart
   - Data is already in `priceHistory` arrays
   - Need to install Recharts (no charting library currently)
2. Saved portfolios view page
   - Save endpoint works, view UI is missing
3. Read preferences back to personalize recommendations
   - Preferences are saved but never read

### Week 4 — ML service
1. Replace random training data with real fund metrics from `fundhistories` collection
2. Connect Node.js to call `/predict` for an "ML confidence score" overlay on fund cards
