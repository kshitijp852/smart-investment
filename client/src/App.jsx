
import React, { useState } from 'react';
import axios from 'axios';
import Login from './pages/Login';
import Register from './pages/Register';
import ExploreFunds from './pages/ExploreFunds';
import Disclaimer from './components/Disclaimer';
import BenchmarkComparison from './components/BenchmarkComparison';
import ShapPanel from './components/ShapPanel';
import AttributionPanel from './components/AttributionPanel';
import './styles.css';

// API Base URL - uses environment variable or defaults to localhost
const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5001/api';

export default function App(){
  const [amount, setAmount] = useState(100000);
  const [duration, setDuration] = useState(3);
  const [risk, setRisk] = useState('medium');
  const [recs, setRecs] = useState(null);
  const [selectedBucket, setSelectedBucket] = useState(0);
  const [view, setView] = useState('main');
  const [loading, setLoading] = useState(false);
  const [dataStats, setDataStats] = useState(null);
  const [inputChanged, setInputChanged] = useState(false);

  const token = localStorage.getItem('token');
  const userName = localStorage.getItem('userName');
  const authHeaders = token ? { headers: { Authorization: `Bearer ${token}` } } : {};

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('userName');
    window.location.reload();
  };

  const fetchDataStats = async () => {
    try {
      // Get hybrid system stats
      const hybridRes = await axios.get(`${API_BASE_URL}/hybrid/stats`);
      const hybridData = hybridRes.data.data;
      
      // Get curated funds for category breakdown
      const fundsRes = await axios.get(`${API_BASE_URL}/data/list`);
      const data = fundsRes.data;
      const mutualFunds = data.filter(d => d.type === 'mutual_fund');
      
      // Count by category
      const categories = {};
      mutualFunds.forEach(fund => {
        const cat = fund.meta?.category || 'other';
        categories[cat] = (categories[cat] || 0) + 1;
      });
      
      const stats = {
        curated: hybridData.curatedFunds,
        withRealTimeNAV: hybridData.curatedWithRealTimeNAV,
        totalAvailable: hybridData.totalFundsAvailable,
        coverage: hybridData.coveragePercentage,
        categories: categories
      };
      setDataStats(stats);
    } catch (err) {
      console.error('Error fetching data stats:', err);
      // Fallback to old method
      try {
        const res = await axios.get(`${API_BASE_URL}/data/list`);
        const data = res.data;
        const mutualFunds = data.filter(d => d.type === 'mutual_fund');
        const categories = {};
        mutualFunds.forEach(fund => {
          const cat = fund.meta?.category || 'other';
          categories[cat] = (categories[cat] || 0) + 1;
        });
        setDataStats({
          curated: mutualFunds.length,
          totalAvailable: mutualFunds.length,
          categories: categories
        });
      } catch (fallbackErr) {
        console.error('Fallback stats fetch failed:', fallbackErr);
      }
    }
  };

  const handleAmountChange = (value) => {
    const numValue = Number(value);
    if (numValue >= 0 && numValue <= 100000000) { // Max 10 crore
      setAmount(numValue);
      setInputChanged(true);
    }
  };

  const handleDurationChange = (value) => {
    const numValue = Number(value);
    // Allow any positive number, will validate on submit
    if (!isNaN(numValue) && numValue >= 0) {
      setDuration(numValue);
      setInputChanged(true);
    }
  };

  const handleRiskChange = (value) => {
    setRisk(value);
    setInputChanged(true);
  };

  const generate = async () => {
    if (!amount || amount < 1000) {
      alert('⚠️ Please enter a minimum amount of ₹1,000');
      return;
    }
    if (!duration || duration < 1) {
      alert('⚠️ Please enter a valid duration (minimum 1 year)');
      return;
    }

    setLoading(true);
    setInputChanged(false);
    try {
      const res = await axios.post(`${API_BASE_URL}/buckets/generate`, { 
        amount: Number(amount), 
        duration: Number(duration), 
        riskLevel: risk 
      });
      setRecs(res.data);
      
      if (!res.data.bucket || res.data.bucket.length === 0) {
        alert('⚠️ No mutual funds available. Please load sample data first.');
      }
    } catch (err) { 
      console.error(err); 
      if (err.response?.status === 404) {
        alert('⚠️ No mutual funds available. Please load sample data first.');
      } else {
        alert('❌ Error generating recommendations. Please try again.');
      }
    }
    setLoading(false);
  };

  const resetChoices = () => {
    setAmount(100000);
    setDuration(3);
    setRisk('medium');
    setRecs(null);
    setSelectedBucket(0);
    setInputChanged(false);
  };

  // Fetch data stats on mount
  React.useEffect(() => {
    fetchDataStats();
  }, []);

  const savePortfolio = async () => {
    if (!token) return alert('Please login first to save portfolio');
    if (!recs || !recs.bucketOptions) return alert('No portfolio to save');
    
    const currentBucket = recs.bucketOptions[selectedBucket];
    if (!currentBucket || !currentBucket.bucket) return alert('No portfolio selected');
    
    try {
      const items = currentBucket.bucket.map(fund => ({ 
        symbol: fund.symbol, 
        type: 'mutual_fund', 
        amount: fund.allocation 
      }));
      const res = await axios.post(`${API_BASE_URL}/portfolio/save`, { items }, authHeaders);
      alert(`✅ ${currentBucket.strategy.name} saved successfully! ${currentBucket.bucket.length} mutual funds in your bucket.`);
      console.log(res.data);
    } catch (err){ 
      console.error(err); 
      alert('Error saving portfolio'); 
    }
  };

  const formatCurrency = (num) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(num);
  };

  const getRiskColor = (riskLevel) => {
    const colors = { low: '#10b981', medium: '#f59e0b', high: '#ef4444' };
    return colors[riskLevel] || '#6b7280';
  };

  const getTypeIcon = (type) => {
    const icons = { stock: '📈', mutual_fund: '📊', fd: '🏦' };
    return icons[type] || '💰';
  };

  return (
    <div className="app">
      {/* Legal Disclaimer */}
      <Disclaimer />
      
      {/* Header */}
      <header className="header">
        <div className="header-content">
          <div className="logo">
            <span className="logo-text">SmartInvest</span>
          </div>
          <nav className="nav">
            <button className={view === 'main' ? 'nav-btn active' : 'nav-btn'} onClick={()=>setView('main')}>
              Home
            </button>
            <button className={view === 'explore' ? 'nav-btn active' : 'nav-btn'} onClick={()=>setView('explore')}>
              Explore Funds
            </button>
            {!token ? (
              <>
                <button className={view === 'login' ? 'nav-btn active' : 'nav-btn'} onClick={()=>setView('login')}>
                  Login
                </button>
                <button className={view === 'register' ? 'nav-btn active' : 'nav-btn'} onClick={()=>setView('register')}>
                  Register
                </button>
              </>
            ) : (
              <div className="user-menu">
                <span className="user-name">{userName || 'User'}</span>
                <button className="nav-btn logout" onClick={logout}>Logout</button>
              </div>
            )}
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="main-content">
        {view === 'login' && <Login />}
        {view === 'register' && <Register />}
        {view === 'explore' && <ExploreFunds />}

        {view === 'main' && (
          <div className="dashboard">
            {/* Hero Section */}
            <section className="hero">
              <h1 className="hero-title">Invest Smarter, Not Harder</h1>
              <p className="hero-subtitle">AI-powered investment recommendations tailored to your goals</p>
            </section>

            {/* Input Card */}
            <section className="input-section">
              <div className="card">
                <h2 className="card-title">Your Investment Goals</h2>
                
                {dataStats && (
                  <div className="data-stats">
                    <span className="stats-badge">
                      📊 {dataStats.curated} Curated Funds for Recommendations
                    </span>
                    <span className="stats-badge" style={{ background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', marginLeft: '0.5rem' }}>
                      ✨ {dataStats.totalAvailable?.toLocaleString()} Total Funds Available
                    </span>
                    {dataStats.withRealTimeNAV > 0 && (
                      <span className="stats-badge" style={{ background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)', marginLeft: '0.5rem' }}>
                        🔄 {dataStats.withRealTimeNAV} with Real-time NAV
                      </span>
                    )}
                    <span className="stats-detail">
                      {Object.entries(dataStats.categories).map(([cat, count]) => 
                        `${count} ${cat.replace('_', ' ')}`
                      ).join(' • ')}
                    </span>
                  </div>
                )}

                <div className="input-grid">
                  <div className="input-group">
                    <label className="input-label">Investment Amount</label>
                    <div className="input-wrapper">
                      <span className="input-prefix">₹</span>
                      <input 
                        type="number" 
                        className="input-field" 
                        value={amount} 
                        onChange={(e)=>handleAmountChange(e.target.value)}
                        placeholder="100000"
                        min="1000"
                        max="100000000"
                      />
                    </div>
                    <span className="input-hint">{formatCurrency(amount)}</span>
                  </div>

                  <div className="input-group">
                    <label className="input-label">Investment Duration</label>
                    <div className="input-wrapper">
                      <input 
                        type="number" 
                        className="input-field" 
                        value={duration} 
                        onChange={(e)=>handleDurationChange(e.target.value)}
                        min="1"
                        max="30"
                      />
                      <span className="input-suffix">years</span>
                    </div>
                    <span className="input-hint">
                      {duration >= 10 ? '🎯 Excellent for long-term wealth' : 
                       duration >= 5 ? '👍 Good for wealth building' : 
                       '💡 Consider longer duration for better returns'}
                    </span>
                  </div>

                  <div className="input-group">
                    <label className="input-label">Risk Appetite</label>
                    <div className="risk-selector">
                      {['low', 'medium', 'high'].map(r => (
                        <button
                          key={r}
                          type="button"
                          className={risk === r ? 'risk-btn active' : 'risk-btn'}
                          onClick={()=>handleRiskChange(r)}
                          style={{ borderColor: risk === r ? getRiskColor(r) : '#e5e7eb' }}
                        >
                          <span className="risk-dot" style={{ backgroundColor: getRiskColor(r) }}></span>
                          {r.charAt(0).toUpperCase() + r.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="button-group">
                  <button className="btn-primary" onClick={generate} disabled={loading}>
                    {loading ? 'Analyzing…' : inputChanged && recs ? 'Update Recommendations' : 'Get Recommendations'}
                  </button>
                  {(recs || inputChanged) && (
                    <button className="btn-reset" onClick={resetChoices} disabled={loading}>
                      Reset
                    </button>
                  )}
                </div>
              </div>
            </section>

            {/* Input Changed Notice */}
            {inputChanged && recs && (
              <div className="input-changed-notice">
                <span className="notice-icon">⚠️</span>
                <span className="notice-text">
                  Your inputs have changed. Click "Update Recommendations" to see new results.
                </span>
              </div>
            )}

            {/* Results Section */}
            {recs && recs.bucketOptions && (
              <section className="results-section">
                {/* Bucket Options Tabs */}
                <div className="bucket-options-header">
                  <h2 className="options-title">Choose Your Investment Strategy</h2>
                  <p className="options-subtitle">{recs.totalOptions} portfolio options tailored for you</p>
                </div>

                <div className="bucket-tabs">
                  {recs.bucketOptions.map((option, idx) => (
                    <button
                      key={idx}
                      className={selectedBucket === idx ? 'bucket-tab active' : 'bucket-tab'}
                      onClick={() => setSelectedBucket(idx)}
                    >
                      <span className="tab-icon">{option.strategy.icon}</span>
                      <div className="tab-content">
                        <span className="tab-label">{option.label}</span>
                        <span className="tab-return">{option.summary.annualizedReturn.toFixed(1)}% p.a.</span>
                      </div>
                      {option.isRecommended && <span className="recommended-badge">Recommended</span>}
                    </button>
                  ))}
                </div>

                {/* Current Selected Bucket */}
                {recs.bucketOptions[selectedBucket] && (() => {
                  const currentBucket = recs.bucketOptions[selectedBucket];
                  return (
                    <>
                      {/* Strategy Header */}
                      <div className="strategy-header">
                        <div className="strategy-icon">{currentBucket.strategy.icon}</div>
                        <div className="strategy-info">
                          <div className="strategy-title-row">
                            <h2 className="strategy-title">{currentBucket.strategy.name}</h2>
                            <span className="strategy-tag">{currentBucket.strategy.tag}</span>
                          </div>
                          <p className="strategy-description">{currentBucket.strategy.description}</p>
                        </div>
                      </div>

                      {/* Summary Card */}
                      <div className="summary-card">
                        <div className="summary-grid">
                          <div className="summary-item">
                            <span className="summary-label">Total Investment</span>
                            <span className="summary-value">{formatCurrency(currentBucket.summary.totalInvestment)}</span>
                          </div>
                          <div className="summary-item highlight">
                            <span className="summary-label">Projected Value</span>
                            <span className="summary-value large">{formatCurrency(currentBucket.summary.totalProjectedValue)}</span>
                            <span className="summary-sublabel">After {duration} years</span>
                          </div>
                          <div className="summary-item positive">
                            <span className="summary-label">Expected Gain</span>
                            <span className="summary-value">{formatCurrency(currentBucket.summary.totalGain)}</span>
                            <span className="summary-sublabel">+{(currentBucket.summary.annualizedReturn).toFixed(2)}% p.a.</span>
                          </div>
                        </div>
                      </div>

                      {/* Diversification Info */}
                      <div className="diversification-info">
                        <span className="div-badge">{currentBucket.diversification.fundCount} Funds</span>
                        <span className="div-badge">{currentBucket.diversification.categoryCount} Categories</span>
                        <span className="div-badge">Diversified</span>
                      </div>

                      {/* Benchmark Comparison */}
                      {currentBucket.benchmarkComparison && (
                        <BenchmarkComparison
                          benchmarkData={currentBucket}
                          chartData={currentBucket.chartData}
                          formatCurrency={formatCurrency}
                        />
                      )}

                      {/* Attribution (BHB + Alpha + IR) */}
                      {currentBucket.attribution && (
                        <AttributionPanel attribution={currentBucket.attribution} />
                      )}

                      {/* Bucket Funds */}
                      <div className="bucket-section">
                        <h3 className="bucket-title">Your Investment Bucket</h3>
                        <div className="bucket-grid">
                          {currentBucket.bucket.map((fund, idx) => (
                      <div key={idx} className="bucket-card">
                        <div className="bucket-header">
                          <div className="bucket-percentage">{fund.percentage.toFixed(1)}%</div>
                          <span className="bucket-category-badge">{fund.category.replace('_', ' ')}</span>
                        </div>
                        
                        <h4 className="bucket-fund-name">{fund.name}</h4>
                        <p className="bucket-symbol">{fund.symbol}</p>
                        
                        <div className="bucket-stats">
                          <div className="bucket-stat">
                            <span className="bucket-stat-label">Allocation</span>
                            <span className="bucket-stat-value">{formatCurrency(fund.allocation)}</span>
                          </div>
                          
                          <div className="bucket-stat">
                            <span className="bucket-stat-label">Expected Return</span>
                            <span className="bucket-stat-value positive">
                              {(fund.expectedReturn * 100).toFixed(2)}% p.a.
                            </span>
                          </div>
                          
                          <div className="bucket-stat">
                            <span className="bucket-stat-label">Projected Value</span>
                            <span className="bucket-stat-value">{formatCurrency(fund.projectedValue)}</span>
                          </div>
                          
                          <div className="bucket-stat">
                            <span className="bucket-stat-label">Expected Gain</span>
                            <span className="bucket-stat-value gain">
                              +{formatCurrency(fund.projectedGain)}
                            </span>
                          </div>
                        </div>

                        <div className="bucket-risk">
                          <span className="risk-badge-small" style={{ backgroundColor: getRiskColor(fund.riskCategory) }}>
                            {fund.riskCategory} risk
                          </span>
                        </div>

                        {/* Advanced Metrics Toggle */}
                        <details className="fund-details">
                          <summary className="fund-details-toggle">View Metrics &amp; SHAP Explanation</summary>
                          <div className="fund-metrics-grid">
                            <div className="metric-item">
                              <span className="metric-name">Final Score</span>
                              <span className="metric-value highlight">{fund.finalScore?.toFixed(1)}/100</span>
                            </div>
                            <div className="metric-item">
                              <span className="metric-name">Sharpe Ratio</span>
                              <span className="metric-value">{fund.metrics?.sharpeRatio?.toFixed(2)}</span>
                            </div>
                            <div className="metric-item">
                              <span className="metric-name">Sortino Ratio</span>
                              <span className="metric-value">{fund.metrics?.sortinoRatio?.toFixed(2)}</span>
                            </div>
                            <div className="metric-item">
                              <span className="metric-name">Treynor Ratio</span>
                              <span className="metric-value">{fund.metrics?.treynorRatio?.toFixed(2)}</span>
                            </div>
                            <div className="metric-item">
                              <span className="metric-name">Alpha</span>
                              <span className="metric-value">{(fund.metrics?.alpha * 100)?.toFixed(2)}%</span>
                            </div>
                            <div className="metric-item">
                              <span className="metric-name">Beta</span>
                              <span className="metric-value">{fund.metrics?.beta?.toFixed(2)}</span>
                            </div>
                            <div className="metric-item">
                              <span className="metric-name">Info Ratio</span>
                              <span className="metric-value">{fund.metrics?.informationRatio?.toFixed(2)}</span>
                            </div>
                            <div className="metric-item">
                              <span className="metric-name">Volatility (SD)</span>
                              <span className="metric-value">{(fund.metrics?.standardDeviation * 100)?.toFixed(2)}%</span>
                            </div>
                            <div className="metric-item">
                              <span className="metric-name">Expense Ratio</span>
                              <span className="metric-value">{(fund.metrics?.expenseRatio * 100)?.toFixed(2)}%</span>
                            </div>
                            <div className="metric-item">
                              <span className="metric-name">Turnover</span>
                              <span className="metric-value">{(fund.metrics?.turnoverRatio * 100)?.toFixed(0)}%</span>
                            </div>
                          </div>
                          
                          {/* Score Breakdown */}
                          <div className="score-breakdown">
                            <h5 className="breakdown-title">Score Breakdown</h5>
                            <div className="breakdown-bars">
                              <div className="breakdown-item">
                                <span className="breakdown-label">Risk-Adjusted (45%)</span>
                                <div className="breakdown-bar">
                                  <div className="breakdown-fill" style={{ width: `${(fund.scoreBreakdown?.riskAdjustedScore || 0) * 100}%` }}></div>
                                </div>
                                <span className="breakdown-value">{((fund.scoreBreakdown?.riskAdjustedScore || 0) * 100).toFixed(1)}</span>
                              </div>
                              <div className="breakdown-item">
                                <span className="breakdown-label">Stability (25%)</span>
                                <div className="breakdown-bar">
                                  <div className="breakdown-fill" style={{ width: `${(fund.scoreBreakdown?.stabilityScore || 0) * 100}%` }}></div>
                                </div>
                                <span className="breakdown-value">{((fund.scoreBreakdown?.stabilityScore || 0) * 100).toFixed(1)}</span>
                              </div>
                              <div className="breakdown-item">
                                <span className="breakdown-label">Manager Skill (20%)</span>
                                <div className="breakdown-bar">
                                  <div className="breakdown-fill" style={{ width: `${(fund.scoreBreakdown?.managerSkillScore || 0) * 100}%` }}></div>
                                </div>
                                <span className="breakdown-value">{((fund.scoreBreakdown?.managerSkillScore || 0) * 100).toFixed(1)}</span>
                              </div>
                              <div className="breakdown-item">
                                <span className="breakdown-label">Cost Efficiency (10%)</span>
                                <div className="breakdown-bar">
                                  <div className="breakdown-fill" style={{ width: `${(fund.scoreBreakdown?.costEfficiencyScore || 0) * 100}%` }}></div>
                                </div>
                                <span className="breakdown-value">{((fund.scoreBreakdown?.costEfficiencyScore || 0) * 100).toFixed(1)}</span>
                              </div>
                            </div>
                          </div>

                          {/* SHAP per-fund explanation */}
                          <ShapPanel explanation={fund.explanation} />
                        </details>
                      </div>
                    ))}
                  </div>
                </div>

                      {/* Action Buttons */}
                      <div className="action-buttons">
                        <button className="btn-secondary" onClick={savePortfolio}>
                          Save This Portfolio
                        </button>
                        <button className="btn-outline" onClick={()=>setRecs(null)}>
                          Try Different Options
                        </button>
                      </div>
                    </>
                  );
                })()}
              </section>
            )}

            {/* Footer Actions */}
            <section className="footer-actions">
              <div className="footer-card">
                <h3 className="footer-title">Need More Data?</h3>
                <p className="footer-text">
                  Load sample financial instruments to get diverse recommendations
                </p>
                <button 
                  className="btn-ghost" 
                  onClick={async ()=>{ 
                    try {
                      const res = await axios.get(`${API_BASE_URL}/data/mock-seed`);
                      await fetchDataStats();
                      alert(`✅ ${res.data.instrumentsSeeded} instruments loaded successfully!`);
                    } catch (err) {
                      alert('❌ Error loading data');
                    }
                  }}
                >
                  📦 Load Sample Data
                </button>
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
