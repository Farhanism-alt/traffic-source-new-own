import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useDateRange } from '@/contexts/DateRangeContext';

function FunnelBar({ step, count, maxCount, pct, isFirst }) {
  const barWidth = maxCount > 0 ? Math.max(4, Math.round((count / maxCount) * 100)) : 0;
  return (
    <div className="funnel-step">
      <div className="funnel-step-meta">
        <span className="funnel-step-path">{step}</span>
        <span className="funnel-step-count">{count.toLocaleString()} visitors</span>
        <span className={`funnel-step-pct ${isFirst ? 'first' : ''}`}>{isFirst ? '100%' : `${pct}%`}</span>
      </div>
      <div className="funnel-step-bar-track">
        <div className="funnel-step-bar-fill" style={{ width: `${barWidth}%` }} />
      </div>
    </div>
  );
}

function FunnelDropoff({ from, to }) {
  const continued = from > 0 ? Math.round((to / from) * 100) : 0;
  const dropped = 100 - continued;
  return (
    <div className="funnel-dropoff">
      <span className="funnel-dropoff-arrow">↓</span>
      <span className="funnel-dropoff-text">
        <strong>{continued}%</strong> continued · <span className="funnel-dropoff-lost">{dropped}% dropped</span>
      </span>
    </div>
  );
}

export default function FunnelsPage() {
  const router = useRouter();
  const { siteId } = router.query;
  const { getParams } = useDateRange();

  const [funnels, setFunnels] = useState([]);
  const [selected, setSelected] = useState(null);
  const [results, setResults] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);

  // Builder state
  const [building, setBuilding] = useState(false);
  const [buildName, setBuildName] = useState('');
  const [buildSteps, setBuildSteps] = useState(['', '']);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!siteId) return;
    fetch(`/api/analytics/${siteId}/funnels`)
      .then(r => r.ok ? r.json() : { funnels: [] })
      .then(d => setFunnels(d.funnels || []));
  }, [siteId]);

  const analyze = async (steps) => {
    setAnalyzing(true);
    setResults(null);
    const params = getParams();
    const res = await fetch(`/api/analytics/${siteId}/funnels?${new URLSearchParams(params)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'analyze', steps, from: params.from, to: params.to }),
    });
    const d = await res.json();
    setResults(d.results || []);
    setAnalyzing(false);
  };

  const saveFunnel = async () => {
    const steps = buildSteps.filter(s => s.trim());
    if (!buildName.trim() || steps.length < 2) return;
    setSaving(true);
    const params = getParams();
    const res = await fetch(`/api/analytics/${siteId}/funnels?${new URLSearchParams(params)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: buildName.trim(), steps }),
    });
    const d = await res.json();
    if (d.funnel) {
      const updated = [d.funnel, ...funnels];
      setFunnels(updated);
      setSelected(d.funnel);
      await analyze(steps);
      setBuilding(false);
      setBuildName('');
      setBuildSteps(['', '']);
    }
    setSaving(false);
  };

  const deleteFunnel = async (id) => {
    await fetch(`/api/analytics/${siteId}/funnels?id=${id}`, { method: 'DELETE' });
    const updated = funnels.filter(f => f.id !== id);
    setFunnels(updated);
    if (selected?.id === id) { setSelected(null); setResults(null); }
  };

  const selectFunnel = (f) => {
    setSelected(f);
    setBuilding(false);
    analyze(f.steps || JSON.parse(f.steps || '[]'));
  };

  const maxCount = results ? Math.max(...results.map(r => r.count), 1) : 1;
  const firstCount = results?.[0]?.count || 1;

  return (
    <>
      <Head><title>Funnels - SAC MAC</title></Head>
      <DashboardLayout siteId={siteId}>
        <div className="funnels-layout">
          {/* Sidebar */}
          <aside className="funnels-sidebar">
            <div className="funnels-sidebar-header">
              <span className="funnels-sidebar-title">Funnels</span>
              <button className="funnels-new-btn" onClick={() => { setBuilding(true); setSelected(null); setResults(null); }}>
                + New
              </button>
            </div>
            {funnels.length === 0 && !building && (
              <div className="funnels-empty-hint">No funnels yet.<br />Create one to track conversion paths.</div>
            )}
            {funnels.map(f => (
              <button
                key={f.id}
                className={`funnels-item${selected?.id === f.id ? ' active' : ''}`}
                onClick={() => selectFunnel(f)}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
                {f.name}
              </button>
            ))}
          </aside>

          {/* Main content */}
          <main className="funnels-main">
            {building && (
              <div className="funnel-builder">
                <h2 className="funnel-builder-title">New Funnel</h2>
                <div className="funnel-builder-field">
                  <label>Funnel name</label>
                  <input className="funnel-builder-input" value={buildName} onChange={e => setBuildName(e.target.value)} placeholder="e.g. Signup Flow" maxLength={100} />
                </div>
                <div className="funnel-builder-field">
                  <label>Steps <span style={{ fontWeight: 400, opacity: 0.6 }}>(page paths in order)</span></label>
                  {buildSteps.map((step, i) => (
                    <div key={i} className="funnel-builder-step-row">
                      <span className="funnel-step-num">{i + 1}</span>
                      <input
                        className="funnel-builder-input"
                        value={step}
                        onChange={e => { const s = [...buildSteps]; s[i] = e.target.value; setBuildSteps(s); }}
                        placeholder={i === 0 ? '/pricing' : i === 1 ? '/checkout' : '/thank-you'}
                      />
                      {buildSteps.length > 2 && (
                        <button className="funnel-step-remove" onClick={() => setBuildSteps(buildSteps.filter((_, j) => j !== i))}>×</button>
                      )}
                    </div>
                  ))}
                  {buildSteps.length < 6 && (
                    <button className="funnel-add-step" onClick={() => setBuildSteps([...buildSteps, ''])}>+ Add step</button>
                  )}
                </div>
                <div className="funnel-builder-actions">
                  <button className="btn btn-secondary btn-sm" onClick={() => { const steps = buildSteps.filter(s => s.trim()); if (steps.length >= 2) analyze(steps); }}>
                    Preview
                  </button>
                  <button className="btn btn-primary btn-sm" onClick={saveFunnel} disabled={saving || !buildName.trim() || buildSteps.filter(s => s.trim()).length < 2}>
                    {saving ? 'Saving…' : 'Save Funnel'}
                  </button>
                </div>
              </div>
            )}

            {selected && !building && (
              <div className="funnel-view-header">
                <h2 className="funnel-view-title">{selected.name}</h2>
                <button className="btn btn-secondary btn-sm" onClick={() => deleteFunnel(selected.id)} style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}>
                  Delete
                </button>
              </div>
            )}

            {analyzing && (
              <div className="loading-inline"><div className="loading-spinner" /></div>
            )}

            {!analyzing && results && results.length > 0 && (
              <div className="funnel-results">
                {results.map((r, i) => (
                  <div key={i}>
                    <FunnelBar
                      step={r.step}
                      count={r.count}
                      maxCount={maxCount}
                      pct={firstCount > 0 ? Math.round((r.count / firstCount) * 100) : 0}
                      isFirst={i === 0}
                    />
                    {i < results.length - 1 && (
                      <FunnelDropoff from={r.count} to={results[i + 1].count} />
                    )}
                  </div>
                ))}
                <div className="funnel-summary">
                  Overall conversion: <strong>{firstCount > 0 ? Math.round((results[results.length - 1].count / firstCount) * 100) : 0}%</strong>
                  <span style={{ opacity: 0.5, marginLeft: 8 }}>({results[0]?.count?.toLocaleString()} → {results[results.length - 1]?.count?.toLocaleString()})</span>
                </div>
              </div>
            )}

            {!analyzing && !results && !building && (
              <div className="funnels-placeholder">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.3"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
                <p>Select a funnel from the sidebar, or create a new one to visualize your conversion path.</p>
              </div>
            )}
          </main>
        </div>
      </DashboardLayout>
    </>
  );
}
