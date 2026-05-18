import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import DashboardLayout from '@/components/layout/DashboardLayout';
import MetricStrip from '@/components/ui/MetricStrip';
import AnalyticsPanel from '@/components/ui/AnalyticsPanel';
import CombinedChart from '@/components/charts/CombinedChart';
import RealtimeUsers from '@/components/ui/RealtimeUsers';
import { useAnalytics } from '@/hooks/useAnalytics';
import { useFilters } from '@/contexts/FilterContext';
import { getCountryName, buildPageHref } from '@/lib/formatters';
import CountryFlag from '@/components/ui/CountryFlag';
import TechIcon from '@/components/ui/TechIcon';
import ChannelIcon from '@/components/ui/ChannelIcon';

const FILTER_LABELS = {
  channel: 'Channel',
  country: 'Country',
  city: 'City',
  page: 'Page',
  entry_page: 'Entry page',
  exit_page: 'Exit page',
  browser: 'Browser',
  os: 'OS',
  device: 'Device',
};

export default function Analytics() {
  const router = useRouter();
  const { siteId } = router.query;
  const { filters, setFilter, removeFilter, clearFilters, hasFilters } = useFilters();
  const [spikeDay, setSpikeDay] = useState(null);
  const [chartFullscreen, setChartFullscreen] = useState(false);
  const [compare, setCompare] = useState(false);
  const [annForm, setAnnForm] = useState({ open: false, date: '', note: '' });
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const { data, loading, refetch } = useAnalytics('overview', compare ? { compare: '1' } : {});

  const syncPayments = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncMsg('');
    try {
      const r = await fetch(`/api/analytics/${siteId}/sync-payments`, { method: 'POST' });
      const d = await r.json();
      setSyncMsg(d.newConversions > 0 ? `Synced ${d.newConversions} new payment${d.newConversions === 1 ? '' : 's'}` : 'No new payments found');
      if (d.newConversions > 0) refetch();
    } catch {
      setSyncMsg('Sync failed');
    }
    setSyncing(false);
    setTimeout(() => setSyncMsg(''), 4000);
  }, [siteId, syncing, refetch]);

  useEffect(() => {
    if (!chartFullscreen) return;
    const onKey = (e) => { if (e.key === 'Escape') setChartFullscreen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [chartFullscreen]);

  if (loading || !data) {
    return (
      <>
        <Head><title>Analytics - Traffic Source</title></Head>
        <DashboardLayout siteId={siteId}>
          <div className="loading-inline"><div className="loading-spinner" /></div>
        </DashboardLayout>
      </>
    );
  }

  const conv = data.conversions?.totals || {};

  const toggleFilter = (key, value) => {
    if (filters[key] === value) {
      removeFilter(key);
    } else {
      setFilter(key, value);
    }
  };

  const saveAnnotation = async () => {
    if (!annForm.date || !annForm.note.trim()) return;
    await fetch(`/api/analytics/${siteId}/annotations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: annForm.date, note: annForm.note.trim() }),
    });
    setAnnForm({ open: false, date: '', note: '' });
    refetch();
  };

  const sourceTabToFilter = { referrer: 'channel', utm_source: 'channel', utm_campaign: 'channel' };
  const geoTabToFilter = { country: 'country', city: 'city' };
  const pageTabToFilter = { all: 'page', entry: 'entry_page', exit: 'exit_page' };
  const techTabToFilter = { browser: 'browser', os: 'os', device: 'device' };

  return (
    <>
      <Head>
        <title>{data.site?.name || 'Analytics'} - Traffic Source</title>
      </Head>
      <DashboardLayout siteId={siteId} siteName={data.site?.name} siteDomain={data.site?.domain}>

        {hasFilters && (
          <div className="filter-bar">
            <span className="filter-bar-label">Filtered by:</span>
            {Object.entries(filters).map(([key, value]) => (
              <span key={key} className="filter-pill">
                <span className="filter-pill-label">{FILTER_LABELS[key] || key}:</span>
                <span className="filter-pill-value">
                  {key === 'country' ? getCountryName(value) : value}
                </span>
                <button
                  className="filter-pill-remove"
                  onClick={() => removeFilter(key)}
                  aria-label={`Remove ${key} filter`}
                >
                  &times;
                </button>
              </span>
            ))}
            <button className="filter-clear" onClick={clearFilters}>
              Clear all
            </button>
          </div>
        )}

        <RealtimeUsers countries={data.countries || []} />

        <div style={{ position: 'relative' }}>
          <MetricStrip metrics={[
            { label: 'Visitors', value: data.current.visitors, change: data.changes.visitors },
            { label: 'Pageviews', value: data.current.pageViews, change: data.changes.pageViews },
            { label: 'Revenue', value: conv.revenue || 0, format: 'currency' },
            { label: 'Conversion rate', value: conv.conversionRate || 0, format: 'percent' },
            { label: 'Bounce rate', value: data.current.bounceRate, change: data.changes.bounceRate, format: 'percent' },
            { label: 'Session time', value: data.current.avgDuration, change: data.changes.avgDuration, format: 'duration' },
          ]} />
          <div style={{ position: 'absolute', top: 10, right: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
            {syncMsg && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{syncMsg}</span>}
            <button
              onClick={syncPayments}
              disabled={syncing}
              title="Sync payments from Stripe / LemonSqueezy / Dodo"
              style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 500, color: 'var(--text-muted)', cursor: syncing ? 'not-allowed' : 'pointer', opacity: syncing ? 0.6 : 1, display: 'flex', alignItems: 'center', gap: 4 }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={syncing ? { animation: 'spin 1s linear infinite' } : {}}>
                <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
              </svg>
              {syncing ? 'Syncing…' : 'Sync payments'}
            </button>
          </div>
        </div>

        {(data.newVisitors > 0 || data.returningVisitors > 0) && (() => {
          const total = (data.newVisitors || 0) + (data.returningVisitors || 0);
          const newPct = total > 0 ? Math.round((data.newVisitors / total) * 100) : 0;
          const retPct = 100 - newPct;
          return (
            <div className="audience-strip">
              <div className="audience-strip-label">Audience</div>
              <div className="audience-strip-bar">
                <div className="audience-strip-bar-new" style={{ width: `${newPct}%` }} title={`New: ${newPct}%`} />
                <div className="audience-strip-bar-ret" style={{ width: `${retPct}%` }} title={`Returning: ${retPct}%`} />
              </div>
              <div className="audience-strip-stats">
                <span className="audience-stat new">
                  <span className="audience-dot" />
                  <strong>{(data.newVisitors || 0).toLocaleString()}</strong>
                  <span>New visitors</span>
                  <span className="audience-pct">{newPct}%</span>
                </span>
                <span className="audience-stat ret">
                  <span className="audience-dot ret" />
                  <strong>{(data.returningVisitors || 0).toLocaleString()}</strong>
                  <span>Returning</span>
                  <span className="audience-pct">{retPct}%</span>
                </span>
              </div>
            </div>
          );
        })()}

        <div
          className={chartFullscreen ? 'panel chart-panel-fs' : 'panel'}
          style={chartFullscreen ? {} : { marginBottom: spikeDay ? 0 : 20, position: 'relative' }}
        >
          <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 10, display: 'flex', gap: 6 }}>
            <button
              className={`chart-ctrl-btn${compare ? ' active' : ''}`}
              onClick={() => setCompare(c => !c)}
              title="Compare to previous period"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
            </button>
            <button
              className="chart-ctrl-btn"
              onClick={() => setAnnForm(f => ({ ...f, open: !f.open, date: new Date().toISOString().slice(0, 10) }))}
              title="Add annotation"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
            <button
              className="chart-fs-btn"
              onClick={() => setChartFullscreen(f => !f)}
              title={chartFullscreen ? 'Exit fullscreen (Esc)' : 'View fullscreen'}
              style={{ position: 'static' }}
            >
              {chartFullscreen ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>
                </svg>
              )}
            </button>
          </div>
          {annForm.open && (
            <div className="ann-form">
              <input type="date" className="ann-form-date" value={annForm.date} onChange={e => setAnnForm(f => ({ ...f, date: e.target.value }))} />
              <input type="text" className="ann-form-note" placeholder="Add a note…" value={annForm.note} onChange={e => setAnnForm(f => ({ ...f, note: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') saveAnnotation(); if (e.key === 'Escape') setAnnForm({ open: false, date: '', note: '' }); }} autoFocus maxLength={200} />
              <button className="ann-form-save" onClick={saveAnnotation}>Save</button>
              <button className="ann-form-cancel" onClick={() => setAnnForm({ open: false, date: '', note: '' })}>×</button>
            </div>
          )}
          <div className={chartFullscreen ? 'chart-container chart-container-fs' : 'chart-container'}>
            <CombinedChart
              trafficData={data.timeSeries}
              revenueData={data.conversions?.timeSeries || []}
              dailySources={data.dailySources || {}}
              compareData={compare ? (data.prevTimeSeries || []) : undefined}
              annotations={data.annotations || []}
              onDayClick={(date, dayData) => setSpikeDay(prev => prev?.date === date ? null : { date, dayData })}
            />
          </div>
        </div>

        {spikeDay && (() => {
          const sources = (data.dailySourcesAll || {})[spikeDay.date] || [];
          const dayVisitors = spikeDay.dayData?.visitors || 0;
          const avg = data.timeSeries?.length > 0
            ? (data.timeSeries.reduce((s, d) => s + (d.visitors || 0), 0) / data.timeSeries.length)
            : 0;
          const spike = avg > 0 ? (dayVisitors / avg).toFixed(1) : null;
          const topSrc = spikeDay.dayData?.spikeSrc;

          return (
            <div className="spike-panel">
              <div className="spike-panel-header">
                <span className="spike-panel-date">
                  {new Date(spikeDay.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                </span>
                {spike && parseFloat(spike) > 1.2 && topSrc && (
                  <span className="spike-panel-badge">
                    {spike}&times; traffic from <strong>{topSrc}</strong>
                  </span>
                )}
                <button className="spike-panel-close" onClick={() => setSpikeDay(null)}>&times;</button>
              </div>
              <div className="spike-panel-stats">
                <div className="spike-panel-stat">
                  <span className="spike-panel-stat-label">Visitors</span>
                  <span className="spike-panel-stat-value">{dayVisitors.toLocaleString()}</span>
                </div>
                {spikeDay.dayData?.revenue > 0 && (
                  <div className="spike-panel-stat">
                    <span className="spike-panel-stat-label">Revenue</span>
                    <span className="spike-panel-stat-value">${(spikeDay.dayData.revenue / 100).toFixed(2)}</span>
                  </div>
                )}
              </div>
              {sources.length > 0 && (
                <div className="spike-panel-sources">
                  <div className="spike-panel-sources-label">Traffic breakdown</div>
                  {sources.slice(0, 6).map((s, i) => {
                    const pct = dayVisitors > 0 ? Math.round((s.count / dayVisitors) * 100) : 0;
                    return (
                      <div key={i} className="spike-panel-source-row">
                        <ChannelIcon name={s.source} />
                        <span className="spike-panel-source-name">{s.source}</span>
                        <div className="spike-panel-source-bar">
                          <div className="spike-panel-source-fill" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="spike-panel-source-count">{s.count.toLocaleString()}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}

        <div className="grid-2">
          <AnalyticsPanel
            tabs={[
              { key: 'referrer', label: 'Channel' },
              { key: 'utm_source', label: 'Referrer' },
              { key: 'utm_campaign', label: 'Campaign' },
            ]}
            data={{
              referrer: data.sources || [],
              utm_source: (data.sources || []).filter(s => s.name !== 'Direct'),
              utm_campaign: (data.sources || []).filter(s => s.name !== 'Direct'),
            }}
            valueKey="sessions"
            renderLabel={(row) => (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <ChannelIcon name={row.name} />
                {row.name}
              </span>
            )}
            showPercentage
            defaultTab="referrer"
            onRowClick={(row, tab) => toggleFilter(sourceTabToFilter[tab], row.name)}
            activeFilter={{ tab: Object.keys(sourceTabToFilter).find(t => sourceTabToFilter[t] === 'channel'), value: filters.channel }}
          />

          <AnalyticsPanel
            tabs={[
              { key: 'country', label: 'Country' },
              { key: 'city', label: 'City' },
            ]}
            data={{
              country: data.countries || [],
              city: data.cities || [],
            }}
            renderLabel={(row, meta) => {
              if (meta.activeTab === 'city') return row.name;
              return (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <CountryFlag code={row.name} size="s" />
                  {getCountryName(row.name)}
                </span>
              );
            }}
            showPercentage
            defaultTab="country"
            onRowClick={(row, tab) => toggleFilter(geoTabToFilter[tab], row.name)}
            activeFilter={{ tab: filters.country ? 'country' : filters.city ? 'city' : null, value: filters.country || filters.city }}
          />
        </div>

        <div className="grid-2">
          <AnalyticsPanel
            tabs={[
              { key: 'all', label: 'Page' },
              { key: 'entry', label: 'Entry page' },
              { key: 'exit', label: 'Exit page' },
            ]}
            data={{
              all: (data.pages || []).map(p => ({ ...p, count: p.views })),
              entry: (data.entryPages || []).map(p => ({ ...p, count: p.sessions })),
              exit: (data.exitPages || []).map(p => ({ ...p, count: p.sessions })),
            }}
            renderLabel={(row) => renderPageLabel(row.name, data.site?.domain)}
            showPercentage
            barByTotal
            defaultTab="all"
            onRowClick={(row, tab) => toggleFilter(pageTabToFilter[tab], row.name)}
            activeFilter={{
              tab: filters.page ? 'all' : filters.entry_page ? 'entry' : filters.exit_page ? 'exit' : null,
              value: filters.page || filters.entry_page || filters.exit_page,
            }}
          />

          <AnalyticsPanel
            tabs={[
              { key: 'browser', label: 'Browser' },
              { key: 'os', label: 'OS' },
              { key: 'device', label: 'Device' },
            ]}
            data={{
              browser: data.browsers || [],
              os: data.os || [],
              device: data.devices || [],
            }}
            renderLabel={(row, meta) => (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <TechIcon type={meta.activeTab} name={row.name} />
                {row.name}
              </span>
            )}
            showPercentage
            defaultTab="browser"
            onRowClick={(row, tab) => toggleFilter(techTabToFilter[tab], row.name)}
            activeFilter={{
              tab: filters.browser ? 'browser' : filters.os ? 'os' : filters.device ? 'device' : null,
              value: filters.browser || filters.os || filters.device,
            }}
          />
        </div>

        {data.topEvents?.length > 0 && (
          <div className="panel" style={{ marginBottom: 20 }}>
            <div className="panel-header">
              <div className="panel-tabs"><button className="panel-tab active">Events</button></div>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Auto-tracked + custom</span>
            </div>
            <div className="panel-body">
              <table className="events-table">
                <thead>
                  <tr><th>Event</th><th>Total</th><th>Unique visitors</th></tr>
                </thead>
                <tbody>
                  {data.topEvents.map((ev, i) => (
                    <tr key={i}>
                      <td>
                        <span className="event-name-dot" />
                        {ev.name}
                      </td>
                      <td className="events-num">{Number(ev.count).toLocaleString()}</td>
                      <td className="events-num">{Number(ev.unique_visitors).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {data.affiliates?.length > 0 && (
          <div className="panel" style={{ marginBottom: 20 }}>
            <div className="panel-header">
              <div className="panel-tabs">
                <button className="panel-tab active">Affiliates</button>
              </div>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => router.push(`/analytics/${siteId}/affiliates`)}
              >
                View all &rarr;
              </button>
            </div>
            <div className="panel-body" style={{ padding: 0 }}>
              <table className="journey-table">
                <thead>
                  <tr>
                    <th>Affiliate</th>
                    <th>Visits</th>
                    <th>Conversions</th>
                    <th>Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {data.affiliates.map((a, i) => (
                    <tr key={i}>
                      <td><span style={{ fontWeight: 600 }}>{a.name}</span></td>
                      <td>{a.visits}</td>
                      <td>{a.conversions}</td>
                      <td style={{ fontWeight: 600 }}>${((a.revenue || 0) / 100).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {data.conversions?.bySource?.length > 0 && (
          <div className="panel" style={{ marginBottom: 20 }}>
            <div className="panel-header">
              <div className="panel-tabs">
                <button className="panel-tab active">Journey for payment</button>
              </div>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => router.push(`/analytics/${siteId}/conversions`)}
              >
                View all &rarr;
              </button>
            </div>
            <div className="panel-body" style={{ padding: 0 }}>
              <table className="journey-table">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Conversions</th>
                    <th>Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {data.conversions.bySource.map((row, i) => (
                    <tr key={i}>
                      <td>
                        <span style={{ fontWeight: 600 }}>{row.name}</span>
                      </td>
                      <td>{row.conversions}</td>
                      <td style={{ fontWeight: 600 }}>${((row.revenue || 0) / 100).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </DashboardLayout>
    </>
  );
}

function renderPageLabel(pathname, siteDomain) {
  const href = buildPageHref(pathname, siteDomain);
  if (!href) return pathname || '/';
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="page-link-out" onClick={(e) => e.stopPropagation()}>
      <span>{pathname || '/'}</span>
      <span aria-hidden="true">&uarr;</span>
    </a>
  );
}
