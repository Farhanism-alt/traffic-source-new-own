import {
  ComposedChart,
  Area,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { useChartTheme } from '@/hooks/useChartTheme';

const DOMAIN_MAP = {
  google: 'google.com', bing: 'bing.com', yahoo: 'yahoo.com',
  duckduckgo: 'duckduckgo.com', facebook: 'facebook.com',
  instagram: 'instagram.com', twitter: 'twitter.com', x: 'x.com',
  linkedin: 'linkedin.com', reddit: 'reddit.com', youtube: 'youtube.com',
  tiktok: 'tiktok.com', pinterest: 'pinterest.com', github: 'github.com',
  medium: 'medium.com',
};

function resolveDomain(name = '') {
  if (!name || name === 'Direct') return null;
  const v = name.trim().toLowerCase();
  if (DOMAIN_MAP[v]) return DOMAIN_MAP[v];
  try { if (v.startsWith('http')) return new URL(v).hostname; } catch {}
  if (v.includes('.')) return v.replace(/^www\./, '');
  return null;
}

function SpikeDot(props) {
  const { cx, cy, payload, ct } = props;
  const isSpike = payload?.spikeSrc;
  if (!isSpike) {
    return <circle key={`dot-${cx}`} cx={cx} cy={cy} r={2.5} fill={ct?.line || '#3b82f6'} fillOpacity={0.7} />;
  }
  const domain = resolveDomain(payload.spikeSrc);
  const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=64` : null;
  return (
    <g key={`spike-${cx}`}>
      <circle cx={cx} cy={cy} r={3} fill={ct?.line || '#3b82f6'} />
      <circle cx={cx} cy={cy - 22} r={13} fill={ct?.tooltipBg || '#1e1e1e'} stroke={ct?.line || '#3b82f6'} strokeWidth={1.5} />
      {faviconUrl
        ? <image x={cx - 9} y={cy - 31} width={18} height={18} href={faviconUrl} style={{ borderRadius: 4 }} />
        : <text x={cx} y={cy - 18} textAnchor="middle" fontSize={9} fill={ct?.axis || '#888'}>?</text>
      }
    </g>
  );
}

function AnnotationLabel({ viewBox, note, ct }) {
  const { x, y, height } = viewBox;
  return (
    <g>
      <circle cx={x} cy={(y || 0) + (height || 0) - 8} r={6} fill="#f59e0b" opacity={0.9} />
      <text x={x} y={(y || 0) + (height || 0) - 5} textAnchor="middle" fontSize={9} fill="#fff" fontWeight="700">!</text>
    </g>
  );
}

export default function CombinedChart({ trafficData, revenueData, dailySources = {}, onDayClick, compareData, annotations = [] }) {
  const ct = useChartTheme();
  const merged = mergeByDate(trafficData, revenueData, dailySources, compareData);

  if (!merged || merged.length === 0) {
    return <div className="empty-state"><p>No data for this period</p></div>;
  }

  const hasRevenue = merged.some((d) => d.revenue > 0);
  const hasCompare = compareData && compareData.length > 0;

  const handleChartClick = (chartData) => {
    if (!onDayClick || !chartData?.activePayload?.[0]) return;
    const d = chartData.activePayload[0].payload;
    if (d?.date) onDayClick(d.date, d);
  };

  return (
    <div className="chart-container">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={merged} margin={{ top: 32, right: hasRevenue ? 50 : 20, left: 10, bottom: 5 }} onClick={handleChartClick} style={{ cursor: onDayClick ? 'pointer' : 'default' }}>
          <defs>
            <linearGradient id="visitorsGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={ct.line || '#3b82f6'} stopOpacity={0.15} />
              <stop offset="95%" stopColor={ct.line || '#3b82f6'} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: ct.axis }} tickLine={false} axisLine={{ stroke: ct.axisLine }}
            tickFormatter={(val) => {
              if (val.includes(' ')) return val.split(' ')[1];
              const d = new Date(val + 'T00:00:00');
              return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
            }}
          />
          <YAxis yAxisId="left" tick={{ fontSize: 11, fill: ct.axis }} tickLine={false} axisLine={false} width={40} />
          {hasRevenue && (
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: ct.axis }} tickLine={false} axisLine={false} width={50} tickFormatter={(v) => `$${(v / 100).toFixed(0)}`} />
          )}
          <Tooltip
            content={(props) => {
              if (!props.active || !props.payload?.length) return null;
              const d = props.payload[0]?.payload;
              return (
                <div style={{ background: ct.tooltipBg, border: `1px solid ${ct.tooltipBorder}`, borderRadius: 8, padding: '10px 14px', fontSize: 13, color: ct.tooltipText, boxShadow: ct.tooltipShadow }}>
                  <div style={{ fontWeight: 600, marginBottom: 6, color: ct.tooltipLabel }}>{formatTooltipDate(d?.date)}</div>
                  {props.payload.filter(e => e.dataKey !== 'prevVisitors').map((entry, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', background: entry.color, display: 'inline-block' }} />
                      <span>{entry.name === 'revenue' ? `Revenue: $${(entry.value / 100).toFixed(2)}` : `Visitors: ${entry.value?.toLocaleString()}`}</span>
                    </div>
                  ))}
                  {hasCompare && d?.prevVisitors !== undefined && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, opacity: 0.7 }}>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', background: ct.axis, display: 'inline-block' }} />
                      <span>Previous: {d.prevVisitors?.toLocaleString()}</span>
                    </div>
                  )}
                  {d?.spikeSrc && d.spikeSrc !== 'Direct' && (
                    <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px solid ${ct.tooltipBorder}`, fontSize: 12, color: ct.tooltipLabel, fontStyle: 'italic' }}>
                      Traffic spike from <strong>{d.spikeSrc}</strong>
                    </div>
                  )}
                </div>
              );
            }}
          />
          {/* Annotation reference lines */}
          {annotations.map(ann => (
            <ReferenceLine
              key={ann.id}
              x={String(ann.date).slice(0, 10)}
              yAxisId="left"
              stroke="#f59e0b"
              strokeDasharray="4 2"
              strokeWidth={1.5}
              label={(props) => <AnnotationLabel {...props} note={ann.note} ct={ct} />}
            />
          ))}
          {hasRevenue && <Bar yAxisId="right" dataKey="revenue" fill={ct.barRevenue} radius={[4, 4, 0, 0]} barSize={20} opacity={0.75} />}
          {/* Previous period comparison line */}
          {hasCompare && (
            <Area yAxisId="left" type="monotone" dataKey="prevVisitors" stroke={ct.axis} strokeWidth={1.5} strokeDasharray="5 3" fill="none" dot={false} activeDot={false} name="Previous" />
          )}
          <Area yAxisId="left" type="monotone" dataKey="visitors" stroke={ct.line || '#3b82f6'} strokeWidth={2} fill="url(#visitorsGradient)" dot={(props) => <SpikeDot {...props} ct={ct} />} activeDot={{ r: 5, fill: ct.line || '#3b82f6' }} name="Visitors" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function formatTooltipDate(dateStr) {
  if (!dateStr) return '';
  if (dateStr.includes(' ')) return dateStr;
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' });
}

function toDateKey(d) {
  if (!d) return '';
  if (typeof d === 'string') return d.slice(0, 10);
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

function mergeByDate(traffic = [], revenue = [], dailySources = {}, compareData) {
  const map = {};
  for (const t of traffic) {
    const key = toDateKey(t.date);
    map[key] = { ...t, date: key, revenue: 0 };
  }
  for (const r of revenue) {
    const key = toDateKey(r.date);
    if (map[key]) map[key].revenue = r.revenue || 0;
    else map[key] = { date: key, visitors: 0, sessions: 0, revenue: r.revenue || 0 };
  }
  const entries = Object.values(map).sort((a, b) => a.date.localeCompare(b.date));
  const total = entries.reduce((s, e) => s + (e.visitors || 0), 0);
  const avg = entries.length > 0 ? total / entries.length : 0;
  const threshold = avg * 1.5;
  for (const entry of entries) {
    const src = dailySources[toDateKey(entry.date)];
    if (src && (entry.visitors || 0) > threshold && threshold > 0) entry.spikeSrc = src.source;
  }
  // Align comparison data by index position
  if (compareData && compareData.length > 0) {
    const sorted = [...compareData].sort((a, b) => toDateKey(a.date).localeCompare(toDateKey(b.date)));
    for (let i = 0; i < entries.length && i < sorted.length; i++) {
      entries[i].prevVisitors = sorted[i].visitors || 0;
    }
  }
  return entries;
}
