import { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useDateRange } from '@/contexts/DateRangeContext';
import { useRouter } from 'next/router';

function fmt(n) {
  if (n === null || n === undefined) return '—';
  const num = Number(n);
  if (isNaN(num)) return '—';
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toLocaleString();
}

function fmtMoney(cents) {
  const usd = Number(cents || 0) / 100;
  if (usd >= 1000000) return '$' + (usd / 1000000).toFixed(1) + 'M';
  if (usd >= 1000) return '$' + (usd / 1000).toFixed(1) + 'K';
  return '$' + usd.toFixed(2);
}

function fmtDuration(s) {
  const sec = Math.round(Number(s || 0));
  if (!sec) return '0s';
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

function mkPct(v, invert = false) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  const positive = invert ? n < 0 : n > 0;
  const negative = invert ? n > 0 : n < 0;
  return {
    label: n > 0 ? `+${Math.abs(n).toFixed(1)}%` : `${n.toFixed(1)}%`,
    color: positive ? '#22c55e' : negative ? '#ef4444' : 'rgba(255,255,255,0.3)',
  };
}

export default function HeadSpot() {
  const router = useRouter();
  const { siteId } = router.query;
  const { period, customRange } = useDateRange();
  const [data, setData] = useState(null);
  const [gscData, setGscData] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!siteId) return;
    setLoading(true);
    try {
      const params = customRange
        ? `from=${customRange.from}&to=${customRange.to}`
        : `period=${period || '30d'}`;
      const gscPeriod = (!period || period === 'all') ? '12m' : period;

      const [r, gscR] = await Promise.all([
        fetch(`/api/analytics/${siteId}/overview?${params}`),
        fetch(`/api/sites/${siteId}/gsc/data?period=${gscPeriod}`).catch(() => null),
      ]);

      if (r.ok) setData(await r.json());
      if (gscR?.ok) {
        const g = await gscR.json();
        setGscData(g.linked ? g : null);
      }
    } catch {}
    setLoading(false);
  }, [siteId, period, customRange]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const site = data?.site;

  return (
    <>
      <Head>
        <title>Head Spot – {site?.name || site?.domain || 'Traffic Source'}</title>
      </Head>
      <DashboardLayout siteId={siteId} siteName={site?.name} siteDomain={site?.domain}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
            <div className="loading-spinner" />
          </div>
        ) : !data ? (
          <div style={{ textAlign: 'center', padding: 80, color: 'var(--text-muted)', fontSize: 14 }}>
            No data available.
          </div>
        ) : (
          <div className="hs-root">

            {/* ── HERO SPOTLIGHT ── */}
            <div className="hs-hero">
              <div className="hs-hero-badge">▌ HEAD SPOT</div>
              <div className="hs-hero-grid">
                <HeroCard label="Visitors"     value={fmt(data.current?.visitors)}    change={mkPct(data.changes?.visitors)} />
                <HeroCard label="Sessions"     value={fmt(data.current?.sessions)}    change={mkPct(data.changes?.sessions)} />
                <HeroCard label="Page Views"   value={fmt(data.current?.pageViews)}   change={mkPct(data.changes?.pageViews)} />
                <HeroCard label="Revenue"      value={fmtMoney(data.conversions?.totals?.revenue)} accent />
                <HeroCard label="Conversions"  value={fmt(data.conversions?.totals?.conversions)} />
                <HeroCard label="Conv. Rate"   value={`${data.conversions?.totals?.conversionRate ?? 0}%`} />
                <HeroCard label="Bounce Rate"  value={`${data.current?.bounceRate ?? 0}%`} change={mkPct(data.changes?.bounceRate, true)} />
                <HeroCard label="Avg. Duration" value={fmtDuration(data.current?.avgDuration)} change={mkPct(data.changes?.avgDuration)} />
                {data.newVisitors > 0 && <HeroCard label="New Visitors"      value={fmt(data.newVisitors)} />}
                {data.returningVisitors > 0 && <HeroCard label="Returning"   value={fmt(data.returningVisitors)} />}
              </div>
            </div>

            {/* ── ROW 1: Pages | Sources | Countries ── */}
            <div className="hs-row hs-row--3">
              <SpotCard title="Top Pages" icon="📄"
                rows={data.pages?.slice(0, 8).map(p => ({ name: p.name, val: fmt(p.views) + ' views', sub: fmt(p.visitors) + ' visitors' }))} />
              <SpotCard title="Traffic Sources" icon="🌐"
                rows={data.sources?.slice(0, 8).map(s => ({ name: s.name || 'Direct', val: fmt(s.sessions) + ' sessions', sub: fmt(s.visitors) + ' visitors' }))} />
              <SpotCard title="Countries" icon="🌍"
                rows={data.countries?.slice(0, 8).map(c => ({ name: c.name, val: fmt(c.count) }))} />
            </div>

            {/* ── ROW 2: Revenue | Affiliates ── */}
            <div className="hs-row hs-row--2">
              <SpotCard title="Revenue by Source" icon="💰"
                rows={data.conversions?.bySource?.slice(0, 8).map(c => ({ name: c.name || 'Direct', val: fmtMoney(c.revenue), sub: fmt(c.conversions) + ' conv.' }))}
                empty="No conversions in this period" />
              <SpotCard title="Affiliates" icon="🔗"
                rows={data.affiliates?.filter(a => a.visits > 0 || a.conversions > 0).slice(0, 8).map(a => ({ name: a.name, val: fmt(a.visits) + ' visits', sub: a.revenue > 0 ? fmtMoney(a.revenue) : fmt(a.conversions) + ' conv.' }))}
                empty="No affiliate activity yet" />
            </div>

            {/* ── ROW 3: Devices | Browsers | Events ── */}
            <div className="hs-row hs-row--3">
              <SpotCard title="Devices" icon="📱"
                rows={data.devices?.slice(0, 6).map(d => ({ name: d.name, val: fmt(d.count) }))} />
              <SpotCard title="Browsers" icon="🖥️"
                rows={data.browsers?.slice(0, 6).map(b => ({ name: b.name, val: fmt(b.count) }))} />
              <SpotCard title="Custom Events" icon="⚡"
                rows={data.topEvents?.slice(0, 6).map(e => ({ name: e.name, val: fmt(e.count), sub: fmt(e.unique_visitors) + ' unique' }))}
                empty="No custom events tracked yet" />
            </div>

            {/* ── ROW 4: Entry Pages | Cities | OS ── */}
            <div className="hs-row hs-row--3">
              <SpotCard title="Entry Pages" icon="🚪"
                rows={data.entryPages?.slice(0, 6).map(p => ({ name: p.name, val: fmt(p.sessions) + ' sessions', sub: p.bounce_rate + '% bounce' }))} />
              <SpotCard title="Cities" icon="🏙️"
                rows={data.cities?.slice(0, 6).map(c => ({ name: c.name, val: fmt(c.count) }))} />
              <SpotCard title="Operating Systems" icon="💻"
                rows={data.os?.slice(0, 6).map(o => ({ name: o.name, val: fmt(o.count) }))} />
            </div>

            {/* ── SEARCH CONSOLE ── */}
            {gscData && (
              <div className="hs-gsc-block">
                <div className="hs-section-heading">🔍 Google Search Console</div>
                <div className="hs-gsc-metrics">
                  <GscCard label="Clicks"       value={fmt(gscData.totals?.clicks)} />
                  <GscCard label="Impressions"  value={fmt(gscData.totals?.impressions)} />
                  <GscCard label="Avg. CTR"     value={`${((gscData.totals?.avg_ctr || 0) * 100).toFixed(1)}%`} />
                  <GscCard label="Avg. Position" value={(gscData.totals?.avg_position || 0).toFixed(1)} />
                </div>
                {gscData.topQueries?.length > 0 && (
                  <SpotCard title="Top Keywords" icon="🔑" fullWidth
                    rows={gscData.topQueries.slice(0, 12).map(q => ({
                      name: q.query,
                      val: fmt(q.clicks) + ' clicks',
                      sub: fmt(q.impressions) + ' imps · pos ' + Number(q.position || 0).toFixed(1),
                    }))} />
                )}
              </div>
            )}

          </div>
        )}
      </DashboardLayout>
    </>
  );
}

function HeroCard({ label, value, change, accent }) {
  return (
    <div className={`hs-hero-card${accent ? ' hs-hero-card--accent' : ''}`}>
      <div className="hs-hero-val">{value}</div>
      <div className="hs-hero-lbl">{label}</div>
      {change && <div className="hs-hero-chg" style={{ color: change.color }}>{change.label}</div>}
    </div>
  );
}

function SpotCard({ title, icon, rows, empty = 'No data', fullWidth }) {
  return (
    <div className={`hs-card${fullWidth ? ' hs-card--full' : ''}`}>
      <div className="hs-card-title">{icon} {title}</div>
      {!rows?.length ? (
        <div className="hs-card-empty">{empty}</div>
      ) : (
        <div className="hs-card-rows">
          {rows.map((r, i) => (
            <div key={i} className="hs-card-row">
              <span className="hs-card-row-name" title={r.name}>{r.name || '—'}</span>
              <span className="hs-card-row-right">
                <span className="hs-card-row-val">{r.val}</span>
                {r.sub && <span className="hs-card-row-sub">{r.sub}</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GscCard({ label, value }) {
  return (
    <div className="hs-gsc-card">
      <div className="hs-gsc-val">{value}</div>
      <div className="hs-gsc-lbl">{label}</div>
    </div>
  );
}
