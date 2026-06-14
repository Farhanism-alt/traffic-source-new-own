import { useState, useEffect, useCallback } from 'react';

const PERIOD_LABELS = {
  '24h': 'Last 24 Hours',
  '7d': 'Last 7 Days',
  '30d': 'Last 30 Days',
  '90d': 'Last 90 Days',
  '12m': 'Last 12 Months',
};

function scoreColor(score) {
  if (score >= 70) return '#22c55e';
  if (score >= 40) return '#f59e0b';
  return '#ef4444';
}

function scoreLabel(score) {
  if (score >= 70) return 'Good';
  if (score >= 40) return 'Fair';
  return 'Needs Work';
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function MiniBarChart({ items, labelKey, valueKey, colorFn, formatVal }) {
  if (!items?.length) return null;
  const top = items.slice(0, 5);
  const max = Math.max(...top.map(d => Number(d[valueKey]) || 0), 1);
  if (max === 0) return null;
  return (
    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 5 }}>
      {top.map((item, i) => {
        const val = Number(item[valueKey]) || 0;
        const pct = Math.max((val / max) * 100, val > 0 ? 2 : 0);
        const color = colorFn ? colorFn(item) : '#7c3aed';
        const displayVal = formatVal
          ? formatVal(val, item)
          : val >= 1000 ? `${(val / 1000).toFixed(1)}k` : String(val);
        const label = String(item[labelKey] || '—').slice(0, 16);
        return (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '76px 1fr 52px', alignItems: 'center', gap: 6 }}>
            <div style={{ fontSize: 10, color: '#888', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={String(item[labelKey] || '')}>
              {label}
            </div>
            <div style={{ height: 5, background: 'rgba(255,255,255,0.07)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3 }} />
            </div>
            <div style={{ fontSize: 10, color: '#777', textAlign: 'right', whiteSpace: 'nowrap' }}>{displayVal}</div>
          </div>
        );
      })}
    </div>
  );
}

function Sparkline({ data, valueKey }) {
  if (!data?.length) return null;
  const vals = data.map(d => Number(d[valueKey]) || 0);
  if (!vals.some(v => v > 0)) return null;
  const max = Math.max(...vals, 1);
  const min = Math.min(...vals, 0);
  const range = max - min || 1;
  const W = 300, H = 44, pad = 3;

  const pts = vals.map((v, i) => {
    const x = (i / Math.max(vals.length - 1, 1)) * (W - pad * 2) + pad;
    const y = H - pad - ((v - min) / range) * (H - pad * 2 - 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const area = `${pad},${H} ${pts} ${W - pad},${H}`;

  return (
    <div style={{ marginTop: 10 }}>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block' }}>
        <defs>
          <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#7c3aed" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <polygon points={area} fill="url(#sg)" />
        <polyline points={pts} fill="none" stroke="#7c3aed" strokeWidth="1.5" />
      </svg>
      {data[0]?.date && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2, fontSize: 9, color: '#555' }}>
          <span>{String(data[0].date).slice(5)}</span>
          <span>{String(data[data.length - 1].date).slice(5)}</span>
        </div>
      )}
    </div>
  );
}

function InsightChart({ id, chartData }) {
  if (!chartData) return null;
  const bounceColor = (br) => {
    const n = Number(br) || 50;
    return n < 40 ? '#22c55e' : n < 65 ? '#f59e0b' : '#ef4444';
  };
  switch (id) {
    case 'traffic_quality':
      return (
        <MiniBarChart
          items={chartData.sources}
          labelKey="source"
          valueKey="sessions"
          colorFn={(d) => bounceColor(d.bounce_rate)}
          formatVal={(val, d) => `${val} · ${d.bounce_rate || '?'}%`}
        />
      );
    case 'conversion_leak':
      return (
        <MiniBarChart
          items={chartData.sources}
          labelKey="source"
          valueKey="sessions"
          colorFn={() => '#6366f1'}
        />
      );
    case 'untapped_geo':
      return (
        <MiniBarChart
          items={chartData.countries}
          labelKey="country"
          valueKey="sessions"
          colorFn={() => '#0ea5e9'}
        />
      );
    case 'revenue_attribution':
      if (!chartData.revenue_by_source?.length) return null;
      return (
        <MiniBarChart
          items={chartData.revenue_by_source}
          labelKey="source"
          valueKey="revenue"
          colorFn={() => '#22c55e'}
          formatVal={(val) => `$${(Number(val) / 100).toFixed(0)}`}
        />
      );
    case 'trend_anomaly':
      return <Sparkline data={chartData.time_series} valueKey="visitors" />;
    case 'page_impact':
      return (
        <MiniBarChart
          items={chartData.pages}
          labelKey="page"
          valueKey="views"
          colorFn={() => '#f59e0b'}
        />
      );
    default:
      return null;
  }
}

export default function InsightsPanel({ siteId, period, customRange, open, onClose }) {
  const [view, setView] = useState('generate');
  const [loading, setLoading] = useState(false);
  const [insights, setInsights] = useState(null);
  const [recentList, setRecentList] = useState([]);
  const [expandedTips, setExpandedTips] = useState(new Set());
  const [expandedPrompts, setExpandedPrompts] = useState(new Set());
  const [copiedPrompt, setCopiedPrompt] = useState(null);
  const [error, setError] = useState(null);

  const loadRecent = useCallback(async () => {
    if (!siteId) return;
    try {
      const res = await fetch(`/api/analytics/${siteId}/insights/recent`);
      if (res.ok) {
        const data = await res.json();
        setRecentList(data.insights || []);
      }
    } catch {
      // silent
    }
  }, [siteId]);

  useEffect(() => {
    if (open) {
      loadRecent();
      setView('generate');
      setInsights(null);
      setError(null);
      setExpandedTips(new Set());
      setExpandedPrompts(new Set());
    }
  }, [open, loadRecent]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const generate = async () => {
    if (!siteId || loading) return;
    setLoading(true);
    setError(null);
    try {
      const body = { period };
      if (customRange?.from && customRange?.to) body.customRange = customRange;
      const res = await fetch(`/api/analytics/${siteId}/insights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `Error ${res.status}`);
      } else {
        setInsights(data);
        loadRecent();
      }
    } catch (e) {
      setError(e.message || 'Network error');
    }
    setLoading(false);
  };

  const toggleTips = (id) => {
    setExpandedTips(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const togglePrompt = (key) => {
    setExpandedPrompts(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const copyPrompt = async (key, text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedPrompt(key);
      setTimeout(() => setCopiedPrompt(null), 2000);
    } catch {
      // fallback
    }
  };

  const viewRecent = (item) => {
    setInsights(item.insights);
    setView('generate');
    setExpandedTips(new Set());
    setExpandedPrompts(new Set());
  };

  if (!open) return null;

  const periodLabel = (customRange?.from && customRange?.to)
    ? `${customRange.from} – ${customRange.to}`
    : (PERIOD_LABELS[period] || period);

  const tabBtnStyle = (active) => ({
    background: active ? 'rgba(139,92,246,0.15)' : 'none',
    border: active ? '1px solid rgba(139,92,246,0.4)' : '1px solid var(--border, #2a2a2a)',
    borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 500,
    color: active ? '#a78bfa' : 'var(--text-muted, #888)', cursor: 'pointer',
  });

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000 }} onClick={onClose} />
      <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: '600px', maxWidth: '100vw', background: 'var(--bg-card, #1a1a1a)', borderLeft: '1px solid var(--border, #2a2a2a)', zIndex: 1001, display: 'flex', flexDirection: 'column', overflowY: 'auto', boxShadow: '-4px 0 24px rgba(0,0,0,0.4)' }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 16px', borderBottom: '1px solid var(--border, #2a2a2a)', position: 'sticky', top: 0, background: 'var(--bg-card, #1a1a1a)', zIndex: 10 }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text, #fff)' }}>AI Insights ✨</span>
          <div style={{ display: 'flex', gap: 6, marginLeft: 8 }}>
            <button style={tabBtnStyle(view === 'generate')} onClick={() => setView('generate')}>Generate</button>
            <button style={tabBtnStyle(view === 'recent')} onClick={() => { setView('recent'); loadRecent(); }}>Recent</button>
          </div>
          <button style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-muted, #888)', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '0 4px' }} onClick={onClose} aria-label="Close">×</button>
        </div>

        <div style={{ padding: 16, flex: 1 }}>
          <div style={{ marginBottom: 16 }}>
            <span style={{ fontSize: 11, background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.25)', borderRadius: 4, padding: '2px 8px', color: '#a78bfa', fontWeight: 500 }}>
              {periodLabel}
            </span>
          </div>

          {view === 'generate' && (
            <>
              {!insights && !loading && (
                <div style={{ textAlign: 'center', padding: '48px 0' }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>🤖</div>
                  <div style={{ fontSize: 14, color: 'var(--text-muted, #888)', marginBottom: 20 }}>Analyze your analytics with AI to get actionable insights.</div>
                  <button onClick={generate} style={{ background: 'linear-gradient(135deg,#7c3aed,#4f46e5)', border: 'none', borderRadius: 8, padding: '10px 24px', fontSize: 14, fontWeight: 600, color: '#fff', cursor: 'pointer' }}>
                    Analyze with AI
                  </button>
                  {error && <div style={{ marginTop: 12, fontSize: 12, color: '#ef4444' }}>{error}</div>}
                </div>
              )}

              {loading && (
                <div style={{ textAlign: 'center', padding: '48px 0' }}>
                  <div style={{ width: 32, height: 32, border: '3px solid var(--border,#2a2a2a)', borderTopColor: '#7c3aed', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 16px' }} />
                  <div style={{ fontSize: 13, color: 'var(--text-muted, #888)' }}>Analyzing your data…</div>
                </div>
              )}

              {insights && !loading && (
                <>
                  <div style={{ background: 'var(--bg, #111)', border: '1px solid var(--border, #2a2a2a)', borderRadius: 10, padding: '14px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 14 }}>
                    <div style={{ textAlign: 'center', minWidth: 56 }}>
                      <div style={{ fontSize: 28, fontWeight: 800, color: scoreColor(insights.overall_health || 0) }}>{insights.overall_health || 0}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted, #888)', marginTop: 2 }}>/ 100</div>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted, #888)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Overall Health</div>
                      <div style={{ fontSize: 13, color: 'var(--text, #fff)', lineHeight: 1.5 }}>{insights.period_summary}</div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
                    <button onClick={generate} disabled={loading} style={{ background: 'none', border: '1px solid rgba(139,92,246,0.4)', borderRadius: 6, padding: '4px 12px', fontSize: 12, fontWeight: 500, color: '#a78bfa', cursor: 'pointer', opacity: loading ? 0.6 : 1 }}>
                      ↺ Re-analyze
                    </button>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {(insights.insights || []).map((insight) => {
                      const color = scoreColor(insight.score || 0);
                      const label = insight.score_label || scoreLabel(insight.score || 0);
                      const tipsOpen = expandedTips.has(insight.id);
                      return (
                        <div key={insight.id} style={{ background: 'var(--bg, #111)', border: '1px solid var(--border, #2a2a2a)', borderRadius: 10, overflow: 'hidden' }}>
                          <div style={{ padding: '12px 14px 12px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                              <span style={{ fontSize: 18 }}>{insight.emoji}</span>
                              <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text, #fff)', flex: 1 }}>{insight.title}</span>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <div style={{ width: 60, height: 5, background: 'var(--border, #2a2a2a)', borderRadius: 3, overflow: 'hidden' }}>
                                  <div style={{ width: `${insight.score || 0}%`, height: '100%', background: color, borderRadius: 3 }} />
                                </div>
                                <span style={{ fontSize: 11, fontWeight: 600, color }}>{label}</span>
                              </div>
                            </div>

                            <p style={{ fontSize: 13, color: 'var(--text-muted, #aaa)', margin: 0, lineHeight: 1.5 }}>{insight.summary}</p>

                            <InsightChart id={insight.id} chartData={insights.chart_data} />

                            <ul style={{ margin: '10px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
                              {(insight.bullets || []).map((b, i) => (
                                <li key={i} style={{ fontSize: 12, color: 'var(--text, #ddd)', display: 'flex', gap: 6 }}>
                                  <span style={{ color, flexShrink: 0 }}>•</span>
                                  <span>{b}</span>
                                </li>
                              ))}
                            </ul>
                          </div>

                          <button
                            onClick={() => toggleTips(insight.id)}
                            style={{ width: '100%', background: 'none', border: 'none', borderTop: '1px solid var(--border, #2a2a2a)', padding: '8px 14px', fontSize: 12, fontWeight: 500, color: 'var(--text-muted, #888)', cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 4 }}
                          >
                            <span style={{ transform: tipsOpen ? 'rotate(180deg)' : 'none', display: 'inline-block', transition: 'transform 0.2s' }}>▾</span>
                            Tips ({(insight.tips || []).length})
                          </button>

                          {tipsOpen && (
                            <div style={{ borderTop: '1px solid var(--border, #2a2a2a)', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                              {(insight.tips || []).map((tip, ti) => {
                                const promptKey = `${insight.id}-${ti}`;
                                const promptOpen = expandedPrompts.has(promptKey);
                                const copied = copiedPrompt === promptKey;
                                return (
                                  <div key={ti} style={{ background: 'rgba(139,92,246,0.05)', border: '1px solid rgba(139,92,246,0.15)', borderRadius: 8, padding: '10px 12px' }}>
                                    <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--text, #ddd)', lineHeight: 1.5 }}>{tip.tip}</p>
                                    <button onClick={() => togglePrompt(promptKey)} style={{ background: 'none', border: 'none', padding: 0, fontSize: 11, fontWeight: 500, color: '#a78bfa', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                                      <span style={{ transform: promptOpen ? 'rotate(180deg)' : 'none', display: 'inline-block', transition: 'transform 0.2s' }}>▾</span>
                                      Copy AI Prompt
                                    </button>
                                    {promptOpen && (
                                      <div style={{ marginTop: 8 }}>
                                        <div style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border, #2a2a2a)', borderRadius: 6, padding: '10px 12px', fontSize: 11, color: '#ccc', fontFamily: 'monospace', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 200, overflowY: 'auto', marginBottom: 6 }}>
                                          {tip.ai_prompt}
                                        </div>
                                        <button onClick={() => copyPrompt(promptKey, tip.ai_prompt)} style={{ background: copied ? 'rgba(34,197,94,0.15)' : 'rgba(139,92,246,0.15)', border: `1px solid ${copied ? 'rgba(34,197,94,0.4)' : 'rgba(139,92,246,0.4)'}`, borderRadius: 5, padding: '4px 10px', fontSize: 11, fontWeight: 500, color: copied ? '#22c55e' : '#a78bfa', cursor: 'pointer' }}>
                                          {copied ? '✓ Copied!' : '⎘ Copy prompt'}
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          )}

          {view === 'recent' && (
            <>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text, #fff)', marginBottom: 12 }}>Recent Analyses</div>
              {recentList.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--text-muted, #888)', textAlign: 'center', padding: '32px 0' }}>No analyses yet. Generate your first one!</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {recentList.map((item) => (
                    <button key={item.id} onClick={() => viewRecent(item)} style={{ background: 'var(--bg, #111)', border: '1px solid var(--border, #2a2a2a)', borderRadius: 8, padding: '12px 14px', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text, #fff)', marginBottom: 3 }}>{formatDate(item.created_at)}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 11, background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.25)', borderRadius: 4, padding: '1px 6px', color: '#a78bfa', fontWeight: 500 }}>
                            {PERIOD_LABELS[item.period] || item.period}
                          </span>
                          {item.insights?.overall_health != null && (
                            <span style={{ fontSize: 11, color: scoreColor(item.insights.overall_health), fontWeight: 600 }}>
                              Health: {item.insights.overall_health}/100
                            </span>
                          )}
                        </div>
                      </div>
                      <span style={{ fontSize: 16, color: 'var(--text-muted, #888)' }}>›</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
