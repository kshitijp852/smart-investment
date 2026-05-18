"""
train.py — XGBoost + SHAP training on real fund metrics from MongoDB

Loads 429 FundHistory records, trains XGBoost to predict finalScore
from 9 financial features, computes SHAP values, saves artifacts.

Outputs:
  model.joblib          — trained XGBoost model
  shap_explainer.joblib — SHAP TreeExplainer
  shap_values.json      — per-fund SHAP values + feature names
"""

import json
import warnings
warnings.filterwarnings('ignore')

import numpy as np
import pandas as pd
import joblib
from pymongo import MongoClient
from sklearn.model_selection import train_test_split
from sklearn.metrics import r2_score, mean_squared_error
import xgboost as xgb
import shap

# ─── 1. Load data from MongoDB ────────────────────────────────────────────────

print("=" * 60)
print("STEP 1: Loading data from MongoDB")
print("=" * 60)

client = MongoClient('mongodb://localhost:27017/')
db = client['smart_investment']

cursor = db.fundhistories.find(
    {"status": "fetched", "metrics.finalScore": {"$gt": 0}},
    {
        "_id": 0,
        "schemeCode": 1,
        "schemeName": 1,
        "internalCategory": 1,
        "metrics.sharpeRatio": 1,
        "metrics.sortinoRatio": 1,
        "metrics.alpha": 1,
        "metrics.beta": 1,
        "metrics.treynorRatio": 1,
        "metrics.informationRatio": 1,
        "metrics.standardDeviation": 1,
        "metrics.maxDrawdown": 1,
        "metrics.cagr1Y": 1,
        "metrics.finalScore": 1,
    }
)

records = list(cursor)
client.close()

print(f"Records loaded: {len(records)}")

# ─── 2. Build DataFrame ───────────────────────────────────────────────────────

print("\nSTEP 2: Building feature matrix")

FEATURES = [
    'sharpeRatio',
    'sortinoRatio',
    'alpha',
    'beta',
    'treynorRatio',
    'informationRatio',
    'standardDeviation',
    'maxDrawdown',
    'cagr1Y',
]

rows = []
for r in records:
    m = r.get('metrics', {})
    row = {
        'schemeCode':       r.get('schemeCode', ''),
        'schemeName':       r.get('schemeName', ''),
        'internalCategory': r.get('internalCategory', ''),
        'sharpeRatio':      m.get('sharpeRatio'),
        'sortinoRatio':     m.get('sortinoRatio'),
        'alpha':            m.get('alpha'),
        'beta':             m.get('beta'),
        'treynorRatio':     m.get('treynorRatio'),
        'informationRatio': m.get('informationRatio'),
        'standardDeviation':m.get('standardDeviation'),
        'maxDrawdown':      m.get('maxDrawdown'),
        'cagr1Y':           m.get('cagr1Y'),
        'finalScore':       m.get('finalScore'),
    }
    rows.append(row)

df = pd.DataFrame(rows)
print(f"Raw shape: {df.shape}")
print(f"Missing values per feature:\n{df[FEATURES].isnull().sum().to_string()}")

# Drop rows where target or any feature is missing/infinite
df = df.replace([np.inf, -np.inf], np.nan)
df_clean = df.dropna(subset=FEATURES + ['finalScore'])
print(f"\nClean shape (after dropping NaN/inf): {df_clean.shape}")

X = df_clean[FEATURES].values
y = df_clean['finalScore'].values

print(f"\nTarget (finalScore) stats:")
print(f"  min={y.min():.4f}  max={y.max():.4f}  mean={y.mean():.4f}  std={y.std():.4f}")

# ─── 3. Train/test split ──────────────────────────────────────────────────────

print("\nSTEP 3: Train/test split (80/20)")

X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42
)
print(f"Train: {X_train.shape[0]} samples | Test: {X_test.shape[0]} samples")

# ─── 4. Train XGBoost ─────────────────────────────────────────────────────────

print("\nSTEP 4: Training XGBoost regressor")

model = xgb.XGBRegressor(
    n_estimators=300,
    max_depth=4,
    learning_rate=0.05,
    subsample=0.8,
    colsample_bytree=0.8,
    reg_alpha=0.1,
    reg_lambda=1.0,
    random_state=42,
    verbosity=0,
)

model.fit(
    X_train, y_train,
    eval_set=[(X_test, y_test)],
    verbose=False,
)

# ─── 5. Evaluate ─────────────────────────────────────────────────────────────

print("\nSTEP 5: Evaluation")

y_pred_train = model.predict(X_train)
y_pred_test  = model.predict(X_test)

r2_train  = r2_score(y_train, y_pred_train)
r2_test   = r2_score(y_test,  y_pred_test)
rmse_train = np.sqrt(mean_squared_error(y_train, y_pred_train))
rmse_test  = np.sqrt(mean_squared_error(y_test,  y_pred_test))

print(f"  Train  →  R²: {r2_train:.4f}   RMSE: {rmse_train:.4f}")
print(f"  Test   →  R²: {r2_test:.4f}   RMSE: {rmse_test:.4f}")

# Feature importance from XGBoost
print("\nXGBoost feature importances (gain):")
importances = model.get_booster().get_score(importance_type='gain')
for feat in FEATURES:
    key = f'f{FEATURES.index(feat)}'
    print(f"  {feat:<22} {importances.get(key, 0.0):.4f}")

# ─── 6. SHAP values ──────────────────────────────────────────────────────────

print("\nSTEP 6: Computing SHAP values")

explainer   = shap.TreeExplainer(model)
shap_values = explainer.shap_values(X)   # shape: (n_samples, n_features)

print(f"SHAP values shape: {shap_values.shape}")

# Mean absolute SHAP per feature
mean_abs_shap = np.abs(shap_values).mean(axis=0)
print("\nMean |SHAP| per feature (global importance):")
shap_importance = sorted(
    zip(FEATURES, mean_abs_shap),
    key=lambda x: x[1], reverse=True
)
for feat, val in shap_importance:
    print(f"  {feat:<22} {val:.6f}")

# ─── 7. Save artifacts ───────────────────────────────────────────────────────

print("\nSTEP 7: Saving artifacts")

joblib.dump(model,     'model.joblib')
joblib.dump(explainer, 'shap_explainer.joblib')
print("  ✅ model.joblib saved")
print("  ✅ shap_explainer.joblib saved")

# Build shap_values.json — per fund with scheme info
shap_output = {
    "feature_names": FEATURES,
    "expected_value": float(explainer.expected_value),
    "r2_test": round(r2_test, 4),
    "rmse_test": round(rmse_test, 4),
    "global_importance": {
        feat: round(float(val), 6)
        for feat, val in shap_importance
    },
    "funds": []
}

for i, row in enumerate(df_clean.itertuples(index=False)):
    fund_entry = {
        "schemeCode":       row.schemeCode,
        "schemeName":       row.schemeName,
        "internalCategory": row.internalCategory,
        "finalScore":       round(float(row.finalScore), 4),
        "shap_values": {
            feat: round(float(shap_values[i][j]), 6)
            for j, feat in enumerate(FEATURES)
        },
        "features": {
            feat: round(float(getattr(row, feat)), 6) if getattr(row, feat) is not None else None
            for feat in FEATURES
        }
    }
    shap_output["funds"].append(fund_entry)

with open('shap_values.json', 'w') as f:
    json.dump(shap_output, f, indent=2)

print(f"  ✅ shap_values.json saved ({len(shap_output['funds'])} funds)")

# ─── 8. Summary ──────────────────────────────────────────────────────────────

print("\n" + "=" * 60)
print("TRAINING COMPLETE")
print("=" * 60)
print(f"  Funds trained on : {len(df_clean)}")
print(f"  Features         : {len(FEATURES)}")
print(f"  R² (test)        : {r2_test:.4f}")
print(f"  RMSE (test)      : {rmse_test:.4f}")
print(f"  Top feature      : {shap_importance[0][0]} (SHAP={shap_importance[0][1]:.4f})")
print("=" * 60)
