"""
ml-service/app.py — Flask API for XGBoost + SHAP fund scoring

Endpoints:
  GET  /           — health check
  POST /explain    — predict score + SHAP contributions for a fund
  GET  /features   — list expected feature names

Runs on port 5002 (Node.js server uses 5001)
"""

import os
import numpy as np
import joblib
from flask import Flask, request, jsonify

app = Flask(__name__)

# ─── Load models at startup ───────────────────────────────────────────────────

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

MODEL_PATH     = os.path.join(BASE_DIR, 'model.joblib')
EXPLAINER_PATH = os.path.join(BASE_DIR, 'shap_explainer.joblib')

model     = None
explainer = None

def load_models():
    global model, explainer
    if os.path.exists(MODEL_PATH):
        model = joblib.load(MODEL_PATH)
        print(f"✅ model.joblib loaded")
    else:
        print(f"⚠️  model.joblib not found at {MODEL_PATH}")

    if os.path.exists(EXPLAINER_PATH):
        explainer = joblib.load(EXPLAINER_PATH)
        print(f"✅ shap_explainer.joblib loaded")
    else:
        print(f"⚠️  shap_explainer.joblib not found at {EXPLAINER_PATH}")

load_models()

# Feature order must match training order exactly
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

# Map incoming field names to internal feature names
# (stdDeviation in request → standardDeviation internally)
FIELD_MAP = {
    'sharpeRatio':      'sharpeRatio',
    'sortinoRatio':     'sortinoRatio',
    'alpha':            'alpha',
    'beta':             'beta',
    'treynorRatio':     'treynorRatio',
    'informationRatio': 'informationRatio',
    'stdDeviation':     'standardDeviation',   # alias
    'standardDeviation':'standardDeviation',
    'maxDrawdown':      'maxDrawdown',
    'cagr1Y':           'cagr1Y',
}


# ─── Routes ───────────────────────────────────────────────────────────────────

@app.route('/', methods=['GET'])
def health():
    return jsonify({
        'ok': True,
        'model_loaded':     model is not None,
        'explainer_loaded': explainer is not None,
        'features':         FEATURES,
        'port':             5002,
    })


@app.route('/features', methods=['GET'])
def features():
    return jsonify({
        'features': FEATURES,
        'note': 'Use stdDeviation or standardDeviation for standard deviation field'
    })


@app.route('/explain', methods=['POST'])
def explain():
    if model is None or explainer is None:
        return jsonify({'error': 'Models not loaded. Run train.py first.'}), 503

    body = request.get_json(silent=True)
    if not body:
        return jsonify({'error': 'Request body must be JSON'}), 400

    # ── Parse and validate features ──────────────────────────────────────────
    feature_values = {}
    missing = []

    for incoming_key, internal_key in FIELD_MAP.items():
        if incoming_key in body and internal_key not in feature_values:
            val = body[incoming_key]
            try:
                feature_values[internal_key] = float(val)
            except (TypeError, ValueError):
                return jsonify({'error': f'Field {incoming_key} must be numeric, got: {val}'}), 400

    # Check all 9 features are present
    for feat in FEATURES:
        if feat not in feature_values:
            missing.append(feat)

    if missing:
        return jsonify({
            'error': f'Missing required fields: {missing}',
            'required_fields': [
                'sharpeRatio', 'sortinoRatio', 'alpha', 'beta',
                'treynorRatio', 'informationRatio', 'stdDeviation',
                'maxDrawdown', 'cagr1Y'
            ]
        }), 400

    # ── Build feature vector in correct order ─────────────────────────────────
    X = np.array([[feature_values[f] for f in FEATURES]])

    # ── Predict ───────────────────────────────────────────────────────────────
    predicted_score = float(model.predict(X)[0])

    # ── SHAP ──────────────────────────────────────────────────────────────────
    shap_vals = explainer.shap_values(X)[0]   # shape: (9,)
    base_value = float(explainer.expected_value)

    # Build contributions array sorted by |shap_value| descending
    contributions = []
    for i, feat in enumerate(FEATURES):
        sv = float(shap_vals[i])
        contributions.append({
            'metric':      feat,
            'value':       round(feature_values[feat], 6),
            'shap_value':  round(sv, 6),
            'direction':   'positive' if sv >= 0 else 'negative',
            'abs_impact':  round(abs(sv), 6),
        })

    contributions.sort(key=lambda x: x['abs_impact'], reverse=True)

    # ── Response ──────────────────────────────────────────────────────────────
    return jsonify({
        'predicted_score': round(predicted_score, 4),
        'base_value':      round(base_value, 4),
        'shap_sum':        round(sum(c['shap_value'] for c in contributions), 4),
        'contributions':   contributions,
    })


# ─── Run ──────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    print("Starting ML service on port 5002...")
    app.run(host='0.0.0.0', port=5002, debug=False)
