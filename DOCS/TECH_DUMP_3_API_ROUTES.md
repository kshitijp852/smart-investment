# Technical Dump — Part 3: All API Routes

## 4. ALL API ROUTES

Base URL: `http://localhost:5001/api`

---

### AUTH — `/api/auth`

**POST `/api/auth/register`**
- Body: `{name, email, password, age, income, riskProfile}`
- Returns: `{token, user: {id, email, name}}`
- Middleware: none

**POST `/api/auth/login`**
- Body: `{email, password}`
- Returns: `{token, user: {id, email, name}}`
- Middleware: none

---

### HEALTH — `/api/health`

**GET `/api/health`**
- Returns: `{uptime, timestamp, status: "OK", database: "connected"|"disconnected"}`
- Middleware: none

---

### DATA — `/api/data`

**GET `/api/data/mock-seed`**
- Seeds 57 curated mutual funds with 5-year synthetic price history into `financialdatas`
- Returns: `{ok: true, instrumentsSeeded: 57, message}`
- Note: Generates realistic price paths using baseReturn + volatility + seasonal trend

**GET `/api/data/list`**
- Returns first 50 documents from `financialdatas`

**GET `/api/data/cache/stats`**
- Returns in-memory cache stats: `{size, ttl, ttlHours}`

**POST `/api/data/cache/clear`**
- Clears in-memory mfapi cache

**POST `/api/data/mfapi/quick-sync`**
- Body: `{forceRefresh: bool}`
- Syncs ~16 essential funds from mfapi.in

**POST `/api/data/mfapi/sync`**
- Body: `{forceRefresh: bool, batchSize: number}`
- Syncs all 75 popular funds from mfapi.in

**GET `/api/data/mfapi/nav/:schemeCode`**
- Params: `schemeCode`
- Query: `useCache=true|false`
- Returns raw mfapi.in response for that scheme

**GET `/api/data/mfapi/search`**
- Query: `q` (min 3 chars)
- Returns up to 20 matching fund names from mfapi.in

---

### BUCKETS — `/api/buckets` (MAIN RECOMMENDATION ENGINE)

**POST `/api/buckets/generate`**
- Body: `{amount: number, duration: number, riskLevel: "low"|"medium"|"high"}`
- Returns: Full portfolio recommendation with 3 bucket options
- Logic: See Section 6 (Portfolio Generation)
- Data source: FundHistory (429 funds) if available, else FinancialData (57 curated)
- Response shape:
```json
{
  "generatedAt": "ISO date",
  "input": {amount, duration, riskLevel},
  "bucketOptions": [
    {
      "strategy": {name, description, icon, tag, riskLevel},
      "summary": {totalInvestment, totalProjectedValue, totalGain, annualizedReturn, riskScore, duration},
      "bucket": [{symbol, name, category, allocation, percentage, expectedReturn, projectedValue, projectedGain, finalScore, metrics, scoreBreakdown}],
      "categorySummary": {},
      "diversification": {fundCount, categoryCount},
      "benchmarkComparison": {...},
      "chartData": [...],
      "isRecommended": bool,
      "label": string
    }
  ],
  "totalOptions": 3
}
```

---

### PREFERENCES — `/api/preferences`

**POST `/api/preferences`**
- Body: `{userId, amount, duration, riskLevel, goalType}`
- Returns: saved preference document

**GET `/api/preferences/:userId`**
- Returns: array of preferences for user

---

### RECOMMENDATIONS — `/api/recommendations` (LEGACY)

**POST `/api/recommendations/generate`**
- Body: `{amount, duration, riskLevel}`
- Returns top 10 funds scored by simple CAGR + Sharpe-like
- Note: Legacy endpoint, not used by frontend

---

### PORTFOLIO — `/api/portfolio`

**POST `/api/portfolio/save`** 🔒 (requires JWT)
- Body: `{items: [{symbol, type, amount}]}`
- Enriches with expectedReturn from FinancialData, saves to Portfolio collection
- Returns: `{saved: true, portfolio}`

**GET `/api/portfolio/list`** 🔒 (requires JWT)
- Returns all portfolios for authenticated user

**POST `/api/portfolio/returns`**
- Body: `{holdings: [{schemeCode, allocation, percentage}], projectionYears}`
- Returns CAGR-based projections using NAV data

**POST `/api/portfolio/historical-returns`**
- Body: `{basket: [{symbol, name, percentage, category}]}`
- Returns 1Y/3Y/5Y historical returns from NAV collection

**GET `/api/portfolio/returns/:schemeCode`**
- Returns period returns (1M/3M/6M/1Y/3Y/5Y) for a scheme

---

### ALPHA VANTAGE — `/api/alpha`

**GET `/api/alpha/fetch`**
- Query: `symbol`, `force`
- Fetches monthly stock data from Alpha Vantage API
- Caches in FinancialData collection (7-day TTL)
- Note: Requires `ALPHA_VANTAGE_KEY` env var — not used in production

---

### MFAPI — `/api/mfapi`

**GET `/api/mfapi/sync`**
- Triggers full popular funds sync from mfapi.in

**GET `/api/mfapi/fund/:code`**
- Returns raw mfapi.in data for a scheme code

**GET `/api/mfapi/search`**
- Query: `q`
- Searches fund names from mfapi.in

---

### NAV — `/api/nav`

**GET `/api/nav/latest/:schemeCode`**
- Returns latest NAV record for a scheme

**GET `/api/nav/history/:schemeCode`**
- Query: `startDate`, `endDate`, `limit` (default 100)
- Returns NAV history for a scheme

**GET `/api/nav/search`**
- Query: `q` (min 2 chars), `category`, `limit` (default 50)
- Searches by scheme name or code, returns latest NAV per match

**GET `/api/nav/schemes`**
- Query: `category`, `limit` (default 100), `offset`
- Returns all schemes with latest NAV (paginated)

**GET `/api/nav/categories`**
- Returns all 46 AMFI categories with record counts

**GET `/api/nav/stats`**
- Returns: `{totalRecords, uniqueSchemes, categories, latestDate}`

**POST `/api/nav/sync`**
- Manually triggers AMFI NAV sync (downloads NAVAll.txt, parses, upserts)

**GET `/api/nav/sync/status`**
- Returns sync job status: `{isRunning, lastRun, lastResult, isScheduled}`

---

### HYBRID — `/api/hybrid`

**GET `/api/hybrid/funds`**
- Returns all 57 curated funds enriched with latest NAV from navs collection

**GET `/api/hybrid/fund/:id`**
- Returns single curated fund by MongoDB `_id` with latest NAV

**GET `/api/hybrid/scheme/:schemeCode`**
- Returns fund by AMFI scheme code (checks curated first, then NAV collection)

**GET `/api/hybrid/search`**
- Query: `q` (min 2 chars), `category`, `limit`, `includeNonCurated`
- Searches curated + NAV database

**POST `/api/hybrid/sync`**
- Syncs curated funds with latest NAV data (appends new NAV to priceHistory)

**GET `/api/hybrid/stats`**
- Returns: `{curatedFunds, curatedWithRealTimeNAV, totalFundsAvailable, coveragePercentage}`

---

### BENCHMARK — `/api/benchmark`

**POST `/api/benchmark/compare`**
- Body: `{basket: [{category, percentage, expectedReturn}], duration, initialInvestment}`
- Returns: basket vs blended benchmark comparison + chart data

**GET `/api/benchmark/indices`**
- Returns all category → benchmark index mappings

**POST `/api/benchmark/blended`**
- Body: `{holdings: [{schemeCode, units, investmentDate}]}`
- Returns blended benchmark comparison using real NAV data

---

### EXPLORE FUNDS — `/api/funds`

**GET `/api/funds/explore`**
- Query: `page` (default 1), `limit` (default 20, max 100), `category`, `search`, `sortBy` (score/return/name/nav), `sortOrder` (asc/desc)
- Queries NAV collection, returns latest NAV per scheme with computed metrics
- Excludes: Institutional, Matured, Closed schemes
- Returns: paginated fund list with expectedReturn, projectedValue5Y, riskScore, score

---

### FUND HISTORY — `/api/fund-history`

**GET `/api/fund-history/stats`**
- Returns: `{total, fetched, pending, failed, byCategory}`

**POST `/api/fund-history/seed`**
- Body: `{maxPerCategory: number}` (default 30)
- Selects quality funds from NAV collection and seeds FundHistory with `status: pending`

**POST `/api/fund-history/fetch`**
- Body: `{limit: number}` (default 50)
- Fires background job to fetch 5yr history from mfapi.in for pending funds
- Returns immediately, runs async

**POST `/api/fund-history/pipeline`**
- Body: `{maxPerCategory, fetchLimit}`
- Runs full pipeline: seed → fetch → compute scores (background)

**GET `/api/fund-history/top/:category`**
- Params: `category` (e.g. large_cap, mid_cap)
- Query: `limit` (default 10)
- Returns top funds by finalScore for that category
