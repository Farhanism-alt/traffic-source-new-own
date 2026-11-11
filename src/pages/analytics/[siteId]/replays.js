import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import DashboardLayout from '@/components/layout/DashboardLayout';
import CountryFlag from '@/components/ui/CountryFlag';
import TechIcon from '@/components/ui/TechIcon';
import VisitorAvatar from '@/components/ui/VisitorAvatar';
import { useDateRange } from '@/contexts/DateRangeContext';
import { normalizeSource } from '@/lib/sources';

const PAGE_SIZE = 25;

function formatDuration(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function formatRelative(iso) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatBytes(b) {
  const n = Number(b) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function pathOf(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    return u.host + u.pathname + (u.search.length > 1 ? u.search : '');
  } catch {
    return url;
  }
}

// Navigation, clicks and typing pulled out of the events, for the activity list.
function buildActivity(events) {
  if (!events.length) return [];
  const t0 = events[0].timestamp;
  const out = [];
  let lastInputAt = -1e9;
  for (const e of events) {
    const at = e.timestamp - t0;
    if (e.type === 4 && e.data?.href) out.push({ at, kind: 'page', label: pathOf(e.data.href) });
    else if (e.type === 3 && e.data?.source === 2 && (e.data.type === 2 || e.data.type === 4)) out.push({ at, kind: 'click', label: e.data.type === 4 ? 'Double click' : 'Click' });
    else if (e.type === 3 && e.data?.source === 5) {
      // collapse a burst of typing into one row
      if (at - lastInputAt > 3000) out.push({ at, kind: 'input', label: 'Typed in a field' });
      lastInputAt = at;
    }
  }
  return out;
}

const controlStyle = {
  height: 34,
  fontSize: 13,
  background: 'var(--bg-card, #161618)',
  border: '1px solid var(--border-color, #27272a)',
  borderRadius: 6,
  color: 'var(--text-primary)',
  padding: '0 10px',
};

const ghostBtn = {
  background: 'none',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '5px 10px',
  fontSize: 12,
  fontWeight: 500,
  color: 'var(--text-muted)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  whiteSpace: 'nowrap',
};

export default function Replays() {
  const router = useRouter();
  const { siteId } = router.query;
  const { period, customRange } = useDateRange();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [minSeconds, setMinSeconds] = useState('0');
  const [device, setDevice] = useState('');
  const [identified, setIdentified] = useState(false);
  const [clicked, setClicked] = useState(false);
  const [sort, setSort] = useState('recent');
  const [selected, setSelected] = useState(() => new Set());
  const [activeId, setActiveId] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [beforeDate, setBeforeDate] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const requestId = useRef(0);

  const query = useMemo(() => new URLSearchParams({
    ...(customRange ? { from: customRange.from, to: customRange.to } : { period: period || '30d' }),
    sort,
    page: String(page),
    limit: String(PAGE_SIZE),
    ...(search ? { search } : {}),
    ...(minSeconds !== '0' ? { min_seconds: minSeconds } : {}),
    ...(device ? { device } : {}),
    ...(identified ? { identified: '1' } : {}),
    ...(clicked ? { clicked: '1' } : {}),
  }).toString(), [period, customRange, sort, page, search, minSeconds, device, identified, clicked]);

  const fetchList = useCallback(async () => {
    if (!siteId) return;
    const id = ++requestId.current;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/analytics/${siteId}/replays?${query}`);
      if (!res.ok) throw new Error();
      const json = await res.json();
      if (id !== requestId.current) return;
      setData(json);
      setActiveId((cur) => cur || json.replays[0]?.id || null);
    } catch {
      if (id === requestId.current) setError('Couldn’t load recordings.');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [siteId, query]);

  useEffect(() => { fetchList(); }, [fetchList]);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => { setPage(1); setSelected(new Set()); }, [search, minSeconds, device, identified, clicked, sort, period, customRange]);

  const replays = data?.replays || [];
  const pagination = data?.pagination;
  const usage = data?.usage;
  const settings = data?.settings;
  const active = replays.find((r) => r.id === activeId) || null;

  const toggle = (id) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const allOnPage = replays.length > 0 && replays.every((r) => selected.has(r.id));

  const doDelete = async (body, confirmText) => {
    if (!confirm(confirmText)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/analytics/${siteId}/replays`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setSelected(new Set());
      if (body.ids?.includes(activeId)) setActiveId(null);
      await fetchList();
    } catch (e) {
      alert(`Delete failed${e.message ? `: ${e.message}` : ''}`);
    } finally {
      setDeleting(false);
    }
  };

  const headerActions = (
    <button style={ghostBtn} onClick={() => setShowSettings(true)} title="Turn recording on/off, sampling, privacy and retention">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M12 1v3M12 20v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M1 12h3M20 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12" /></svg>
      Replay settings
    </button>
  );

  return (
    <>
      <Head><title>Session Replay - SAC MAC</title></Head>
      <DashboardLayout siteId={siteId} siteName={data?.site?.name} siteDomain={data?.site?.domain} headerActions={headerActions}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Session replay</h2>
            {settings && (
              <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: settings.enabled ? 'rgba(34,197,94,0.12)' : 'rgba(148,163,184,0.12)', color: settings.enabled ? '#4ade80' : 'var(--text-muted)' }}>
                {settings.enabled ? `Recording · ${settings.sample_rate}% of sessions` : 'Recording off'}
              </span>
            )}
          </div>
          {usage && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {usage.replays.toLocaleString()} recordings · {formatBytes(usage.bytes)} stored in{' '}
              {usage.storage === 's3' ? 'your storage bucket' : `the database (${formatBytes(usage.dbUsedBytes)} of ${formatBytes(usage.dbCapBytes)} cap)`}
            </span>
          )}
        </div>

        {settings && !settings.enabled && (
          <div className="panel" style={{ padding: '12px 16px', marginBottom: 12, fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <span>Recording is off for this site. Turn it on and new visits will show up here — no snippet change needed.</span>
            <button className="btn btn-primary" onClick={() => setShowSettings(true)} style={{ fontSize: 12, padding: '6px 12px' }}>Turn on</button>
          </div>
        )}
        {usage?.storage === 'db' && (
          <div className="panel" style={{ padding: '10px 16px', marginBottom: 12, fontSize: 12.5, color: '#fbbf24', borderColor: 'rgba(251,191,36,0.35)' }}>
            Recordings are going to your Postgres database (capped at {formatBytes(usage.dbCapBytes)}). Connect Supabase Storage in Replay settings so they use the free 1 GB file storage instead.
          </div>
        )}

        <div className="replay-layout" style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 380px) 1fr', gap: 14, alignItems: 'start' }}>
          {/* ---- List ---- */}
          <div className="panel" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 210px)', minHeight: 480 }}>
            <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8, borderBottom: '1px solid var(--border-color, #27272a)' }}>
              <input
                type="text"
                placeholder="Search email, visitor ID or URL"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                aria-label="Search recordings"
                style={{ ...controlStyle, width: '100%' }}
              />
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort recordings" style={{ ...controlStyle, flex: 1 }}>
                  <option value="recent">Newest</option>
                  <option value="oldest">Oldest</option>
                  <option value="longest">Longest</option>
                  <option value="clicks">Most clicks</option>
                  <option value="pages">Most pages</option>
                </select>
                <select value={minSeconds} onChange={(e) => setMinSeconds(e.target.value)} aria-label="Minimum duration" style={{ ...controlStyle, flex: 1 }}>
                  <option value="0">Any length</option>
                  <option value="10">≥ 10 sec</option>
                  <option value="30">≥ 30 sec</option>
                  <option value="60">≥ 1 min</option>
                  <option value="300">≥ 5 min</option>
                </select>
                <select value={device} onChange={(e) => setDevice(e.target.value)} aria-label="Device" style={{ ...controlStyle, flex: 1 }}>
                  <option value="">All devices</option>
                  <option value="desktop">Desktop</option>
                  <option value="mobile">Mobile</option>
                  <option value="tablet">Tablet</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: 14, fontSize: 12, color: 'var(--text-muted)' }}>
                <label style={{ display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
                  <input type="checkbox" checked={identified} onChange={(e) => setIdentified(e.target.checked)} /> Identified only
                </label>
                <label style={{ display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
                  <input type="checkbox" checked={clicked} onChange={(e) => setClicked(e.target.checked)} /> Has clicks
                </label>
              </div>
            </div>

            {/* Bulk actions */}
            <div style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--border-color, #27272a)', fontSize: 12, flexWrap: 'wrap' }}>
              <input
                type="checkbox"
                aria-label="Select all on this page"
                checked={allOnPage}
                onChange={() => setSelected(allOnPage ? new Set() : new Set(replays.map((r) => r.id)))}
              />
              {selected.size > 0 ? (
                <button
                  className="btn btn-secondary"
                  disabled={deleting}
                  onClick={() => doDelete({ ids: [...selected] }, `Delete ${selected.size} recording${selected.size === 1 ? '' : 's'}? This can't be undone.`)}
                  style={{ fontSize: 12, padding: '3px 10px', color: '#f87171' }}
                >
                  Delete {selected.size} selected
                </button>
              ) : (
                <span style={{ color: 'var(--text-muted)' }}>{pagination ? `${pagination.total.toLocaleString()} recordings` : ''}</span>
              )}
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
                <input type="date" value={beforeDate} onChange={(e) => setBeforeDate(e.target.value)} aria-label="Delete recordings before" style={{ ...controlStyle, height: 26, fontSize: 11, padding: '0 4px' }} />
                <button
                  className="btn btn-secondary"
                  disabled={!beforeDate || deleting}
                  title="Delete every recording that started before this date"
                  onClick={() => doDelete({ before: beforeDate }, `Delete ALL recordings that started before ${beforeDate}? This can't be undone.`)}
                  style={{ fontSize: 11, padding: '3px 8px' }}
                >
                  Delete older
                </button>
              </span>
            </div>

            <div style={{ overflowY: 'auto', flex: 1, opacity: loading && data ? 0.6 : 1 }}>
              {error && <div style={{ padding: 16, color: '#f87171', fontSize: 13 }}>{error}</div>}
              {loading && !data ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><div className="loading-spinner" /></div>
              ) : replays.length === 0 ? (
                <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                  {search || minSeconds !== '0' || device || identified || clicked ? 'No recordings match these filters.' : 'No recordings in this date range yet.'}
                </div>
              ) : (
                replays.map((r) => {
                  const isActive = r.id === activeId;
                  return (
                    <div
                      key={r.id}
                      onClick={() => setActiveId(r.id)}
                      className="table-row-hover"
                      style={{
                        display: 'flex',
                        gap: 10,
                        padding: '10px 12px',
                        borderBottom: '1px solid var(--border-color, #27272a)',
                        borderLeft: `3px solid ${isActive ? '#f59e0b' : 'transparent'}`,
                        background: isActive ? 'rgba(245,158,11,0.07)' : 'transparent',
                        cursor: 'pointer',
                      }}
                    >
                      <input type="checkbox" checked={selected.has(r.id)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(r.id)} aria-label="Select recording" style={{ marginTop: 3 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                          <span style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.email || r.visitor_id}>
                            {r.email || r.visitor_id || 'Anonymous'}
                          </span>
                          <span style={{ fontSize: 11.5, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{formatRelative(r.started_at)}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5, fontSize: 12, color: 'var(--text-muted)' }}>
                          <CountryFlag code={r.country} size="s" />
                          {r.browser && <TechIcon type="browser" name={r.browser} />}
                          {r.os && <TechIcon type="os" name={r.os} />}
                          {r.device_type && <TechIcon type="device" name={r.device_type} />}
                          <span title="Clicks">🖱 {r.click_count}</span>
                          <span title="Keystrokes">⌨ {r.key_count}</span>
                          <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>{formatDuration(r.duration_sec)}</span>
                        </div>
                        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.first_url}>
                          {pathOf(r.first_url)}{r.page_count > 1 ? ` · ${r.page_count} pages` : ''}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {pagination && pagination.totalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', borderTop: '1px solid var(--border-color, #27272a)', fontSize: 12 }}>
                <button className="btn btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} style={{ padding: '3px 10px', fontSize: 12 }}>Previous</button>
                <span style={{ color: 'var(--text-muted)' }}>Page {pagination.page} of {pagination.totalPages}</span>
                <button className="btn btn-secondary" disabled={page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)} style={{ padding: '3px 10px', fontSize: 12 }}>Next</button>
              </div>
            )}
          </div>

          {/* ---- Player ---- */}
          <ReplayViewer siteId={siteId} summary={active} onDelete={(id) => doDelete({ ids: [id] }, 'Delete this recording? This can’t be undone.')} />
        </div>

        <style jsx global>{`
          @media (max-width: 900px) {
            .replay-layout, .replay-player-row { grid-template-columns: 1fr !important; }
          }
          .replay-holder .rr-player { box-shadow: none; border-radius: 0; }
        `}</style>

        {showSettings && (
          <ReplaySettings siteId={siteId} onClose={() => setShowSettings(false)} onSaved={fetchList} />
        )}
      </DashboardLayout>
    </>
  );
}

function ReplayViewer({ siteId, summary, onDelete }) {
  const [meta, setMeta] = useState(null);
  const [events, setEvents] = useState([]);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const [currentUrl, setCurrentUrl] = useState('');
  const holder = useRef(null);
  const playerRef = useRef(null);
  const replayId = summary?.id;

  // Download every chunk, then hand the events to the player.
  useEffect(() => {
    if (!replayId || !siteId) return undefined;
    let cancelled = false;
    setMeta(null);
    setEvents([]);
    setError('');
    setProgress({ done: 0, total: 0 });
    (async () => {
      try {
        const res = await fetch(`/api/analytics/${siteId}/replays/${encodeURIComponent(replayId)}`);
        if (!res.ok) throw new Error('Recording not found');
        const m = await res.json();
        if (cancelled) return;
        setMeta(m);
        setProgress({ done: 0, total: m.chunks.length });
        const all = [];
        let done = 0;
        // a few chunks at a time
        const queue = [...m.chunks];
        const worker = async () => {
          while (queue.length && !cancelled) {
            const c = queue.shift();
            const r = await fetch(`/api/analytics/${siteId}/replays/${encodeURIComponent(replayId)}/chunk?seq=${c.seq}`);
            if (r.ok) {
              const part = await r.json();
              if (Array.isArray(part)) all.push(...part);
            }
            done += 1;
            if (!cancelled) setProgress({ done, total: m.chunks.length });
          }
        };
        await Promise.all([worker(), worker(), worker()]);
        if (cancelled) return;
        all.sort((a, b) => a.timestamp - b.timestamp);
        setEvents(all);
        setProgress(null);
      } catch (e) {
        if (!cancelled) { setError(e.message || 'Couldn’t load this recording'); setProgress(null); }
      }
    })();
    return () => { cancelled = true; };
  }, [siteId, replayId]);

  // (Re)create the player when events are ready.
  useEffect(() => {
    const el = holder.current;
    if (!el || events.length < 2) return undefined;
    if (!events.some((e) => e.type === 2)) { setError('This recording has no page snapshot yet — it may still be uploading.'); return undefined; }
    let player;
    let disposed = false;
    import('rrweb-player').then(({ default: RRWebPlayer }) => {
      if (disposed) return;
      el.innerHTML = '';
      const width = el.clientWidth;
      const height = Math.max(320, Math.min(window.innerHeight - 330, Math.round(width * 0.62)));
      player = new RRWebPlayer({
        target: el,
        props: {
          events,
          width,
          height,
          autoPlay: true,
          skipInactive: true,
          showController: true,
          speedOption: [1, 2, 4, 8, 16],
          mouseTail: { strokeStyle: '#f59e0b', lineWidth: 2 },
        },
      });
      playerRef.current = player;
      const firstHref = events.find((e) => e.type === 4)?.data?.href;
      if (firstHref) setCurrentUrl(firstHref);
      player.addEventListener('event-cast', (e) => {
        if (e?.type === 4 && e.data?.href) setCurrentUrl(e.data.href);
      });
    });
    return () => {
      disposed = true;
      playerRef.current = null;
      try { player?.$destroy(); } catch {}
    };
  }, [events]);

  const activity = useMemo(() => buildActivity(events), [events]);

  if (!summary) {
    return (
      <div className="panel" style={{ minHeight: 480, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
        Pick a recording to watch it.
      </div>
    );
  }

  const s = meta?.session;
  const source = s ? normalizeSource(s.utm_source || s.referrer_domain || 'Direct') || 'Direct' : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <div className="panel" style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <VisitorAvatar visitorId={summary.visitor_id || summary.id} size={30} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {meta?.email || summary.email || summary.visitor_id || 'Anonymous visitor'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 2 }}>
            <span>{new Date(summary.started_at).toLocaleString()}</span>
            <span>{formatDuration(summary.duration_sec)}</span>
            {s?.city || s?.country ? <span>{[s.city, s.country].filter(Boolean).join(', ')}</span> : null}
            {s?.browser && <span>{s.browser} · {s.os} · {s.device_type}</span>}
            {source && <span>From {source}{s?.utm_campaign ? ` (${s.utm_campaign})` : ''}</span>}
            <span>{summary.page_count} page{summary.page_count === 1 ? '' : 's'} · {summary.click_count} clicks</span>
          </div>
        </div>
        <button style={{ ...ghostBtn, color: '#f87171' }} onClick={() => onDelete(summary.id)}>Delete</button>
      </div>

      <div className="replay-player-row" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 220px', gap: 10, alignItems: 'start' }}>
        <div className="panel" style={{ padding: 0, overflow: 'hidden', minWidth: 0 }}>
          <div style={{ padding: '7px 12px', fontSize: 12, color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color, #27272a)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono, monospace)' }} title={currentUrl}>
            {currentUrl || summary.first_url || ' '}
          </div>
          {progress && (
            <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              <div className="loading-spinner" style={{ margin: '0 auto 12px' }} />
              Loading recording{progress.total ? ` · ${progress.done}/${progress.total} parts` : '…'}
            </div>
          )}
          {error && <div style={{ padding: 40, textAlign: 'center', color: '#f87171', fontSize: 13 }}>{error}</div>}
          <div ref={holder} className="replay-holder" style={{ width: '100%', background: '#fff' }} />
        </div>

        <div className="panel" style={{ padding: 0, maxHeight: 'calc(100vh - 260px)', overflowY: 'auto' }}>
          <div style={{ padding: '8px 12px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color, #27272a)' }}>
            Activity
          </div>
          {activity.length === 0 ? (
            <div style={{ padding: 12, fontSize: 12, color: 'var(--text-muted)' }}>{progress ? 'Loading…' : 'No activity'}</div>
          ) : activity.map((a, i) => (
            <button
              key={i}
              onClick={() => playerRef.current?.goto(a.at, true)}
              className="table-row-hover"
              style={{ display: 'flex', gap: 8, width: '100%', textAlign: 'left', background: 'none', border: 'none', borderBottom: '1px solid var(--border-color, #27272a)', padding: '7px 12px', cursor: 'pointer', color: 'var(--text-primary)', fontSize: 12 }}
            >
              <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{formatDuration(a.at / 1000)}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: a.kind === 'page' ? '#60a5fa' : undefined }} title={a.label}>
                {a.kind === 'page' ? '↳ ' : a.kind === 'click' ? '🖱 ' : '⌨ '}{a.label}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ReplaySettings({ siteId, onClose, onSaved }) {
  const [form, setForm] = useState(null);
  const [storage, setStorage] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [test, setTest] = useState(null);

  useEffect(() => {
    fetch(`/api/analytics/${siteId}/replays/settings`).then((r) => r.json()).then((d) => {
      setForm(d.settings);
      setStorage(d.storage);
    });
  }, [siteId]);

  const save = async () => {
    setSaving(true);
    setMsg('');
    try {
      const res = await fetch(`/api/analytics/${siteId}/replays/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setForm(d.settings);
      setMsg('Saved. Visitors pick up the change within ~5 minutes (new tabs).');
      onSaved?.();
    } catch (e) {
      setMsg(`Save failed${e.message ? `: ${e.message}` : ''}`);
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    setTest({ running: true });
    const d = await fetch(`/api/analytics/${siteId}/replays/settings`, { method: 'POST' }).then((r) => r.json());
    setTest(d);
  };

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const row = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, padding: '10px 0', borderBottom: '1px solid var(--border-color, #27272a)', fontSize: 13 };
  const hint = { fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 620 }}>
        <div className="modal-header">
          <h3 style={{ margin: 0, fontSize: 16 }}>Session replay settings</h3>
          <button className="btn-ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body" style={{ padding: 20, maxHeight: '70vh', overflowY: 'auto' }}>
          {!form ? <div className="loading-spinner" /> : (
            <>
              <div style={row}>
                <div><div style={{ fontWeight: 600 }}>Record sessions</div><div style={hint}>Uses the tracking snippet you already installed.</div></div>
                <input type="checkbox" checked={!!form.enabled} onChange={set('enabled')} aria-label="Record sessions" />
              </div>
              <div style={row}>
                <div><div style={{ fontWeight: 600 }}>Sessions to record (%)</div><div style={hint}>Lower this to save storage on busy sites.</div></div>
                <input type="number" min="1" max="100" value={form.sample_rate} onChange={set('sample_rate')} style={{ ...controlStyle, width: 90 }} />
              </div>
              <div style={row}>
                <div><div style={{ fontWeight: 600 }}>Mask everything typed into inputs</div><div style={hint}>Passwords are always masked. Add class <code>ts-no-record</code> to hide any element, <code>ts-mask</code> to mask its text.</div></div>
                <input type="checkbox" checked={!!form.mask_inputs} onChange={set('mask_inputs')} aria-label="Mask inputs" />
              </div>
              <div style={row}>
                <div><div style={{ fontWeight: 600 }}>Skip visits shorter than (seconds)</div><div style={hint}>Bounces this short are never uploaded.</div></div>
                <input type="number" min="0" max="600" value={form.min_seconds} onChange={set('min_seconds')} style={{ ...controlStyle, width: 90 }} />
              </div>
              <div style={row}>
                <div><div style={{ fontWeight: 600 }}>Auto-delete after (days)</div><div style={hint}>0 keeps recordings until you delete them.</div></div>
                <input type="number" min="0" max="3650" value={form.retention_days} onChange={set('retention_days')} style={{ ...controlStyle, width: 90 }} />
              </div>

              <div style={{ marginTop: 18 }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Storage</div>
                {storage?.mode === 's3' ? (
                  <div style={{ fontSize: 12.5 }}>
                    Using bucket <code>{storage.bucket}</code> at <code>{storage.endpoint}</code>.{' '}
                    <button className="btn btn-secondary" onClick={runTest} style={{ fontSize: 11, padding: '2px 8px', marginLeft: 6 }}>
                      {test?.running ? 'Testing…' : 'Test connection'}
                    </button>
                    {test && !test.running && (
                      <span style={{ marginLeft: 8, color: test.ok ? '#4ade80' : '#f87171' }}>{test.ok ? 'Connected' : test.error}</span>
                    )}
                  </div>
                ) : (
                  <div style={{ fontSize: 12.5, lineHeight: 1.6 }}>
                    <div style={{ color: '#fbbf24', marginBottom: 6 }}>Not connected — recordings go to the database, capped at 100 MB.</div>
                    To use Supabase Storage (1 GB free):
                    <ol style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                      <li>Supabase → Storage → <b>New bucket</b> named <code>replays</code>, keep it <b>private</b>.</li>
                      <li>Storage → Settings → <b>S3 Connection</b>: copy the endpoint and region, then create an access key.</li>
                      <li>Add these environment variables where the app is hosted (e.g. Vercel → Settings → Environment Variables) and redeploy:
                        <pre style={{ background: 'var(--bg-card, #161618)', padding: 10, borderRadius: 6, fontSize: 11.5, overflowX: 'auto', margin: '6px 0' }}>{`REPLAY_S3_ENDPOINT=https://<project-ref>.supabase.co/storage/v1/s3
REPLAY_S3_REGION=<region, e.g. ap-northeast-2>
REPLAY_S3_BUCKET=replays
REPLAY_S3_ACCESS_KEY_ID=<access key id>
REPLAY_S3_SECRET_ACCESS_KEY=<secret access key>`}</pre>
                      </li>
                    </ol>
                  </div>
                )}
              </div>
              {msg && <div style={{ marginTop: 12, fontSize: 12.5, color: msg.startsWith('Saved') ? '#4ade80' : '#f87171' }}>{msg}</div>}
            </>
          )}
        </div>
        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
          <button className="btn btn-primary" onClick={save} disabled={!form || saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
