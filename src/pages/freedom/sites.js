import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { AreaChart, Area, ResponsiveContainer, YAxis } from 'recharts';
import DashboardLayout from '@/components/layout/DashboardLayout';

export default function FreedomSites() {
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();

  const fetchSites = useCallback(async () => {
    try {
      const res = await fetch('/api/sites');
      if (res.ok) {
        const data = await res.json();
        setSites(data.sites);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSites(); }, [fetchSites]);

  const handleCreate = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const res = await fetch('/api/sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, domain }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setShowModal(false);
      setName('');
      setDomain('');
      fetchSites();
      router.push(`/analytics/${data.site.id}/settings`);
    } catch (err) {
      setError(err.message);
    }
  };

  const exitFreedom = async () => {
    await fetch('/api/freedom/exit', { method: 'POST' });
    router.replace('/');
  };

  return (
    <>
      <Head><title>Private Sites</title></Head>
      <DashboardLayout>
        {/* Private mode banner */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)',
          borderRadius: 8, padding: '8px 14px', marginBottom: 20, fontSize: 13,
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <span style={{ color: '#6366f1', fontWeight: 600 }}>Private Mode</span>
          <span style={{ color: 'var(--text-muted)', marginLeft: 2 }}>— these sites are only visible to you</span>
          <button
            onClick={exitFreedom}
            style={{
              marginLeft: 'auto', background: 'none', border: '1px solid rgba(99,102,241,0.35)',
              borderRadius: 5, color: '#6366f1', cursor: 'pointer', fontSize: 12,
              padding: '3px 10px',
            }}
          >
            Exit
          </button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 className="page-title" style={{ marginBottom: 0 }}>Private Sites</h2>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>Add Site</button>
        </div>

        {loading ? (
          <div className="loading-inline"><div className="loading-spinner" /></div>
        ) : sites.length === 0 ? (
          <div className="empty-state">
            <h3>No private sites yet</h3>
            <p>Add your first private site — it won’t appear to anyone else.</p>
            <button className="btn btn-primary" onClick={() => setShowModal(true)}>Add Site</button>
          </div>
        ) : (
          <div className="sites-list">
            {sites.map((site) => {
              const hourlyMap = {};
              for (const h of (site.hourly || [])) hourlyMap[h.hour] = h;
              const now = new Date();
              const padded = [];
              for (let i = 23; i >= 0; i--) {
                const d = new Date(now.getTime() - i * 3600000);
                const key = d.toISOString().slice(0, 13).replace('T', ' ') + ':00';
                padded.push(hourlyMap[key] || { hour: key, pageviews: 0, visitors: 0 });
              }
              const totalVisitors = padded.reduce((s, h) => s + h.visitors, 0);
              const totalPageviews = padded.reduce((s, h) => s + h.pageviews, 0);
              const fmt = (n) => n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
              return (
                <div key={site.id} className="site-card" onClick={() => router.push(`/analytics/${site.id}`)}>
                  <div className="site-card-header">
                    <img
                      className="site-card-favicon"
                      src={`https://www.google.com/s2/favicons?domain=${site.domain}&sz=64`}
                      alt="" width={24} height={24}
                      onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
                    />
                    <div className="site-card-info">
                      <div className="site-card-name">{site.name}</div>
                      <div className="site-card-domain">{site.domain}</div>
                    </div>
                    <button
                      className="site-card-menu"
                      onClick={(e) => { e.stopPropagation(); router.push(`/analytics/${site.id}/settings`); }}
                      aria-label="Site settings"
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <circle cx="8" cy="3" r="1.5" />
                        <circle cx="8" cy="8" r="1.5" />
                        <circle cx="8" cy="13" r="1.5" />
                      </svg>
                    </button>
                  </div>
                  <div className="site-card-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={padded} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                        <YAxis domain={[0, 'dataMax']} hide />
                        <Area type="monotone" dataKey="visitors" stroke="#6366f1" fill="#6366f1" fillOpacity={0.08} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="site-card-footer">
                    <div className="site-card-stat">
                      <div className="site-card-stat-value">{fmt(totalVisitors)}</div>
                      <div className="site-card-stat-label">Visitors</div>
                    </div>
                    <div className="site-card-stat">
                      <div className="site-card-stat-value">{fmt(totalPageviews)}</div>
                      <div className="site-card-stat-label">Pageviews</div>
                    </div>
                    <div className="site-card-period">24h</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {showModal && (
          <div className="modal-overlay" onClick={() => setShowModal(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>Add Private Site</h2>
                <button onClick={() => setShowModal(false)}>×</button>
              </div>
              <form onSubmit={handleCreate}>
                <div className="modal-body">
                  {error && <div className="auth-error">{error}</div>}
                  <div className="form-group">
                    <label>Site Name</label>
                    <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="My Website" required />
                  </div>
                  <div className="form-group">
                    <label>Domain</label>
                    <input type="text" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" required />
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary">Add Site</button>
                </div>
              </form>
            </div>
          </div>
        )}
      </DashboardLayout>
    </>
  );
}
