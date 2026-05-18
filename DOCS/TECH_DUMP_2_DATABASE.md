# Technical Dump — Part 2: Database

## 3. DATABASE

**Database name:** `smart_investment`
**Engine:** MongoDB 7.0 (local, via Homebrew)
**Connection:** `mongodb://localhost:27017/smart_investment`

---

### Collection: `users`

**Model file:** `server/src/models/User.js`

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | Auto |
| `name` | String | Optional |
| `email` | String | Required, unique |
| `passwordHash` | String | Required, bcrypt hash |
| `age` | Number | Optional |
| `income` | Number | Optional |
| `riskProfile` | String | enum: low/medium/high, default: medium |
| `createdAt` | Date | Default: now |

**Indexes:** `email` (unique)

**Sample document:**
```json
{
  "_id": "ObjectId(...)",
  "name": "Test User",
  "email": "test@example.com",
  "passwordHash": "$2a$10$...",
  "age": 28,
  "income": 800000,
  "riskProfile": "medium",
  "createdAt": "2025-11-28T10:00:00Z"
}
```

---

### Collection: `financialdatas`

**Model file:** `server/src/models/FinancialData.js`
**Purpose:** Curated 57 mutual funds with 5-year monthly price history (synthetic + real NAV updates)

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | Auto |
| `type` | String | enum: stock/mutual_fund/fd |
| `symbol` | String | e.g. `AXIS_BLUECHIP`, `MF_119551` |
| `name` | String | Human-readable fund name |
| `meta` | Object | `{category, riskCategory, schemeCode, fundHouse}` |
| `priceHistory` | Array | `[{date: Date, close: Number}]` — monthly, 60 points |
| `lastUpdated` | Date | Last sync time |

**Indexes:** `{type, symbol}` (unique compound)

**Sample document:**
```json
{
  "_id": "ObjectId(...)",
  "type": "mutual_fund",
  "symbol": "AXIS_BLUECHIP",
  "name": "Axis Bluechip Fund",
  "meta": {
    "category": "large_cap",
    "riskCategory": "high",
    "schemeCode": "119551"
  },
  "priceHistory": [
    {"date": "2020-11-26T00:00:00Z", "close": 100.0},
    {"date": "2020-12-26T00:00:00Z", "close": 103.5},
    ...60 entries total
  ],
  "lastUpdated": "2026-01-01T18:30:00Z"
}
```

**Note:** Price history is a mix of synthetic data (generated in mock-seed) and real NAV values appended by the hybrid sync job.

---

### Collection: `navs`

**Model file:** `server/src/models/NAV.js`
**Purpose:** Daily NAV snapshots for all 14,000+ AMFI-registered funds. Updated by AMFI sync job.

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | Auto |
| `schemeCode` | String | AMFI scheme code (e.g. "119551") |
| `schemeName` | String | Full AMFI scheme name |
| `category` | String | AMFI category string (e.g. "Equity Scheme - Large Cap Fund") |
| `nav` | Number | Net Asset Value |
| `repurchasePrice` | Number | null (not provided by AMFI) |
| `salePrice` | Number | null (not provided by AMFI) |
| `date` | Date | NAV date |
| `createdAt` | Date | Auto |
| `updatedAt` | Date | Auto |

**Indexes:**
- `schemeCode` (single)
- `schemeName` (single)
- `category` (single)
- `date` (single)
- `{schemeCode, date: -1}` (compound)
- `{category, date: -1}` (compound)

**Static methods:**
- `NAV.getLatestNAV(schemeCode)` — latest record for a scheme
- `NAV.getNAVHistory(schemeCode, startDate, endDate)` — date-range query
- `NAV.getAllSchemes()` — aggregation returning one record per scheme (latest)

**Total records:** ~42,270
**Unique schemes:** ~14,124
**Date range:** Nov 2025 – Jan 2026 (only 3-4 snapshots per fund since sync started)

**Sample document:**
```json
{
  "_id": "ObjectId(...)",
  "schemeCode": "119551",
  "schemeName": "Aditya Birla Sun Life Banking & PSU Debt Fund - DIRECT - IDCW",
  "category": "Debt Scheme - Banking and PSU Fund",
  "nav": 110.3333,
  "repurchasePrice": null,
  "salePrice": null,
  "date": "2026-01-01T18:30:00Z",
  "createdAt": "2026-01-03T15:39:42Z",
  "updatedAt": "2026-01-03T15:39:42Z"
}
```

---

### Collection: `fundhistories`

**Model file:** `server/src/models/FundHistory.js`
**Purpose:** 429 quality funds with 5-year monthly history fetched from mfapi.in + pre-computed financial metrics. Used as primary data source for bucket generation.

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | Auto |
| `schemeCode` | String | AMFI scheme code, unique |
| `schemeName` | String | Fund name |
| `category` | String | AMFI category string |
| `internalCategory` | String | Internal: large_cap/mid_cap/small_cap/flexi_cap/elss/balanced/debt/liquid/index |
| `riskCategory` | String | low/medium/high |
| `priceHistory` | Array | `[{date, close}]` — monthly, up to 60 points |
| `metrics.cagr1Y` | Number | 1-year CAGR |
| `metrics.cagr3Y` | Number | 3-year CAGR |
| `metrics.cagr5Y` | Number | 5-year CAGR |
| `metrics.sharpeRatio` | Number | Annualized Sharpe |
| `metrics.sortinoRatio` | Number | Annualized Sortino |
| `metrics.beta` | Number | vs synthetic market |
| `metrics.alpha` | Number | Jensen's Alpha |
| `metrics.treynorRatio` | Number | Treynor ratio |
| `metrics.informationRatio` | Number | vs synthetic benchmark |
| `metrics.standardDeviation` | Number | Annualized SD |
| `metrics.maxDrawdown` | Number | Max peak-to-trough drawdown |
| `metrics.finalScore` | Number | 0-100 composite score |
| `lastFetched` | Date | When mfapi.in was last called |
| `dataPoints` | Number | Number of monthly data points stored |
| `status` | String | enum: pending/fetched/failed |
| `createdAt` | Date | Auto |
| `updatedAt` | Date | Auto |

**Indexes:**
- `schemeCode` (unique)
- `category` (single)
- `internalCategory` (single)
- `{internalCategory, metrics.finalScore: -1}` (compound — for fast top-N queries)

**Current stats:** 429 fetched, 6 failed, 0 pending

**Sample document:**
```json
{
  "schemeCode": "119551",
  "schemeName": "Axis Bluechip Fund - Direct Growth",
  "category": "Equity Scheme - Large Cap Fund",
  "internalCategory": "large_cap",
  "riskCategory": "medium",
  "priceHistory": [
    {"date": "2020-01-01", "close": 32.5},
    {"date": "2020-02-01", "close": 33.1},
    ...60 entries
  ],
  "metrics": {
    "cagr1Y": 0.18,
    "cagr3Y": 0.14,
    "cagr5Y": 0.12,
    "sharpeRatio": 1.2,
    "sortinoRatio": 1.8,
    "beta": 0.95,
    "alpha": 0.02,
    "treynorRatio": 0.14,
    "informationRatio": 0.6,
    "standardDeviation": 0.16,
    "maxDrawdown": 0.22,
    "finalScore": 72.4
  },
  "dataPoints": 60,
  "status": "fetched",
  "lastFetched": "2026-04-02T20:00:00Z"
}
```

---

### Collection: `portfolios`

**Model file:** `server/src/models/Portfolio.js`

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | Auto |
| `userId` | ObjectId | Ref: User |
| `items` | Array | `[{symbol, type, amountAllocated, expectedReturn}]` |
| `totalAmount` | Number | Sum of all allocations |
| `createdAt` | Date | Auto |
| `updatedAt` | Date | Auto |

---

### Collection: `preferences`

**Model file:** `server/src/models/Preference.js`

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | Auto |
| `userId` | ObjectId | Ref: User |
| `amount` | Number | Investment amount |
| `duration` | Number | Years |
| `riskLevel` | String | low/medium/high |
| `goalType` | String | Optional |
| `createdAt` | Date | Auto |

---

### Collection: `caches`

**Model file:** `server/src/models/Cache.js`
**Purpose:** MongoDB-backed cache for benchmark returns (24hr TTL)

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | Auto |
| `key` | String | Unique cache key (e.g. `benchmark_NIFTY 50 TRI`) |
| `value` | Object | Cached data |
| `ttl` | Date | Optional expiry |

**Note:** Also has a `timestamp` field used in benchmarkService (not in schema — added via `$set`)
