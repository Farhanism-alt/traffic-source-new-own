import { useState, useEffect } from 'react';
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
  const { data, loading } = useAnalytics('overview');
  const { filters, setFilter, removeFilter, clearFilters, hasFilters } = useFilters();
  const [spikeDay, setSpikeDay] = useState(null);
  const [chartFullscreen, setChartFullscreen] = useState(false);

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

  // Toggle filter: clicking the same value removes it, clicking a different one sets it
  const toggleFilter = (key, value) => {
    if (filters[key] === value) {
      removeFilter(key);
    } else {
      setFilter(key, value);
    }
  };

  // Map tab keys to filter keys
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

        {/* ── Active Filters Bar ── */}
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

        {/* ── Realtime Active Users ── */}
        <RealtimeUsers countries={data.countries || []} />

        {/* ── Metrics Strip ── */}
        <MetricStrip metrics={[
          { label: 'Visitors', value: data.current.visitors, change: data.changes.visitors },
          { label: 'Pageviews', value: data.current.pageViews, change: data.changes.pageViews },
          { label: 'Revenue', value: conv.revenue || 0, format: 'currency' },
          { label: 'Conversion rate', value: conv.conversionRate || 0, format: 'percent' },
          { label: 'Bounce rate', value: data.current.bounceRate, change: data.changes.bounceRate, format: 'percent' },
          { label: 'Session time', value: data.current.avgDuration, change: data.changes.avgDuration, format: 'duration' },
        ]} />

        {/* ── Combined Chart (visitors line + revenue bars) ── */}
        <div
          className={chartFullscreen ? 'panel chart-panel-fs' : 'panel'}
          style={chartFullscreen ? {} : { marginBottom: spikeDay ? 0 : 20, position: 'relative' }}
        >
          <button
            className="chart-fs-btn"
            onClick={() => setChartFullscreen(f => !f)}
            title={chartFullscreen ? 'Exit fullscreen (Esc)' : 'View fullscreen'}
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
          <div className={chartFullscreen ? 'chart-container chart-container-fs' : 'chart-container'}>
            <CombinedChart
              trafficData={data.timeSeries}
              revenueData={data.conversions?.timeSeries || []}
              dailySources={data.dailySources || {}}
              onDayClick={(date, dayData) => setSpikeDay(prev => prev?.date === date ? null : { date, dayData })}
            />
          </div>
        </div>

        {/* ── Spike Attribution Panel ── */}
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

        {/* ── Sources + Geography (side by side) ── */}
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

        {/* ── Pages + Browsers (side by side) ── */}
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

        {/* ── Affiliates ── */}
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

        {/* ── Journey for Payment ── */}
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
