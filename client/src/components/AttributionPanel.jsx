import React from 'react';

const VERDICT_TEXT = {
  fund_selection_adds_consistent_value: 'Fund selection adds consistent value vs benchmark',
  outperforms_but_inconsistently:       'Outperforms benchmark, but not consistently',
  underperforms_risk_adjusted_benchmark:'Underperforms benchmark on a risk-adjusted basis',
};

const fmtPct = (v) => (v == null || Number.isNaN(v) ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`);
const fmtNum = (v, d = 2) => (v == null || Number.isNaN(v) ? '—' : v.toFixed(d));
const sign   = (v) => (v == null ? '' : v >= 0 ? 'positive' : 'negative');

export default function AttributionPanel({ attribution }) {
  if (!attribution) return null;
  const { summary = {}, bhbAttribution = {} } = attribution;

  const allocE  = bhbAttribution.allocationEffect  ?? null;
  const selE    = bhbAttribution.selectionEffect   ?? null;
  const interE  = bhbAttribution.interactionEffect ?? null;
  const hasBHB  = allocE != null || selE != null || interE != null;

  return (
    <div className="attribution-panel">
      <div className="attribution-head">
        <h3 className="attribution-title">Portfolio Attribution · {summary.primaryPeriod || ''}</h3>
        <span className="attribution-verdict">{VERDICT_TEXT[summary.verdict] || ''}</span>
      </div>

      <div className="attribution-grid">
        <div className="attr-stat">
          <div className="attr-stat-label">Active Return</div>
          <div className={`attr-stat-value ${sign(summary.activeReturn)}`}>{fmtPct(summary.activeReturn)}</div>
          <div className="attr-stat-sub">Portfolio − Benchmark</div>
        </div>
        <div className="attr-stat">
          <div className="attr-stat-label">Jensen's Alpha</div>
          <div className={`attr-stat-value ${sign(summary.jensensAlpha)}`}>{fmtPct(summary.jensensAlpha)}</div>
          <div className="attr-stat-sub">CAPM risk-adjusted</div>
        </div>
        <div className="attr-stat">
          <div className="attr-stat-label">Information Ratio</div>
          <div className={`attr-stat-value ${sign(summary.informationRatio)}`}>{fmtNum(summary.informationRatio, 3)}</div>
          <div className="attr-stat-sub">{summary.irSource === 'rolling' ? 'Rolling windows' : 'Period approx.'}</div>
        </div>
        <div className="attr-stat">
          <div className="attr-stat-label">Portfolio Beta</div>
          <div className="attr-stat-value">{fmtNum(summary.portfolioBeta, 3)}</div>
          <div className="attr-stat-sub">vs blended benchmark</div>
        </div>
      </div>

      {hasBHB && (
        <div className="bhb-section">
          <div className="bhb-title">Brinson–Hood–Beebower Decomposition</div>
          <div className="bhb-effects">
            <div className="bhb-effect">
              <div className="bhb-effect-name">Allocation</div>
              <div className={`bhb-effect-val ${sign(allocE)}`}>{fmtPct(allocE)}</div>
              <div className="bhb-effect-hint">Category weighting decisions</div>
            </div>
            <div className="bhb-effect">
              <div className="bhb-effect-name">Selection</div>
              <div className={`bhb-effect-val ${sign(selE)}`}>{fmtPct(selE)}</div>
              <div className="bhb-effect-hint">Fund picks within category</div>
            </div>
            <div className="bhb-effect">
              <div className="bhb-effect-name">Interaction</div>
              <div className={`bhb-effect-val ${sign(interE)}`}>{fmtPct(interE)}</div>
              <div className="bhb-effect-hint">Joint allocation × selection</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
