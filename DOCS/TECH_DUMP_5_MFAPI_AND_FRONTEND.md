# Technical Dump — Part 5: MFApi Integration & Frontend Components

## 7. MFAPI INTEGRATION

### Two separate MFApi integrations exist:

---

### Integration A: `server/src/services/mfapi.js` (Legacy/Curated)

**Purpose:** Fetch NAV data for the 57 curated funds and sync to `financialdatas` collection

**Endpoints called:**
- `GET https://api.mfapi.in/mf` — fetch all scheme codes (40,000+)
- `GET https://api.mfapi.in/mf/:schemeCode` — fetch full history for one fund

**What data is fetched:**
- `meta.scheme_code`, `meta.scheme_name`, `meta.fund_house`, `meta.scheme_type`
- `data[]` — array of `{date: "DD-MMM-YYYY", nav: "123.45"}` (full history)

**How stored:**
- Converts to `FinancialData` format
- Takes last 60 data points (5 years monthly) from the history
- Upserts into `financialdatas` collection by `symbol`

**Caching layer:**
- In-memory `CacheManager` class (Map-based)
- TTL: 24 hours
- Key format: `nav_${schemeCode}`, `all_schemes`
- Cleanup runs every hour via `setInterval`
- `RateLimiter` class: max 30 requests per 60 seconds

**What triggers sync:**
- `POST /api/data/mfapi/sync` — full sync (75 popular funds)
- `POST /api/data/mfapi/quick-sync` — essential 16 funds
- `GET /api/mfapi/sync` — duplicate endpoint

**POPULAR_FUNDS constant:** 75 hardcoded funds with scheme codes, names, categories
⚠️ Many scheme codes in this list are DUPLICATED (same code used for different fund names) — this is a bug

---

### Integration B: `server/src/services/fundHistoryService.js` (New/Production)

**Purpose:** Fetch 5-year monthly history for 429 quality funds, compute metrics, store in `fundhistories`

**Endpoints called:**
- `GET https://api.mfapi.in/mf/:schemeCode` — full history per fund

**What data is fetched:**
- Full daily NAV history (goes back to 2013 for most funds)

**How stored:**
- Samples one data point per month (first trading day of each month)
- Keeps last 60 months (5 years)
- Stores in `fundhistories.priceHistory`
- Computes all 9 metrics immediately after fetch
- Stores metrics in `fundhistories.metrics`

**Rate limiting:** 300ms delay between requests (~3 req/sec)
**Batch size:** 5 concurrent requests

**What triggers sync:**
- `POST /api/fund-history/fetch` — fetches pending funds (background)
- `POST /api/fund-history/pipeline` — full pipeline (background)

**Fund selection logic:**
1. Queries `navs` collection for each of 18 AMFI categories
2. Groups by schemeCode, prefers Direct Growth plans (regex match)
3. Takes top 25-30 by NAV value per category
4. Seeds into `fundhistories` with `status: pending`

---

### AMFI Integration: `server/src/services/amfiService.js`

**Purpose:** Download daily NAV file for ALL 14,000+ funds

**Endpoint:** `GET https://portal.amfiindia.com/spages/NAVAll.txt`

**File format (semicolon-delimited):**
```
Scheme Code;ISIN Div Payout;ISIN Growth;Scheme Name;NAV;Date
```

**Parsing logic:**
- Splits by newline
- Detects category headers (lines starting with "Open Ended Schemes")
- Detects AMC names (non-numeric lines)
- Parses data lines (6+ semicolon-separated fields)
- Date format: `DD-MMM-YYYY` → parsed to JS Date

**Storage:** Upserts into `navs` collection by `{schemeCode, date}` (100 records per batch)

**Trigger:** `POST /api/nav/sync` or `navSyncJob.runSync()`

---

## 8. FRONTEND COMPONENTS

### `client/src/index.js`
- Mounts App into DOM
- No state, no API calls

---

### `client/src/App.jsx` (Main Component)

**State managed:**
| State | Type | Purpose |
|---|---|---|
| `amount` | Number | Investment amount (default 100000) |
| `duration` | Number | Years (default 3) |
| `risk` | String | low/medium/high (default medium) |
| `recs` | Object | Full API response from /buckets/generate |
| `selectedBucket` | Number | Index of active bucket tab (0-2) |
| `view` | String | main/login/register/explore |
| `loading` | Boolean | API call in progress |
| `dataStats` | Object | Fund counts for header display |
| `inputChanged` | Boolean | Shows "update recommendations" notice |

**API calls:**
| Call | Trigger | Endpoint |
|---|---|---|
| `fetchDataStats()` | On mount | GET /api/hybrid/stats + GET /api/data/list |
| `generate()` | Button click | POST /api/buckets/generate |
| `savePortfolio()` | Button click | POST /api/portfolio/save |
| Load sample data | Button click | GET /api/data/mock-seed |

**Renders (conditional on `view`):**
- `view === 'login'` → `<Login />`
- `view === 'register'` → `<Register />`
- `view === 'explore'` → `<ExploreFunds />`
- `view === 'main'` → Full dashboard

**Main dashboard sections:**
1. `<Disclaimer />` — legal modal
2. Header with nav buttons
3. Hero section (title + subtitle)
4. Input card (amount, duration, risk selector)
5. Data stats badges (fund counts)
6. Input changed notice (if inputs changed after generating)
7. Bucket tabs (3 strategy options)
8. Strategy header + summary card
9. `<BenchmarkComparison />` component
10. Fund cards grid (with `<details>` for metrics)
11. Score breakdown bars
12. Action buttons (Save Portfolio, Try Different)
13. Footer (Load Sample Data button)

---

### `client/src/components/Disclaimer.jsx`

**State:** `accepted` (boolean from localStorage)
**API calls:** None
**Renders:** Full-screen overlay modal until accepted
**Persistence:** `localStorage.setItem('disclaimerAccepted', 'true')`

---

### `client/src/components/BenchmarkComparison.jsx`

**Props:** `benchmarkData`, `chartData`, `formatCurrency`
**State:** None (pure display)
**API calls:** None
**Renders:**
- Benchmark name + components list
- Period returns table (1Y/3Y/5Y/SI) for basket vs benchmark
- Beats/lags indicators per period
- Chart data as value comparison (basket value vs benchmark value)
- Data type indicator (historical vs projected)

---

### `client/src/pages/Login.jsx`

**State:** `email`, `password`, `error`, `loading`
**API calls:** POST `/api/auth/login`
**On success:** Stores `token` + `userName` in localStorage, calls `window.location.reload()`
**Renders:** Email/password form with error display

---

### `client/src/pages/Register.jsx`

**State:** `name`, `email`, `password`, `age`, `income`, `riskProfile`, `error`, `loading`
**API calls:** POST `/api/auth/register`
**On success:** Stores token, reloads page
**Renders:** Full registration form with risk profile selector

---

### `client/src/pages/ExploreFunds.jsx`

**State:**
| State | Type | Purpose |
|---|---|---|
| `funds` | Array | Current page of funds |
| `loading` | Boolean | API in progress |
| `error` | String | Error message |
| `search` | String | Search query |
| `category` | String | Category filter |
| `page` | Number | Current page |
| `totalPages` | Number | Total pages |
| `sortBy` | String | score/return/name/nav |
| `sortOrder` | String | asc/desc |

**API calls:** GET `/api/funds/explore` with all query params on every filter/page change

**Renders:**
- Search input
- Category dropdown (hardcoded list of AMFI categories)
- Sort controls
- Fund cards grid: name, category, NAV, expected return, 5yr projection, risk score badge
- Pagination controls (prev/next + page numbers)

---

### `client/src/services/api.js`

- Axios instance with `baseURL = process.env.REACT_APP_API_URL || 'http://localhost:5001/api'`
- Not actually used in App.jsx (App.jsx uses its own `API_BASE_URL` constant with axios directly)
- Could be used for future refactoring
