# Technical Dump — Part 1: Folder Structure & File Inventory

## 1. FOLDER STRUCTURE

```
smart-investment-complete-allsteps/
├── client/
│   ├── index.html
│   ├── package.json
│   ├── webpack.config.js
│   ├── .babelrc
│   ├── .env                          # REACT_APP_API_URL=http://localhost:5001/api
│   └── src/
│       ├── index.js                  # React entry point
│       ├── App.jsx                   # Root component (entire main UI)
│       ├── styles.css                # Global CSS
│       ├── components/
│       │   ├── BenchmarkComparison.jsx
│       │   └── Disclaimer.jsx
│       ├── pages/
│       │   ├── ExploreFunds.jsx
│       │   ├── Login.jsx
│       │   └── Register.jsx
│       └── services/
│           └── api.js                # Axios instance
│
├── server/
│   ├── package.json
│   ├── .env                          # PORT, MONGO_URI, JWT_SECRET, API keys
│   └── src/
│       ├── app.js                    # Express entry point, route registration
│       ├── config/
│       │   ├── db.js                 # MongoDB connection
│       │   └── expected-returns.json # Category return bounds config
│       ├── controllers/
│       │   └── authController.js     # register + login logic
│       ├── middleware/
│       │   └── auth.js               # JWT verification middleware
│       ├── models/
│       │   ├── User.js
│       │   ├── FinancialData.js      # Curated 57 funds with price history
│       │   ├── NAV.js                # 42,270 daily NAV records from AMFI
│       │   ├── FundHistory.js        # 429 funds with 5yr history + metrics
│       │   ├── Portfolio.js
│       │   ├── Preference.js
│       │   └── Cache.js
│       ├── routes/
│       │   ├── auth.js
│       │   ├── health.js
│       │   ├── data.js               # Seed + cache + mfapi endpoints
│       │   ├── preferences.js
│       │   ├── recommendations.js    # Legacy simple recommender
│       │   ├── portfolio.js          # Save/list portfolios (auth protected)
│       │   ├── portfolioReturns.js   # CAGR/XIRR calculations
│       │   ├── alpha.js              # Alpha Vantage stock fetch
│       │   ├── mfapi.js              # MFApi sync endpoints
│       │   ├── nav.js                # NAV CRUD + search + sync trigger
│       │   ├── hybrid.js             # Curated + NAV hybrid search
│       │   ├── benchmark.js          # Benchmark comparison
│       │   ├── buckets-multi.js      # MAIN: portfolio generation (3 buckets)
│       │   ├── buckets.js            # Legacy single bucket (unused)
│       │   ├── explore-funds.js      # Browse all 14k funds with pagination
│       │   └── fund-history.js       # FundHistory pipeline management
│       ├── services/
│       │   ├── amfiService.js        # Download + parse AMFI NAV text file
│       │   ├── mfapi.js              # mfapi.in integration + in-memory cache
│       │   ├── hybridFundService.js  # Merge curated + NAV data
│       │   ├── benchmarkService.js   # Blended benchmark calculation
│       │   ├── historicalReturnsService.js  # Historical return calc from NAV
│       │   ├── portfolioReturnsService.js   # CAGR/XIRR from NAV data
│       │   ├── fundHistoryService.js  # 5yr history fetch + metric pipeline
│       │   └── alphaVantage.js       # Alpha Vantage stock data (unused)
│       ├── jobs/
│       │   └── navSyncJob.js         # Scheduled AMFI sync (currently disabled)
│       ├── utils/
│       │   ├── analytics.js          # CAGR, Sharpe-like, computeReturns, mean, std
│       │   └── advancedAnalytics.js  # 9 professional ratios + scoring
│       └── scripts/
│           ├── seed.js               # CSV seed script (legacy)
│           └── mapSchemeCodes.js     # Map curated funds to AMFI scheme codes
│
└── ml-service/
    ├── app.py                        # FastAPI server with /predict endpoint
    ├── train.py                      # Dummy RandomForest training script
    ├── model.joblib                  # Saved dummy model
    ├── requirements.txt
    └── Dockerfile
```

---

## 2. EVERY FILE — NAME + PURPOSE + KEY LOGIC

### CLIENT FILES

---

**`client/src/index.js`**
- Purpose: React app entry point
- Mounts `<App />` into `#root` div using React 18 `createRoot`
- No state, no imports beyond React and App

---

**`client/src/App.jsx`**
- Purpose: Entire main application UI — the biggest file in the frontend
- Key state: `amount`, `duration`, `risk`, `recs`, `selectedBucket`, `view`, `loading`, `dataStats`, `inputChanged`
- Key functions:
  - `generate()` — POSTs to `/api/buckets/generate`, sets `recs`
  - `savePortfolio()` — POSTs to `/api/portfolio/save` (requires auth token)
  - `fetchDataStats()` — GETs `/api/hybrid/stats` + `/api/data/list` for header stats
  - `resetChoices()` — resets all inputs
  - `formatCurrency()` — INR formatter using `Intl.NumberFormat`
- Views rendered: `login`, `register`, `explore`, `main`
- Main view renders: hero, input card (amount/duration/risk), bucket tabs, fund cards with metrics
- Hardcoded: max amount = 10 crore, min = 1000, max duration = 30 years
- Imports: axios, Login, Register, ExploreFunds, Disclaimer, BenchmarkComparison

---

**`client/src/styles.css`**
- Purpose: All global CSS for the app
- Contains: disclaimer overlay, header, nav, hero, input card, risk selector, bucket tabs, fund cards, metrics grid, score breakdown bars, benchmark comparison styles
- No CSS framework — pure custom CSS

---

**`client/src/services/api.js`**
- Purpose: Axios instance with base URL
- Base URL: `process.env.REACT_APP_API_URL || 'http://localhost:5001/api'`
- Note: Not actually used in App.jsx — App.jsx uses axios directly with `API_BASE_URL` constant

---

**`client/src/components/Disclaimer.jsx`**
- Purpose: Legal disclaimer modal shown on first visit
- State: `accepted` (from localStorage `disclaimerAccepted`)
- Logic: Shows modal until user clicks "I Understand", then sets localStorage and hides
- No API calls

---

**`client/src/components/BenchmarkComparison.jsx`**
- Purpose: Renders benchmark vs portfolio comparison section inside bucket view
- Props: `benchmarkData`, `chartData`, `formatCurrency`
- Renders: period-wise returns table (1Y/3Y/5Y), chart data visualization, beats/lags benchmark indicators
- No API calls — receives data as props from App.jsx

---

**`client/src/pages/Login.jsx`**
- Purpose: Login form
- State: `email`, `password`, `error`, `loading`
- API call: POST `/api/auth/login` → stores `token` and `userName` in localStorage → reloads page
- No routing — uses `window.location.reload()`

---

**`client/src/pages/Register.jsx`**
- Purpose: Registration form
- State: `name`, `email`, `password`, `age`, `income`, `riskProfile`, `error`, `loading`
- API call: POST `/api/auth/register` → stores token → reloads page

---

**`client/src/pages/ExploreFunds.jsx`**
- Purpose: Browse all 14,000+ funds with search, filter, pagination
- State: `funds`, `loading`, `error`, `search`, `category`, `page`, `totalPages`, `sortBy`, `sortOrder`
- API call: GET `/api/funds/explore` with query params
- Renders: search bar, category filter dropdown, sort controls, fund cards grid, pagination
- Each fund card shows: name, category, current NAV, expected return, 5yr projection, risk score

---

### SERVER FILES

---

**`server/src/app.js`**
- Purpose: Express app setup and route registration
- Registers 15 route groups
- NAV sync job is commented out (disabled for quick startup)
- Default port: 5001

---

**`server/src/config/db.js`**
- Purpose: MongoDB connection
- URI priority: `MONGODB_URI` → `MONGO_URI` → `mongodb://localhost:27017/smart_investment`
- Does NOT exit on failure — server continues without DB

---

**`server/src/config/expected-returns.json`**
- Purpose: Min/max return bounds per category to prevent unrealistic projections
- Categories: liquid(4-8%), debt(6-11%), balanced(10-22%), large_cap(12-30%), mid_cap(15-55%), small_cap(18-60%), index(10-26%), elss(14-35%), flexi_cap(14-35%)
- Used by `applyExpectedReturnBounds()` in analytics.js

---

**`server/src/middleware/auth.js`**
- Purpose: JWT Bearer token verification
- Extracts token from `Authorization: Bearer <token>` header
- Verifies with `JWT_SECRET` env var (fallback: `'secret'`)
- Attaches `req.user` (without passwordHash)

---

**`server/src/controllers/authController.js`**
- Purpose: register + login handlers
- `register()`: validates email/password, checks duplicate, bcrypt hashes password (salt=10), creates User, returns JWT (7d expiry)
- `login()`: finds user by email, bcrypt.compare, returns JWT
- JWT secret fallback: `'secret'` (insecure default)

---

**`server/src/utils/analytics.js`**
- Purpose: Basic financial math utilities
- `computeReturns(history)` — array of period-over-period returns from price history
- `mean(arr)` — arithmetic mean
- `std(arr)` — sample standard deviation
- `cagr(history)` — Compound Annual Growth Rate from price history
- `sharpeLike(history, rf=0.03)` — simplified Sharpe ratio
- `applyExpectedReturnBounds(cagr, category)` — clamps CAGR to category bounds from JSON config

---

**`server/src/utils/advancedAnalytics.js`**
- Purpose: Professional financial metrics for fund scoring
- See Section 5 (Scoring Algorithm) for full detail
- Exports: sharpeRatio, sortinoRatio, beta, treynorRatio, alpha, informationRatio, standardDeviation, calculateFundScore, generateMarketReturns, normalize

---

**`server/src/jobs/navSyncJob.js`**
- Purpose: Scheduled daily AMFI NAV sync
- Class `NAVSyncJob` with `start(intervalHours)`, `stop()`, `runSync()`, `getStatus()`
- `runSync()`: calls `syncNAVData()` then `syncCuratedFundsWithNAV()`
- Currently DISABLED in app.js (commented out)
- Singleton exported

---

**`server/src/scripts/seed.js`**
- Purpose: Legacy CSV seed script — reads `data/sample_prices.csv` and seeds one SAMPLE_STOCK
- Not used in production — superseded by `/api/data/mock-seed`

---

**`server/src/scripts/mapSchemeCodes.js`**
- Purpose: One-time script to match curated fund names to AMFI scheme codes
- Fuzzy matches fund names against NAV collection
- Updates `meta.schemeCode` on FinancialData documents
- Run manually: `node src/scripts/mapSchemeCodes.js`
