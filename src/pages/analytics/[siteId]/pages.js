import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import DashboardLayout from '@/components/layout/DashboardLayout';
import ChannelIcon from '@/components/ui/ChannelIcon';
import { useDateRange } from '@/contexts/DateRangeContext';
import { buildPageHref } from '@/lib/formatters';

const PAGE_SIZE = 20;

const SORT_OPTIONS = [
  { value: 'visitors:desc', label: 'Most visitors' },
  { value: 'visitors:asc', label: 'Least visitors' },
  { value: 'views:desc', label: 'Most viewed' },
  { value: 'views:asc', label: 'Least viewed' },
  { value: 'time:desc', label: 'Most time spent' },
  { value: 'avg_time:desc', label: 'Longest avg. time' },
  { value: 'bots:desc', label: 'Most bot hits' },
  { value: 'recent:desc', label: 'Most recent activity' },
  { value: 'recent:asc', label: 'Least recent activity' },
  { value: 'first_seen:desc', label: 'Newest pages' },
  { value: 'first_seen:asc', label: 'Oldest pages' },
  { value: 'page:asc', label: 'Page A → Z' },
];

const SOURCE_FILTERS = ['AI', 'Search', 'Social', 'Referral', 'Direct'];

const TYPE_COLORS = {
  AI: { bg: 'rgba(139,92,246,0.12)', fg: '#a78bfa' },
  Search: { bg: 'rgba(59,130,246,0.12)', fg: '#60a5fa' },
  Social: { bg: 'rgba(236,72,153,0.12)', fg: '#f472b6' },
  Referral: { bg: 'rgba(245,158,11,0.12)', fg: '#fbbf24' },
  Direct: { bg: 'rgba(148,163,184,0.12)', fg: '#94a3b8' },
};

function formatDuration(sec) {
  if (sec == null) return '—';
  const s = Math.round(Number(sec));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  const h = Math.floor(s / 3600);
  if (h < 24) return `${h}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function formatRelative(iso) {
  if (!iso) return '—';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const fmt = (n) => Number(n || 0).toLocaleString();

const th = (align = 'left') => ({
  padding: '10px 14px',
  textAlign: align,
  fontSize: 11,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  fontWeight: 600,
  whiteSpace: 'nowrap',
});
const td = (align = 'left') => ({ padding: '11px 14px', textAlign: align, fontSize: 13, verticalAlign: 'middle' });

const controlStyle = {
  height: 36,
  fontSize: 13,
  background: 'var(--bg-card, #161618)',
  border: '1px solid var(--border-color, #27272a)',
  borderRadius: 6,
  color: 'var(--text-primary)',
  padding: '0 10px',
};

function TypeBadge({ type }) {
  const c = TYPE_COLORS[type] || TYPE_COLORS.Direct;
  return (
    <span style={{ background: c.bg, color: c.fg, borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap' }}>
      {type}
    </span>
  );
}

export default function Pages() {
  const router = useRouter();
  const { siteId } = router.query;
  const { period, customRange } = useDateRange();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('visitors:desc');
  const [source, setSource] = useState('');
  const [traffic, setTraffic] = useState('all');
  const [exporting, setExporting] = useState(false);
  const requestId = useRef(0);

  const buildParams = useCallback((extra = {}) => {
    const [sortKey, order] = sort.split(':');
    return new URLSearchParams({
      ...(customRange ? { from: customRange.from, to: customRange.to } : { period: period || '30d' }),
      sort: sortKey,
      order,
      traffic,
      ...(search ? { search } : {}),
      ...(source ? { source } : {}),
      ...extra,
    });
  }, [period, customRange, sort, traffic, search, source]);

  const fetchData = useCallback(async () => {
    if (!siteId) return;
    const id = ++requestId.current;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/analytics/${siteId}/pages?${buildParams({ page: String(page), limit: String(PAGE_SIZE) })}`);
      if (!res.ok) throw new Error();
      const json = await res.json();
      if (id === requestId.current) setData(json);
    } catch {
      if (id === requestId.current) setError('Couldn’t load pages. Try again.');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [siteId, page, buildParams]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Any filter / range change goes back to the first page
  useEffect(() => { setPage(1); }, [search, sort, source, traffic, period, customRange]);

  const exportCsv = async () => {
    if (!siteId || exporting) return;
    setExporting(true);
    try {
      const res = await fetch(`/api/analytics/${siteId}/pages?${buildParams({ format: 'csv' })}`);
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const match = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = match ? match[1] : 'pages.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError('CSV export failed. Try again.');
    } finally {
      setExporting(false);
    }
  };

  const site = data?.site;
  const pages = data?.pages || [];
  const pagination = data?.pagination;
  const filtered = !!(search || source || traffic !== 'all');

  const exportButton = (
    <button
      onClick={exportCsv}
      disabled={exporting || !siteId}
      title="Download every page matching the current filters as CSV"
      style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 10px', fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', cursor: exporting ? 'not-allowed' : 'pointer', opacity: exporting ? 0.6 : 1, display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      {exporting ? 'Exporting…' : 'Export CSV'}
    </button>
  );

  return (
    <>
      <Head><title>Pages - SAC MAC</title></Head>
      <DashboardLayout siteId={siteId} siteName={site?.name} siteDomain={site?.domain} headerActions={exportButton}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14, gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Pages</h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
              Every page that captured at least one visitor or bot hit in this date range.
            </p>
          </div>
          {pagination && (
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              {fmt(pagination.total)} page{pagination.total === 1 ? '' : 's'}
            </span>
          )}
        </div>

        {/* Search + filters */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: '1 1 240px', maxWidth: 360 }}>
            <input
              type="text"
              placeholder="Search pages, e.g. /pricing"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              aria-label="Search pages"
              style={{ ...controlStyle, width: '100%', paddingLeft: 32 }}
            />
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position: 'absolute', left: 11, top: 11, color: 'var(--text-muted)' }}>
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>
          <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort pages" style={controlStyle}>
            {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Filter by source" style={controlStyle}>
            <option value="">All sources</option>
            {SOURCE_FILTERS.map((s) => <option key={s} value={s}>Visited from {s}</option>)}
          </select>
          <select value={traffic} onChange={(e) => setTraffic(e.target.value)} aria-label="Filter by traffic type" style={controlStyle}>
            <option value="all">Visitors + bots</option>
            <option value="humans">With visitors</option>
            <option value="bots">With bot hits</option>
          </select>
          {filtered && (
            <button
              className="btn btn-secondary"
              onClick={() => { setSearchInput(''); setSearch(''); setSource(''); setTraffic('all'); }}
              style={{ height: 36, fontSize: 12, padding: '0 12px' }}
            >
              Clear filters
            </button>
          )}
        </div>

        {error && <div style={{ marginBottom: 12, color: 'var(--danger, #ef4444)', fontSize: 13 }}>{error}</div>}

        {loading && !data ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
            <div className="loading-spinner" />
          </div>
        ) : pages.length === 0 ? (
          <div className="empty-state" style={{ padding: '60px 20px', textAlign: 'center' }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 8px' }}>
              {filtered ? 'No pages match these filters' : 'No page traffic in this date range'}
            </h3>
            <p style={{ color: 'var(--text-muted)', maxWidth: 460, margin: '0 auto', fontSize: 13 }}>
              {filtered ? 'Clear the filters or try a different search.' : 'Pick a wider range, such as All, to see every page captured so far.'}
            </p>
          </div>
        ) : (
          <div className="panel" style={{ padding: 0, overflow: 'hidden', opacity: loading ? 0.6 : 1, transition: 'opacity 0.15s' }}>
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color, #27272a)', background: 'var(--bg-card, #161618)' }}>
                    <th style={th()}>Page</th>
                    <th style={th('right')}>Visitors</th>
                    <th style={th('right')}>Views</th>
                    <th style={th('right')}>Time spent</th>
                    <th style={th('right')}>Avg / view</th>
                    <th style={th()}>Top source</th>
                    {source && <th style={th('right')}>From {source}</th>}
                    <th style={th('right')}>Bot hits</th>
                    <th style={th('right')}>Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {pages.map((p) => {
                    const href = buildPageHref(p.page, site?.domain);
                    return (
                      <tr key={p.page} className="table-row-hover" style={{ borderBottom: '1px solid var(--border-color, #27272a)' }}>
                        <td style={{ ...td(), maxWidth: 380 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                            <span title={p.page} style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {p.page}
                            </span>
                            {href && (
                              <a href={href} target="_blank" rel="noopener noreferrer" title="Open page" style={{ color: 'var(--text-muted)', flexShrink: 0, display: 'inline-flex' }}>
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                  <polyline points="15 3 21 3 21 9" />
                                  <line x1="10" y1="14" x2="21" y2="3" />
                                </svg>
                              </a>
                            )}
                          </div>
                          {p.entries > 0 && (
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                              {fmt(p.entries)} entrance{p.entries === 1 ? '' : 's'} · {fmt(p.sessions)} session{p.sessions === 1 ? '' : 's'}
                            </div>
                          )}
                        </td>
                        <td style={{ ...td('right'), fontWeight: 600 }}>{fmt(p.visitors)}</td>
                        <td style={td('right')}>{fmt(p.views)}</td>
                        <td style={td('right')}>{p.views ? formatDuration(p.totalTimeSec) : '—'}</td>
                        <td style={{ ...td('right'), color: 'var(--text-muted)' }}>{p.views ? formatDuration(p.avgTimeSec) : '—'}</td>
                        <td style={td()}>
                          {p.topSource ? (
                            <div
                              title={p.sources.map((s) => `${s.name}: ${s.visitors}`).join('\n')}
                              style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}
                            >
                              <ChannelIcon name={p.topSource.name} />
                              <span>{p.topSource.name}</span>
                              <TypeBadge type={p.topSource.type} />
                              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.topSource.sharePct}%</span>
                            </div>
                          ) : (
                            <span style={{ color: 'var(--text-muted)' }}>—</span>
                          )}
                        </td>
                        {source && <td style={td('right')}>{fmt(p.sourceVisitors)}</td>}
                        <td style={td('right')}>
                          {p.botHits ? (
                            <span title={`${fmt(p.aiBotHits)} from AI crawlers`}>
                              {fmt(p.botHits)}
                              {p.aiBotHits > 0 && <span style={{ fontSize: 11, color: '#a78bfa', marginLeft: 4 }}>({fmt(p.aiBotHits)} AI)</span>}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)' }}>0</span>
                          )}
                        </td>
                        <td style={{ ...td('right'), color: 'var(--text-muted)', whiteSpace: 'nowrap' }} title={p.lastSeen ? new Date(p.lastSeen).toLocaleString() : ''}>
                          {formatRelative(p.lastSeen)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {pagination && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderTop: '1px solid var(--border-color, #27272a)', fontSize: 13, gap: 12, flexWrap: 'wrap' }}>
                <div style={{ color: 'var(--text-muted)' }}>
                  Showing {fmt((pagination.page - 1) * pagination.limit + 1)}–{fmt(Math.min(pagination.page * pagination.limit, pagination.total))} of {fmt(pagination.total)} pages
                </div>
                {pagination.totalPages > 1 && (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <button className="btn btn-secondary" disabled={pagination.page <= 1} onClick={() => setPage(1)} style={{ padding: '4px 10px', fontSize: 12 }}>First</button>
                    <button className="btn btn-secondary" disabled={pagination.page <= 1} onClick={() => setPage((n) => Math.max(1, n - 1))} style={{ padding: '4px 10px', fontSize: 12 }}>Previous</button>
                    <span style={{ color: 'var(--text-muted)', padding: '0 6px' }}>Page {pagination.page} of {fmt(pagination.totalPages)}</span>
                    <button className="btn btn-secondary" disabled={pagination.page >= pagination.totalPages} onClick={() => setPage((n) => n + 1)} style={{ padding: '4px 10px', fontSize: 12 }}>Next</button>
                    <button className="btn btn-secondary" disabled={pagination.page >= pagination.totalPages} onClick={() => setPage(pagination.totalPages)} style={{ padding: '4px 10px', fontSize: 12 }}>Last</button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </DashboardLayout>
    </>
  );
}
