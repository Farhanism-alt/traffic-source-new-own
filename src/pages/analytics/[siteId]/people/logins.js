import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import DashboardLayout from '@/components/layout/DashboardLayout';
import PeopleTabs from '@/components/ui/PeopleTabs';
import VisitorAvatar from '@/components/ui/VisitorAvatar';
import CountryFlag from '@/components/ui/CountryFlag';
import ChannelIcon from '@/components/ui/ChannelIcon';
import PersonFootprintDrawer from '@/components/ui/PersonFootprintDrawer';
import { useDateRange } from '@/contexts/DateRangeContext';
import { getCountryName } from '@/lib/formatters';

const PAGE_SIZE = 25;
const SOURCE_TYPES = ['AI', 'Search', 'Social', 'Referral', 'Direct'];
const TYPE_COLORS = {
  AI: { bg: 'rgba(139,92,246,0.12)', fg: '#a78bfa' },
  Search: { bg: 'rgba(59,130,246,0.12)', fg: '#60a5fa' },
  Social: { bg: 'rgba(236,72,153,0.12)', fg: '#f472b6' },
  Referral: { bg: 'rgba(245,158,11,0.12)', fg: '#fbbf24' },
  Direct: { bg: 'rgba(148,163,184,0.12)', fg: '#94a3b8' },
};

function formatRelative(iso) {
  if (!iso) return '—';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
const fullDate = (iso) => (iso ? new Date(iso).toLocaleString() : '');
const shortDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');

function formatMoney(cents, currency) {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency || ''}`;
  }
}

const controlStyle = {
  height: 36,
  fontSize: 13,
  background: 'var(--bg-card, #161618)',
  border: '1px solid var(--border-color, #27272a)',
  borderRadius: 6,
  color: 'var(--text-primary)',
  padding: '0 10px',
};
const th = (align = 'left') => ({ padding: '10px 14px', textAlign: align, fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, whiteSpace: 'nowrap' });
const td = (align = 'left') => ({ padding: '11px 14px', textAlign: align, fontSize: 13, verticalAlign: 'middle' });

export default function Logins() {
  const router = useRouter();
  const { siteId } = router.query;
  const { period, customRange } = useDateRange();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [source, setSource] = useState('');
  const [paid, setPaid] = useState('');
  const [dateMode, setDateMode] = useState('active');
  const [sort, setSort] = useState('last_login:desc');
  const [loginOnly, setLoginOnly] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [linkFor, setLinkFor] = useState(null);
  const requestId = useRef(0);

  const params = useMemo(() => {
    const [sortKey, order] = sort.split(':');
    return {
      ...(customRange ? { from: customRange.from, to: customRange.to } : { period: period || '30d' }),
      sort: sortKey,
      order,
      date_mode: dateMode,
      ...(search ? { search } : {}),
      ...(source ? { source } : {}),
      ...(paid ? { paid } : {}),
      ...(loginOnly ? { login_only: '1' } : {}),
    };
  }, [period, customRange, sort, dateMode, search, source, paid, loginOnly]);

  const fetchData = useCallback(async () => {
    if (!siteId) return;
    const id = ++requestId.current;
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams({ ...params, page: String(page), limit: String(PAGE_SIZE) });
      const res = await fetch(`/api/analytics/${siteId}/people/logins?${qs}`);
      if (!res.ok) throw new Error();
      const json = await res.json();
      if (id === requestId.current) setData(json);
    } catch {
      if (id === requestId.current) setError('Couldn’t load logins. Try again.');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [siteId, params, page]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);
  useEffect(() => { setPage(1); }, [params]);

  const exportCsv = async () => {
    if (!siteId || exporting) return;
    setExporting(true);
    try {
      const res = await fetch(`/api/analytics/${siteId}/people/logins?${new URLSearchParams({ ...params, format: 'csv' })}`);
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const match = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = match ? match[1] : 'logins.csv';
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
  const rows = data?.logins || [];
  const pagination = data?.pagination;
  const totals = data?.totals;
  const filtered = !!(search || source || paid);

  const exportButton = (
    <button
      onClick={exportCsv}
      disabled={exporting || !siteId}
      title="Download every login matching the current filters as CSV"
      style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 10px', fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', cursor: exporting ? 'not-allowed' : 'pointer', opacity: exporting ? 0.6 : 1, display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      {exporting ? 'Exporting…' : 'Export CSV'}
    </button>
  );

  return (
    <>
      <Head><title>Logins - SAC MAC</title></Head>
      <DashboardLayout siteId={siteId} siteName={site?.name} siteDomain={site?.domain} headerActions={exportButton}>
        <PeopleTabs siteId={siteId} active="logins" />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Logins</h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
              Everyone identified on your site or app (logged in or gave their email), where they came from, and whether they paid.
            </p>
          </div>
          {totals && (
            <div style={{ display: 'flex', gap: 16, fontSize: 13, color: 'var(--text-muted)' }}>
              <span><b style={{ color: 'var(--text-primary)' }}>{totals.people.toLocaleString()}</b> users</span>
              <span><b style={{ color: '#4ade80' }}>{totals.paid.toLocaleString()}</b> paid{totals.people ? ` (${Math.round((totals.paid / totals.people) * 1000) / 10}%)` : ''}</span>
              {Object.entries(totals.revenue).map(([cur, cents]) => (
                <span key={cur}><b style={{ color: 'var(--text-primary)' }}>{formatMoney(cents, cur)}</b> revenue</span>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Search email, city, campaign…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label="Search logins"
            style={{ ...controlStyle, flex: '1 1 220px', maxWidth: 320 }}
          />
          <select value={dateMode} onChange={(e) => setDateMode(e.target.value)} aria-label="Date filter" style={controlStyle}>
            <option value="active">Logged in during range</option>
            <option value="first">First login in range (new)</option>
          </select>
          <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Filter by source" style={controlStyle}>
            <option value="">All sources</option>
            <optgroup label="Source type">
              {SOURCE_TYPES.map((t) => <option key={t} value={t}>{t === 'AI' ? 'AI (ChatGPT, Claude, …)' : t}</option>)}
            </optgroup>
            {data?.sources?.length > 0 && (
              <optgroup label="Source">
                {data.sources.map((s) => <option key={s.name} value={s.name}>{s.name} ({s.count})</option>)}
              </optgroup>
            )}
          </select>
          <select value={paid} onChange={(e) => setPaid(e.target.value)} aria-label="Filter by payment" style={controlStyle}>
            <option value="">Paid + free</option>
            <option value="paid">Paid only</option>
            <option value="unpaid">Not paid</option>
            <option value="refunded">Refunded</option>
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort logins" style={controlStyle}>
            <option value="last_login:desc">Recent login</option>
            <option value="first_login:desc">Newest users</option>
            <option value="first_login:asc">Oldest users</option>
            <option value="last_active:desc">Last active</option>
            <option value="last_active:asc">Least recently active</option>
            <option value="logins:desc">Most logins</option>
            <option value="spent:desc">Most spent</option>
            <option value="email:asc">Email A → Z</option>
          </select>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }} title="Only people whose app sent a login event (e.g. track('User Login')), not everyone identified by email">
            <input type="checkbox" checked={loginOnly} onChange={(e) => setLoginOnly(e.target.checked)} />
            Only explicit login events
          </label>
          {filtered && (
            <button className="btn btn-secondary" onClick={() => { setSearchInput(''); setSearch(''); setSource(''); setPaid(''); }} style={{ height: 36, fontSize: 12, padding: '0 12px' }}>
              Clear filters
            </button>
          )}
        </div>

        {error && <div style={{ marginBottom: 12, color: '#f87171', fontSize: 13 }}>{error}</div>}

        {loading && !data ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}><div className="loading-spinner" /></div>
        ) : rows.length === 0 ? (
          <div className="empty-state" style={{ padding: '60px 20px', textAlign: 'center' }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 8px' }}>
              {filtered ? 'No logins match these filters' : data?.totalLoginUsers ? 'No logins in this date range' : 'No logins tracked yet'}
            </h3>
            <p style={{ color: 'var(--text-muted)', maxWidth: 520, margin: '0 auto', fontSize: 13, lineHeight: 1.6 }}>
              {filtered || data?.totalLoginUsers
                ? 'Try a wider date range (All) or clear the filters.'
                : loginOnly
                  ? 'No login events yet. Untick “Only explicit login events” to see everyone identified by email.'
                  : 'People show up here once they are identified by email, the same as on All people.'}
            </p>
          </div>
        ) : (
          <div className="panel" style={{ padding: 0, overflow: 'hidden', opacity: loading ? 0.6 : 1, transition: 'opacity 0.15s' }}>
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color, #27272a)', background: 'var(--bg-card, #161618)' }}>
                    <th style={th()}>User</th>
                    <th style={th()}>Came from</th>
                    <th style={th()}>First login</th>
                    <th style={th()}>Recent login</th>
                    <th style={th()}>Last active</th>
                    <th style={th()}>Location</th>
                    <th style={th('right')}>Paid</th>
                    <th style={th('right')} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const c = TYPE_COLORS[r.sourceType] || TYPE_COLORS.Direct;
                    return (
                      <tr key={r.email} className="table-row-hover" style={{ borderBottom: '1px solid var(--border-color, #27272a)' }}>
                        <td style={td()}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                            <VisitorAvatar visitorId={r.visitorId || r.email} size={30} />
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }} title={r.email}>{r.email}</div>
                              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                {r.logins} login{r.logins === 1 ? '' : 's'}{r.provider ? ` · ${r.provider}` : ''}
                              </div>
                              {r.linkedEmails?.length > 0 && (
                                <div style={{ fontSize: 11, color: '#a78bfa', marginTop: 1, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`Payments under: ${r.linkedEmails.join(', ')}`}>
                                  🔗 also pays as {r.linkedEmails.join(', ')}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td style={td()}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }} title={r.referrer || ''}>
                            <ChannelIcon name={r.source} />
                            <span>{r.source}</span>
                            <span style={{ background: c.bg, color: c.fg, borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 600 }}>{r.sourceType}</span>
                          </div>
                          {(r.utmCampaign || r.entryPage) && (
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {r.utmCampaign ? `Campaign: ${r.utmCampaign}` : `Landed on ${r.entryPage}`}
                            </div>
                          )}
                        </td>
                        <td style={{ ...td(), whiteSpace: 'nowrap' }} title={fullDate(r.firstLogin)}>{shortDate(r.firstLogin)}</td>
                        <td style={{ ...td(), whiteSpace: 'nowrap' }} title={fullDate(r.lastLogin)}>{formatRelative(r.lastLogin)}</td>
                        <td style={{ ...td(), whiteSpace: 'nowrap', color: 'var(--text-muted)' }} title={fullDate(r.lastActive)}>{formatRelative(r.lastActive)}</td>
                        <td style={td()}>
                          {r.country ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                              <CountryFlag code={r.country} size="s" />
                              <span>{[r.city, getCountryName(r.country)].filter(Boolean).join(', ')}</span>
                            </div>
                          ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                        </td>
                        <td style={{ ...td('right'), whiteSpace: 'nowrap' }}>
                          {r.payments > 0 ? (
                            <span title={`${r.payments} payment${r.payments === 1 ? '' : 's'} · last ${shortDate(r.lastPaid)}`} style={{ background: 'rgba(34,197,94,0.12)', color: '#4ade80', borderRadius: 4, padding: '2px 8px', fontWeight: 600, fontSize: 12 }}>
                              {formatMoney(r.spentCents, r.currency)}
                            </span>
                          ) : r.refunds > 0 ? (
                            <span title={`${r.refunds} refunded payment${r.refunds === 1 ? '' : 's'}`} style={{ background: 'rgba(251,191,36,0.12)', color: '#fbbf24', borderRadius: 4, padding: '2px 8px', fontWeight: 600, fontSize: 12 }}>
                              Refunded {formatMoney(r.refundedCents, r.refundCurrency)}
                            </span>
                          ) : <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Free</span>}
                        </td>
                        <td style={{ ...td('right'), whiteSpace: 'nowrap' }}>
                          <button className="btn btn-secondary" onClick={() => setLinkFor(r.email)} title="Link a payment made with another email to this user" aria-label={`Link payment to ${r.email}`} style={{ fontSize: 12, padding: '4px 8px', marginRight: 6 }}>
                            🔗
                          </button>
                          <button className="btn btn-secondary" onClick={() => setSelectedEmail(r.email)} style={{ fontSize: 12, padding: '4px 10px', whiteSpace: 'nowrap' }}>
                            Footprint →
                          </button>
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
                  Showing {(pagination.page - 1) * pagination.limit + 1}–{Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total.toLocaleString()} users
                </div>
                {pagination.totalPages > 1 && (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <button className="btn btn-secondary" disabled={pagination.page <= 1} onClick={() => setPage((n) => Math.max(1, n - 1))} style={{ padding: '4px 10px', fontSize: 12 }}>Previous</button>
                    <span style={{ color: 'var(--text-muted)', padding: '0 6px' }}>Page {pagination.page} of {pagination.totalPages}</span>
                    <button className="btn btn-secondary" disabled={pagination.page >= pagination.totalPages} onClick={() => setPage((n) => n + 1)} style={{ padding: '4px 10px', fontSize: 12 }}>Next</button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <PersonFootprintDrawer siteId={siteId} email={selectedEmail} onClose={() => setSelectedEmail(null)} />
        {linkFor && <LinkPaymentModal siteId={siteId} email={linkFor} onClose={() => setLinkFor(null)} onChanged={fetchData} />}
      </DashboardLayout>
    </>
  );
}

function LinkPaymentModal({ siteId, email, onClose, onChanged }) {
  const [links, setLinks] = useState([]);
  const [candidates, setCandidates] = useState(null);
  const [q, setQ] = useState('');
  const [manual, setManual] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async (query) => {
    const res = await fetch(`/api/analytics/${siteId}/people/links?${new URLSearchParams({ email, q: query || '' })}`);
    if (!res.ok) return;
    const d = await res.json();
    setLinks(d.links);
    setCandidates(d.candidates);
  }, [siteId, email]);

  useEffect(() => {
    const t = setTimeout(() => load(q), 250);
    return () => clearTimeout(t);
  }, [load, q]);

  const link = async (linked) => {
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch(`/api/analytics/${siteId}/people/links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, linked_email: linked }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setManual('');
      setMsg(`Linked ${linked} → ${email}`);
      await load(q);
      onChanged?.();
    } catch (e) {
      setMsg(e.message || 'Could not link');
    } finally {
      setBusy(false);
    }
  };

  const unlink = async (linked) => {
    setBusy(true);
    await fetch(`/api/analytics/${siteId}/people/links`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ linked_email: linked }),
    });
    setBusy(false);
    setMsg(`Unlinked ${linked}`);
    await load(q);
    onChanged?.();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <h3 style={{ margin: 0, fontSize: 16 }}>Link a payment to {email}</h3>
          <button className="btn-ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body" style={{ padding: 20, maxHeight: '65vh', overflowY: 'auto', fontSize: 13 }}>
          <p style={{ margin: '0 0 14px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            If this user paid with a different email, link that email here. Its payments then count as theirs on Logins, All people and Footprint.
          </p>

          {links.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Linked emails</div>
              {links.map((l) => (
                <div key={l.linked_email} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border-color, #27272a)' }}>
                  <span>{l.linked_email} <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{l.source === 'checkout' ? '· linked automatically at checkout' : ''}</span></span>
                  <button className="btn btn-secondary" disabled={busy} onClick={() => unlink(l.linked_email)} style={{ fontSize: 11, padding: '2px 8px' }}>Unlink</button>
                </div>
              ))}
            </div>
          )}

          <div style={{ fontWeight: 600, marginBottom: 6 }}>Payments under other emails</div>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search payment email…"
            aria-label="Search payment email"
            style={{ ...controlStyle, width: '100%', marginBottom: 8 }}
          />
          {candidates === null ? (
            <div style={{ color: 'var(--text-muted)', padding: 8 }}>Loading…</div>
          ) : candidates.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', padding: 8 }}>No other payment emails{q ? ' for this search' : ''}.</div>
          ) : (
            <div style={{ border: '1px solid var(--border-color, #27272a)', borderRadius: 6 }}>
              {candidates.map((c) => (
                <div key={c.email} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '8px 10px', borderBottom: '1px solid var(--border-color, #27272a)' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.email}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {c.payments} payment{c.payments === 1 ? '' : 's'} · {formatMoney(c.spentCents, c.currency)} · last {shortDate(c.lastPaid)}
                      {c.identified ? ' · also listed as its own person' : ' · not matched to anyone'}
                    </div>
                  </div>
                  <button className="btn btn-primary" disabled={busy} onClick={() => link(c.email)} style={{ fontSize: 12, padding: '4px 12px' }}>Link</button>
                </div>
              ))}
            </div>
          )}

          <div style={{ fontWeight: 600, margin: '16px 0 6px' }}>Or type the payment email</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="email"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="billing@example.com"
              aria-label="Payment email"
              style={{ ...controlStyle, flex: 1 }}
            />
            <button className="btn btn-primary" disabled={busy || !manual.includes('@')} onClick={() => link(manual)} style={{ fontSize: 12 }}>Link</button>
          </div>
          {msg && <div style={{ marginTop: 12, color: msg.startsWith('Linked') || msg.startsWith('Unlinked') ? '#4ade80' : '#f87171' }}>{msg}</div>}
        </div>
      </div>
    </div>
  );
}
