# Technical Dump — Part 6: ML Service, Environment Variables, Broken/Incomplete, Dependencies

## 9. ML SERVICE (FastAPI)

**Location:** `ml-service/`

### Files:
- `app.py` — FastAPI server
- `train.py` — Training script
- `model.joblib` — Saved model file
- `requirements.txt` — Python dependencies
- `Dockerfile` — Container config

### Endpoints:

**GET `/`**
- Returns: `{ok: true, model_loaded: bool}`

**POST `/predict`**
- Body: `{features: [float, float, float]}`
- Input: 3 features — `[cagr, volatility, sharpe]`
- Output: `{prediction: [0 or 1]}`
- 0 = "bad fund", 1 = "good fund"

### Model:
- Algorithm: `RandomForestClassifier(n_estimators=50)` from scikit-learn
- Training data: **200 rows of `np.random.rand(200, 3)` — completely synthetic**
- Label: `y = (X[:,2] > 0.2).astype(int)` — if sharpe > 0.2 → good
- This model is **meaningless** — trained on random data

### Is it connected to Node.js?
**NO.** There is zero integration between the Node.js server and the ML service.
- No HTTP calls from any Node.js file to `localhost:5000` or any ML endpoint
- The `hybridFundService.js` is named "hybrid" but refers to combining curated + NAV data, NOT ML + rule-based
- The ML service is a standalone demo that is never invoked

### How to run (manually):
```bash
cd ml-service
pip install -r requirements.txt
python train.py          # generates model.joblib
uvicorn app:app --port 5000
```

---

## 10. ENVIRONMENT VARIABLES

### Server (`server/.env`)

| Variable | Purpose | Default/Example |
|---|---|---|
| `PORT` | Express server port | `5001` |
| `MONGO_URI` | MongoDB connection string | `mongodb://localhost:27017/smart_investment` |
| `MONGODB_URI` | Alternative MongoDB URI (checked first) | — |
| `JWT_SECRET` | JWT signing secret | `your_jwt_secret_key_here_replace_with_strong_secret` |
| `ALPHA_VANTAGE_KEY` | Alpha Vantage API key for stock data | `your_alpha_vantage_key` |
| `YAHOO_API_KEY` | Yahoo Finance API key (unused) | `your_yahoo_api_key` |
| `ENABLE_NAV_SYNC` | Set to `'false'` to disable auto NAV sync | Not set = sync enabled |

### Client (`client/.env`)

| Variable | Purpose | Default/Example |
|---|---|---|
| `REACT_APP_API_URL` | Backend API base URL | `http://localhost:5001/api` |

### ML Service
No `.env` file. No environment variables used.

---

## 11. WHAT IS BROKEN OR INCOMPLETE

### Critical Issues

**1. Market returns are synthetic (Beta/Alpha are meaningless)**
```javascript
// advancedAnalytics.js
function generateMarketReturns(length) {
  // Simulate market return: ~12% annual with volatility
  const monthlyReturn = 0.01 + (Math.random() - 0.5) * 0.04;
  // This is RANDOM — not real Nifty 50 data
}
```
Impact: Beta, Alpha, Treynor, Information Ratio are all computed against fake market data. Every time you generate recommendations, these values change randomly.

**2. Expense ratio and turnover ratio are random**
```javascript
// buckets-multi.js (curated path)
const expenseRatio = 0.005 + Math.random() * 0.02;
const turnoverRatio = 0.2 + Math.random() * 0.8;
```
Impact: 10% of the score is based on random numbers.

**3. ML service is completely disconnected**
- `train.py` trains on random data
- `app.py` serves predictions but is never called
- No integration with Node.js

**4. NAV sync job is disabled**
```javascript
// app.js
// if (process.env.ENABLE_NAV_SYNC !== 'false') {
//   navSyncJob.start(24);
// }
```
The 14,000 fund NAVs are NOT being updated automatically. Must be triggered manually via `POST /api/nav/sync`.

**5. Duplicate scheme codes in POPULAR_FUNDS**
In `mfapi.js`, the same scheme code (e.g. `120716`) is used for multiple different fund names across categories. This means the mfapi sync fetches the same fund multiple times under different names.

**6. `api.js` service is unused**
`client/src/services/api.js` creates an axios instance but `App.jsx` uses its own inline axios calls with a separate `API_BASE_URL` constant.

---

### Partially Built Features

**7. Benchmark data is hardcoded mock**
```javascript
// benchmarkService.js
const MOCK_BENCHMARK_RETURNS = {
  'NIFTY 50 TRI': { '1Y': 0.24, '3Y': 0.16, '5Y': 0.17, 'SI': 0.13 },
  // ...
};
```
Real benchmark data from NSE/BSE is not fetched. The `fetchBenchmarkReturns()` function checks cache then returns mock data.

**8. XIRR is approximated**
```javascript
// portfolioReturnsService.js
// Simple approximation - for production, use a proper XIRR library
```
The XIRR calculation is a simplified annualized return, not true XIRR.

**9. `buckets.js` is legacy/unused**
The old single-bucket route exists but is not registered in `app.js`. Only `buckets-multi.js` is used.

**10. `recommendations.js` is legacy**
Simple CAGR + Sharpe-like scorer, not used by frontend.

**11. Alpha Vantage integration is unused**
`alphaVantage.js` and `alpha.js` route exist but require a paid API key and are not called from frontend.

**12. Preferences are saved but never read**
`POST /api/preferences` saves user preferences but nothing reads them back to personalize recommendations.

**13. Portfolio save works but portfolio view doesn't exist in UI**
Users can save portfolios (auth required) but there's no UI page to view saved portfolios.

**14. FundHistory metrics need periodic refresh**
Once fetched, fund metrics are never updated. There's no scheduled job to refresh them. The `lastFetched` field exists but no refresh logic.

**15. `seed.js` script references missing file**
```javascript
fs.readFileSync(__dirname + '/../../data/sample_prices.csv', 'utf8')
```
The `data/sample_prices.csv` file doesn't exist in the repo.

---

### Hardcoded Values That Should Be Dynamic

| Location | Hardcoded Value | Should Be |
|---|---|---|
| `benchmarkService.js` | All benchmark returns (NIFTY 50 TRI etc.) | Fetched from NSE/BSE API |
| `advancedAnalytics.js` | `riskFreeRate = 0.06` | RBI repo rate (currently ~6.5%) |
| `advancedAnalytics.js` | Market returns = synthetic | Real Nifty 50 monthly returns |
| `buckets-multi.js` | Allocation percentages | Could be user-configurable |
| `explore-funds.js` | Expected returns per category | Should use expected-returns.json |
| `mfapi.js` | POPULAR_FUNDS list | Should be dynamic from NAV collection |
| `App.jsx` | `API_BASE_URL` constant | Should use `api.js` service |

---

## 12. DEPENDENCIES

### Server (`server/package.json`)

| Package | Version | Purpose |
|---|---|---|
| `express` | ^4.18.2 | HTTP server framework |
| `mongoose` | ^7.0.0 | MongoDB ODM |
| `cors` | ^2.8.5 | CORS middleware |
| `dotenv` | ^16.0.0 | Environment variables |
| `bcryptjs` | ^2.4.3 | Password hashing |
| `jsonwebtoken` | ^9.0.0 | JWT auth |
| `axios` | ^1.4.0 | HTTP client (for AMFI + mfapi calls) |
| `nodemon` | ^2.0.22 | Dev auto-restart (devDependency) |

**Notable missing packages:**
- No validation library (express-validator, joi, zod)
- No rate limiting middleware (express-rate-limit)
- No logging library (winston, morgan)
- No test framework (jest, mocha)
- No XIRR library (xirr, financial)

---

### Client (`client/package.json`)

| Package | Version | Purpose |
|---|---|---|
| `react` | ^18.2.0 | UI framework |
| `react-dom` | ^18.2.0 | DOM rendering |
| `axios` | ^1.4.0 | HTTP client |
| `css-loader` | ^7.1.2 | Webpack CSS processing |
| `style-loader` | ^4.0.0 | Webpack CSS injection |
| `webpack` | ^5.88.0 | Bundler |
| `webpack-cli` | ^5.1.4 | Webpack CLI |
| `webpack-dev-server` | ^4.15.1 | Dev server |
| `@babel/core` | ^7.22.0 | JS transpiler |
| `@babel/preset-env` | ^7.28.5 | ES6+ transpilation |
| `@babel/preset-react` | ^7.22.0 | JSX transpilation |
| `babel-loader` | ^9.1.2 | Webpack Babel integration |
| `html-webpack-plugin` | ^5.5.3 | HTML generation |
| `dotenv` | ^17.2.3 | Env vars in webpack |
| `http-server` | ^14.1.1 | Static file server (unused) |
| `baseline-browser-mapping` | ^2.10.13 | Browser compat (was outdated, caused slow builds) |

**Notable missing packages:**
- No React Router (navigation is manual state-based)
- No state management (Redux, Zustand, Context)
- No UI component library (MUI, Ant Design, Chakra)
- No charting library (recharts, chart.js) — charts are custom HTML/CSS
- No form library (react-hook-form, formik)

---

### ML Service (`ml-service/requirements.txt`)

| Package | Purpose |
|---|---|
| `fastapi` | HTTP framework |
| `uvicorn` | ASGI server |
| `scikit-learn` | RandomForestClassifier |
| `pandas` | Data manipulation (imported but not used in app.py) |
| `joblib` | Model serialization |
| `numpy` | Array operations |

---

## INDEX OF ALL DOCS FILES

- `DOCS/TECH_DUMP_1_STRUCTURE_AND_FILES.md` — Folder tree + every file explained
- `DOCS/TECH_DUMP_2_DATABASE.md` — All 6 MongoDB collections with schemas + samples
- `DOCS/TECH_DUMP_3_API_ROUTES.md` — All 40+ API routes with request/response
- `DOCS/TECH_DUMP_4_SCORING_AND_PORTFOLIO.md` — Exact scoring formulas + portfolio generation logic
- `DOCS/TECH_DUMP_5_MFAPI_AND_FRONTEND.md` — MFApi integration + all React components
- `DOCS/TECH_DUMP_6_ML_ENV_BROKEN_DEPS.md` — ML service + env vars + broken features + dependencies
