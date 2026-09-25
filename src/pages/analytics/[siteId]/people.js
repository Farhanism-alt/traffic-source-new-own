import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import DashboardLayout from '@/components/layout/DashboardLayout';
import VisitorAvatar from '@/components/ui/VisitorAvatar';
import CountryFlag from '@/components/ui/CountryFlag';
import ChannelIcon from '@/components/ui/ChannelIcon';
import PersonFootprintDrawer from '@/components/ui/PersonFootprintDrawer';
import { getCountryName } from '@/lib/formatters';

function formatRelativeTime(isoStr) {
  if (!isoStr) return '—';
  const diff = (Date.now() - new Date(isoStr).getTime()) / 1000;
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(isoStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function People() {
  const router = useRouter();
  const { siteId } = router.query;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [modalTab, setModalTab] = useState('connect');
  const [copiedSnippet, setCopiedSnippet] = useState(false);
  const [connectedSites, setConnectedSites] = useState([]);
  const [availableSites, setAvailableSites] = useState([]);
  const [selectedTargetSite, setSelectedTargetSite] = useState('');
  const [connectingSite, setConnectingSite] = useState(false);
  const [exportPeriod, setExportPeriod] = useState('all');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  const handleMasterExport = async () => {
    if (!siteId || exporting) return;
    setExporting(true);
    setExportError('');
    try {
      const res = await fetch(`/api/analytics/${siteId}/export?period=${exportPeriod}`);
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const match = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = match ? match[1] : 'master-export.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setExportError('Export failed. Try a shorter date range.');
    } finally {
      setExporting(false);
    }
  };

  const fetchConnections = useCallback(async () => {
    if (!siteId) return;
    try {
      const res = await fetch(`/api/sites/${siteId}/connect`);
      if (res.ok) {
        const d = await res.json();
        setConnectedSites(d.connectedSites || []);
        setAvailableSites(d.availableSites || []);
      }
    } catch {}
  }, [siteId]);

  useEffect(() => {
    if (showSetupModal) {
      fetchConnections();
    }
  }, [showSetupModal, fetchConnections]);

  const handleConnectSite = async () => {
    if (!selectedTargetSite) return;
    setConnectingSite(true);
    try {
      const res = await fetch(`/api/sites/${siteId}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetSiteId: selectedTargetSite }),
      });
      if (res.ok) {
        setSelectedTargetSite('');
        fetchConnections();
        fetchData();
      }
    } finally {
      setConnectingSite(false);
    }
  };

  const handleDisconnectSite = async (targetId) => {
    try {
      const res = await fetch(`/api/sites/${siteId}/connect`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetSiteId: targetId }),
      });
      if (res.ok) {
        fetchConnections();
        fetchData();
      }
    } catch {}
  };

  const fetchData = useCallback(async () => {
    if (!siteId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: '25',
        ...(search ? { search } : {}),
      });
      const res = await fetch(`/api/analytics/${siteId}/people?${params}`);
      if (res.ok) {
        setData(await res.json());
      }
    } finally {
      setLoading(false);
    }
  }, [siteId, page, search]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const [copiedSql, setCopiedSql] = useState(false);

  const site = data?.site;
  const people = data?.people || [];
  const pagination = data?.pagination;

  const webhookBaseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://traffic-source-new-own.vercel.app';

  const supabaseSnippet = `// In your App (e.g. app.example.com):
import { supabase } from './supabaseClient';

supabase.auth.onAuthStateChange((event, session) => {
  if (session?.user?.email && window.__ts) {
    // 1. Links Gmail to original FB ad & website footprint
    window.__ts.identify(session.user.email);
    
    // 2. Track login/signup event
    if (event === 'SIGNED_IN') {
      window.__ts.track('User Login', { provider: session.user.app_metadata?.provider || 'google' });
    }
  }
});`;

  const supabaseSqlSnippet = `-- 1. Enable pg_net for HTTP webhooks (built-in on Supabase)
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- 2. Create webhook function for ${site?.name || 'this site'} (Site ID: ${siteId || '1'})
CREATE OR REPLACE FUNCTION public.traffic_source_auth_webhook()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM net.http_post(
    url := '${webhookBaseUrl}/api/v1/identify',
    body := json_build_object(
      'site_id', '${siteId || '1'}',
      'email', NEW.email,
      'user_id', NEW.id
    )::text,
    headers := json_build_object('Content-Type', 'application/json')::jsonb
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Trigger automatically on every new user signup
DROP TRIGGER IF EXISTS on_auth_user_created_traffic_source ON auth.users;
CREATE TRIGGER on_auth_user_created_traffic_source
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.traffic_source_auth_webhook();`;

  const copySnippet = () => {
    navigator.clipboard.writeText(supabaseSnippet);
    setCopiedSnippet(true);
    setTimeout(() => setCopiedSnippet(false), 2000);
  };

  const copySql = () => {
    navigator.clipboard.writeText(supabaseSqlSnippet);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2000);
  };

  return (
    <>
      <Head>
        <title>People – {site?.name || site?.domain || 'SAC MAC'}</title>
      </Head>
      <DashboardLayout siteId={siteId} siteName={site?.name} siteDomain={site?.domain}>
        <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <h1 className="page-title" style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>
              People & User Footprints
            </h1>
            <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>
              Identified visitors, acquisition sources, and multi-domain journey traces across your website and app.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <select
              value={exportPeriod}
              onChange={(e) => setExportPeriod(e.target.value)}
              disabled={exporting}
              aria-label="Export date range"
              style={{ fontSize: 13, padding: '7px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text)', fontFamily: 'var(--font)' }}
            >
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
              <option value="12m">Last 12 months</option>
              <option value="all">All time</option>
            </select>
            <button
              className="btn btn-primary"
              onClick={handleMasterExport}
              disabled={exporting}
              title="Download one Excel file with summary, sources, people, payments, sessions, events and page views"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              {exporting ? 'Exporting…' : 'Master Export'}
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => setShowSetupModal(true)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              Supabase / App Setup
            </button>
          </div>
        </div>

        {exportError && (
          <div style={{ marginBottom: 12, color: 'var(--danger, #ef4444)', fontSize: 13 }}>{exportError}</div>
        )}

        {/* Search Bar */}
        <div style={{ marginBottom: 16, display: 'flex', gap: 12 }}>
          <div style={{ position: 'relative', flex: 1, maxWidth: 360 }}>
            <input
              type="text"
              placeholder="Search by Gmail or email..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="form-control"
              style={{
                width: '100%',
                paddingLeft: 34,
                height: 36,
                fontSize: 13,
                background: 'var(--bg-card, #161618)',
                borderColor: 'var(--border-color, #27272a)',
                color: 'var(--text-primary)',
              }}
            />
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ position: 'absolute', left: 11, top: 11, color: 'var(--text-muted)' }}
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>
          {search && (
            <button
              onClick={() => { setSearchInput(''); setSearch(''); }}
              className="btn btn-secondary"
              style={{ height: 36, fontSize: 12, padding: '0 12px' }}
            >
              Clear
            </button>
          )}
        </div>

        {/* Table Container */}
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
            <div className="loading-spinner" />
          </div>
        ) : people.length === 0 ? (
          <div className="empty-state" style={{ padding: '60px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>👥</div>
            <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 8px' }}>
              {search ? 'No people match your search' : 'No identified people yet'}
            </h3>
            <p style={{ color: 'var(--text-muted)', maxWidth: 460, margin: '0 auto 16px', fontSize: 13 }}>
              {search
                ? 'Try searching with a different email address or clear your search filter.'
                : 'As soon as users log in with Google OAuth via Supabase or fill an email form on your app/website, they will appear here with their complete footprint.'}
            </p>
            {!search && (
              <button className="btn btn-primary" onClick={() => setShowSetupModal(true)}>
                View 2-Line Integration Code
              </button>
            )}
          </div>
        ) : (
          <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color, #27272a)', background: 'var(--bg-card, #161618)' }}>
                    <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                      Person / Email
                    </th>
                    <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                      Acquisition Channel
                    </th>
                    <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                      Location
                    </th>
                    <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                      First Seen
                    </th>
                    <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                      Last Active
                    </th>
                    <th style={{ padding: '10px 16px', textAlign: 'center', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                      Sessions
                    </th>
                    <th style={{ padding: '10px 16px', textAlign: 'center', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                      Pages
                    </th>
                    <th style={{ padding: '10px 16px', textAlign: 'right', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                      Revenue
                    </th>
                    <th style={{ padding: '10px 16px', textAlign: 'right', fontSize: 11, color: 'var(--text-muted)' }}>
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((p) => {
                    const isConverter = Number(p.total_spent) > 0 || Number(p.total_conversions) > 0;
                    return (
                      <tr
                        key={p.id || p.email}
                        onClick={() => setSelectedEmail(p.email)}
                        style={{
                          borderBottom: '1px solid var(--border-color, #27272a)',
                          cursor: 'pointer',
                          transition: 'background 0.15s',
                        }}
                        className="table-row-hover"
                      >
                        {/* Person / Email */}
                        <td style={{ padding: '12px 16px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <VisitorAvatar visitorId={p.visitor_id || p.email} size={32} />
                            <div>
                              <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>
                                {p.email}
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                ID: {(p.visitor_id || '').slice(0, 10)}...
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Acquisition Channel */}
                        <td style={{ padding: '12px 16px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                            <ChannelIcon channel={p.acquisition_source} size={15} />
                            <span style={{ fontWeight: 500 }}>{p.acquisition_source || 'Direct'}</span>
                          </div>
                          {p.utm_campaign && (
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                              {p.utm_campaign}
                            </div>
                          )}
                        </td>

                        {/* Location */}
                        <td style={{ padding: '12px 16px', fontSize: 13 }}>
                          {p.country ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <CountryFlag code={p.country} />
                              <span>{getCountryName(p.country)}</span>
                            </div>
                          ) : (
                            <span style={{ color: 'var(--text-muted)' }}>—</span>
                          )}
                        </td>

                        {/* First Seen */}
                        <td style={{ padding: '12px 16px', fontSize: 13 }}>
                          <div>{p.first_seen ? new Date(p.first_seen).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{formatRelativeTime(p.first_seen)}</div>
                        </td>

                        {/* Last Active */}
                        <td style={{ padding: '12px 16px', fontSize: 13 }}>
                          <div>{formatRelativeTime(p.last_seen)}</div>
                        </td>

                        {/* Sessions */}
                        <td style={{ padding: '12px 16px', textAlign: 'center', fontSize: 13, fontWeight: 500 }}>
                          {p.total_sessions || 1}
                        </td>

                        {/* Pages */}
                        <td style={{ padding: '12px 16px', textAlign: 'center', fontSize: 13, fontWeight: 500 }}>
                          {p.total_page_views || 1}
                        </td>

                        {/* Revenue */}
                        <td style={{ padding: '12px 16px', textAlign: 'right', fontSize: 13 }}>
                          {isConverter ? (
                            <span style={{ color: '#22c55e', fontWeight: 600 }}>
                              ${((Number(p.total_spent) || 0) / 100).toFixed(2)}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)' }}>—</span>
                          )}
                        </td>

                        {/* Action */}
                        <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedEmail(p.email);
                            }}
                            className="btn btn-secondary"
                            style={{ padding: '4px 10px', fontSize: 12 }}
                          >
                            Footprint →
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination footer */}
            {pagination && pagination.totalPages > 1 && (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '12px 16px',
                  borderTop: '1px solid var(--border-color, #27272a)',
                  fontSize: 13,
                }}
              >
                <div style={{ color: 'var(--text-muted)' }}>
                  Showing {(pagination.page - 1) * pagination.limit + 1}–
                  {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} people
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    className="btn btn-secondary"
                    disabled={pagination.page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    style={{ padding: '4px 10px', fontSize: 12 }}
                  >
                    Previous
                  </button>
                  <button
                    className="btn btn-secondary"
                    disabled={pagination.page >= pagination.totalPages}
                    onClick={() => setPage((p) => p + 1)}
                    style={{ padding: '4px 10px', fontSize: 12 }}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Slide-over Person Footprint Drawer */}
        <PersonFootprintDrawer
          siteId={siteId}
          email={selectedEmail}
          onClose={() => setSelectedEmail(null)}
        />

        {/* Multi-Option Integration Modal */}
        {showSetupModal && (
          <div className="modal-overlay" onClick={() => setShowSetupModal(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
              <div className="modal-header">
                <h2>Connect App & Tracking</h2>
                <button onClick={() => setShowSetupModal(false)}>&times;</button>
              </div>

              {/* Tab Navigation */}
              <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--border-color, #27272a)', padding: '0 20px', background: 'var(--bg-card, #161618)' }}>
                <button
                  onClick={() => setModalTab('connect')}
                  style={{
                    background: 'none',
                    border: 'none',
                    borderBottom: modalTab === 'connect' ? '2px solid #6366f1' : '2px solid transparent',
                    color: modalTab === 'connect' ? '#fff' : 'var(--text-muted)',
                    padding: '12px 14px',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  🔗 Connect Existing Site
                </button>
                <button
                  onClick={() => setModalTab('frontend')}
                  style={{
                    background: 'none',
                    border: 'none',
                    borderBottom: modalTab === 'frontend' ? '2px solid #6366f1' : '2px solid transparent',
                    color: modalTab === 'frontend' ? '#fff' : 'var(--text-muted)',
                    padding: '12px 14px',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  ⚡ Frontend Script (1-Line)
                </button>
                <button
                  onClick={() => setModalTab('webhook')}
                  style={{
                    background: 'none',
                    border: 'none',
                    borderBottom: modalTab === 'webhook' ? '2px solid #6366f1' : '2px solid transparent',
                    color: modalTab === 'webhook' ? '#fff' : 'var(--text-muted)',
                    padding: '12px 14px',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  🔒 Stealth Webhook (Backend)
                </button>
              </div>

              <div className="modal-body" style={{ fontSize: 13, padding: 20 }}>
                {/* TAB 1: CONNECT EXISTING SITE */}
                {modalTab === 'connect' && (
                  <div>
                    <p style={{ margin: '0 0 14px', color: 'var(--text-muted)' }}>
                      Connect another project (e.g. your app subdomain <code>share.sendnow.live</code>) to this project. Both will share the exact same visitor identities and cross-domain footprints without modifying any past data.
                    </p>

                    {/* Currently Connected Sites */}
                    <div style={{ marginBottom: 18 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
                        Connected Subdomains & Projects ({connectedSites.length})
                      </div>
                      {connectedSites.length === 0 ? (
                        <div style={{ padding: 12, borderRadius: 6, background: 'var(--bg-primary, #0c0c0d)', border: '1px dashed var(--border-color, #27272a)', color: 'var(--text-muted)', textAlign: 'center' }}>
                          No connected sites yet. Select one below to link them!
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {connectedSites.map((cs) => (
                            <div key={cs.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'var(--bg-primary, #0c0c0d)', border: '1px solid var(--border-color, #27272a)', borderRadius: 6 }}>
                              <div>
                                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{cs.name}</span>
                                <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontSize: 12 }}>({cs.domain})</span>
                              </div>
                              <button
                                onClick={() => handleDisconnectSite(cs.id)}
                                className="btn btn-secondary"
                                style={{ padding: '3px 8px', fontSize: 11, color: '#f87171' }}
                              >
                                Disconnect
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Add Connection */}
                    {availableSites.length > 0 && (
                      <div style={{ padding: 14, background: 'var(--bg-primary, #0c0c0d)', border: '1px solid var(--border-color, #27272a)', borderRadius: 6 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                          Link Another Existing Project:
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <select
                            value={selectedTargetSite}
                            onChange={(e) => setSelectedTargetSite(e.target.value)}
                            style={{
                              flex: 1,
                              background: 'var(--bg-card, #161618)',
                              color: 'var(--text-primary)',
                              border: '1px solid var(--border-color, #27272a)',
                              borderRadius: 6,
                              padding: '6px 10px',
                              fontSize: 13,
                            }}
                          >
                            <option value="">Select project to connect...</option>
                            {availableSites.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name} ({s.domain})
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={handleConnectSite}
                            disabled={!selectedTargetSite || connectingSite}
                            className="btn btn-primary"
                            style={{ padding: '6px 14px', fontSize: 12, whiteSpace: 'nowrap' }}
                          >
                            {connectingSite ? 'Connecting...' : '🔗 Connect Site'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* TAB 2: FRONTEND SCRIPT (1-LINE) */}
                {modalTab === 'frontend' && (
                  <div>
                    <p style={{ margin: '0 0 14px', color: 'var(--text-muted)' }}>
                      In your app where Supabase OAuth is handled, call <code>window.__ts.identify(email)</code>. Zero database keys are used in the client.
                    </p>
                    <div style={{ position: 'relative' }}>
                      <pre
                        style={{
                          background: 'var(--bg-primary, #0c0c0d)',
                          padding: '12px',
                          borderRadius: 6,
                          border: '1px solid var(--border-color, #27272a)',
                          fontSize: 12,
                          overflowX: 'auto',
                          color: '#a5b4fc',
                        }}
                      >
                        {supabaseSnippet}
                      </pre>
                      <button
                        onClick={copySnippet}
                        className="btn btn-secondary"
                        style={{
                          position: 'absolute',
                          right: 10,
                          top: 10,
                          padding: '3px 8px',
                          fontSize: 11,
                        }}
                      >
                        {copiedSnippet ? '✓ Copied' : 'Copy Code'}
                      </button>
                    </div>
                  </div>
                )}

                {/* TAB 3: STEALTH WEBHOOK */}
                {modalTab === 'webhook' && (
                  <div>
                    <p style={{ margin: '0 0 14px', color: 'var(--text-muted)' }}>
                      <strong>100% Invisible to Frontend / DevTools:</strong> Set up an automated database webhook in your Supabase SQL Editor. It runs completely server-side inside Supabase and notifies Traffic Source whenever anyone signs up.
                    </p>

                    <div style={{ marginBottom: 16 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                          ⚡ Supabase 1-Click SQL Trigger (Project ID: <code>{siteId}</code>)
                        </span>
                        <button
                          onClick={copySql}
                          className="btn btn-primary"
                          style={{ padding: '3px 10px', fontSize: 11 }}
                        >
                          {copiedSql ? '✓ Copied SQL' : 'Copy SQL Query'}
                        </button>
                      </div>
                      <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--text-muted)' }}>
                        In Supabase Dashboard ➔ <strong>SQL Editor</strong> ➔ Click <strong>New Query</strong> ➔ Paste & click <strong>Run</strong>:
                      </p>
                      <div style={{ position: 'relative' }}>
                        <pre
                          style={{
                            background: 'var(--bg-primary, #0c0c0d)',
                            padding: '12px',
                            borderRadius: 6,
                            border: '1px solid var(--border-color, #27272a)',
                            fontSize: 12,
                            overflowX: 'auto',
                            color: '#6ee7b7',
                            maxHeight: 220,
                          }}
                        >
                          {supabaseSqlSnippet}
                        </pre>
                      </div>
                    </div>

                    <div style={{ paddingTop: 12, borderTop: '1px solid var(--border-color, #27272a)' }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
                        OR CUSTOM BACKEND WEBHOOK (POST)
                      </div>
                      <pre
                        style={{
                          background: 'var(--bg-primary, #0c0c0d)',
                          padding: '8px 10px',
                          borderRadius: 6,
                          border: '1px solid var(--border-color, #27272a)',
                          fontSize: 11,
                          color: '#34d399',
                          marginBottom: 8,
                        }}
                      >
                        {`${typeof window !== 'undefined' ? window.location.origin : 'https://traffic-source-new-own.vercel.app'}/api/v1/identify`}
                      </pre>
                      <pre
                        style={{
                          background: 'var(--bg-primary, #0c0c0d)',
                          padding: '8px 10px',
                          borderRadius: 6,
                          border: '1px solid var(--border-color, #27272a)',
                          fontSize: 11,
                          color: '#a5b4fc',
                        }}
                      >
{`{
  "site_id": "${siteId}",
  "email": "user@gmail.com"
}`}
                      </pre>
                    </div>
                  </div>
                )}
              </div>

              <div className="modal-footer">
                <button className="btn btn-primary" onClick={() => setShowSetupModal(false)}>
                  Done
                </button>
              </div>
            </div>
          </div>
        )}
      </DashboardLayout>
    </>
  );
}
