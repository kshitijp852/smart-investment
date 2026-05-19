import React from 'react';

const METRIC_LABEL = {
  sharpeRatio:      'Sharpe',
  sortinoRatio:     'Sortino',
  alpha:            'Alpha',
  beta:             'Beta',
  treynorRatio:     'Treynor',
  informationRatio: 'Info Ratio',
  stdDeviation:     'Volatility',
  standardDeviation:'Volatility',
  maxDrawdown:      'Max Drawdown',
  cagr1Y:           '1Y CAGR',
};

export default function ShapPanel({ explanation }) {
  if (!explanation || !explanation.contributions || explanation.contributions.length === 0) {
    return (
      <div className="shap-panel">
        <div className="shap-header">
          <span className="shap-title">SHAP Explainability</span>
        </div>
        <div className="shap-empty">Explanation unavailable — ML service not reachable.</div>
      </div>
    );
  }

  const { predicted_score, base_value, contributions } = explanation;
  const maxAbs = Math.max(...contributions.map(c => c.abs_impact)) || 1;
  const topN = contributions.slice(0, 6);

  return (
    <div className="shap-panel">
      <div className="shap-header">
        <span className="shap-title">Why this fund? — SHAP</span>
        <span className="shap-score-pill">predicted {Number(predicted_score).toFixed(2)}</span>
      </div>
      <div className="shap-base">base = {Number(base_value).toFixed(2)} · drivers ranked by |Δ|</div>
      <div className="shap-rows">
        {topN.map((c, i) => {
          const pct = (c.abs_impact / maxAbs) * 50;
          const positive = c.shap_value >= 0;
          const left  = positive ? 50 : 50 - pct;
          const width = pct;
          return (
            <div className="shap-row" key={i}>
              <span className="shap-metric">{METRIC_LABEL[c.metric] || c.metric}</span>
              <div className="shap-bar-track">
                <div
                  className={`shap-bar ${positive ? 'positive' : 'negative'}`}
                  style={{ left: `${left}%`, width: `${width}%` }}
                />
              </div>
              <span className={`shap-impact ${positive ? 'positive' : 'negative'}`}>
                {positive ? '+' : ''}{c.shap_value.toFixed(2)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
