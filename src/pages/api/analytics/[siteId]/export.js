import { getRows } from '@/lib/db';
import { withAuth } from '@/lib/withAuth';
import { parseDateRange, verifySiteOwnership, getLinkedSiteIds } from '@/lib/analytics';
import { queryPeople } from '@/lib/people';
import { buildXlsx } from '@/lib/xlsx';

// Master Export: one .xlsx with decision-ready summaries plus the raw data
// (people, payments, sessions, events, page views) for a site and its connected sites.

export const config = { maxDuration: 60 };

// Vercel caps function responses at 4.5 MB; stay under it by trimming raw sheets.
const MAX_BYTES = 4.2 * 1024 * 1024;
const RAW_ROW_CAP = 25000;

// Optional tables (created lazily elsewhere) may not exist yet: treat as empty.
async function safe(promise) {
  try {
    return await promise;
  } catch (err) {
    if (err.code === '42P01') return [];
    throw err;
  }
}

function pct(n, d) {
  return d ? Math.round((n / d) * 1000) / 10 : 0;
}

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { siteId } = req.query;
  const site = await verifySiteOwnership(siteId, req.user.userId);
  if (!site) return res.status(404).json({ error: 'Site not found' });

  const range = parseDateRange(req.query);
  const from = range.from;
  const to = range.to + ' 23:59:59';
  const ids = (await getLinkedSiteIds(siteId)).map(String);

  const inRange = (col) => `site_id::text = ANY(?) AND ${col} BETWEEN ? AND ?`;
  const p = [ids, from, to];

  const [
    people,
    payments,
    sessions,
    events,
    pageViews,
    daily,
    sourceTraffic,
    sourceRevenue,
    pages,
    countries,
  ] = await Promise.all([
    safe(queryPeople(ids)),
    safe(getRows(
      `SELECT c.*, vi.email AS identified_email
       FROM conversions c
       LEFT JOIN LATERAL (
         SELECT email FROM visitor_identities
         WHERE site_id = c.site_id::text AND visitor_id = c.visitor_id
         ORDER BY created_at DESC LIMIT 1
       ) vi ON true
       WHERE c.${inRange('created_at')}
       ORDER BY c.created_at DESC`,
      p
    )),
    getRows(
      `SELECT vi.email AS identified_email, s.*
       FROM sessions s
       LEFT JOIN LATERAL (
         SELECT email FROM visitor_identities
         WHERE site_id = s.site_id::text AND visitor_id = s.visitor_id
         ORDER BY created_at DESC LIMIT 1
       ) vi ON true
       WHERE s.${inRange('started_at')}
       ORDER BY s.started_at DESC
       LIMIT ${RAW_ROW_CAP + 1}`,
      p
    ).catch(async (err) => {
      if (err.code !== '42P01') throw err; // visitor_identities missing: export sessions alone
      return getRows(`SELECT * FROM sessions WHERE ${inRange('started_at')} ORDER BY started_at DESC LIMIT ${RAW_ROW_CAP + 1}`, p);
    }),
    safe(getRows(
      `SELECT * FROM events WHERE ${inRange('created_at')} ORDER BY created_at DESC LIMIT ${RAW_ROW_CAP + 1}`,
      p
    )),
    getRows(
      `SELECT * FROM page_views WHERE ${inRange('timestamp')} ORDER BY timestamp DESC LIMIT ${RAW_ROW_CAP + 1}`,
      p
    ),
    getRows(
      `SELECT * FROM daily_stats WHERE site_id::text = ANY(?) AND date BETWEEN ?::date AND ?::date ORDER BY date DESC, site_id`,
      [ids, from, range.to]
    ),
    getRows(
      `SELECT COALESCE(utm_source, referrer_domain, 'Direct') AS source,
              COUNT(*) AS sessions,
              COUNT(DISTINCT visitor_id) AS visitors,
              SUM(CASE WHEN is_bounce THEN 1 ELSE 0 END) AS bounces,
              ROUND(AVG(duration)) AS avg_duration_sec,
              SUM(page_count) AS page_views
       FROM sessions WHERE ${inRange('started_at')}
       GROUP BY 1`,
      p
    ),
    safe(getRows(
      `SELECT COALESCE(utm_source, referrer_domain, 'Direct') AS source,
              COUNT(*) AS payments,
              COUNT(DISTINCT COALESCE(stripe_customer_email, visitor_id)) AS customers,
              SUM(amount) AS revenue,
              MAX(currency) AS currency
       FROM conversions WHERE ${inRange('created_at')} AND status = 'completed'
       GROUP BY 1`,
      p
    )),
    getRows(
      `SELECT pathname AS page,
              COUNT(*) AS views,
              COUNT(DISTINCT visitor_id) AS unique_visitors,
              COUNT(DISTINCT session_id) AS sessions
       FROM page_views WHERE ${inRange('timestamp')}
       GROUP BY pathname ORDER BY views DESC LIMIT 1000`,
      p
    ),
    getRows(
      `SELECT COALESCE(country, 'Unknown') AS country,
              COUNT(*) AS sessions,
              COUNT(DISTINCT visitor_id) AS visitors,
              SUM(CASE WHEN is_bounce THEN 1 ELSE 0 END) AS bounces
       FROM sessions WHERE ${inRange('started_at')}
       GROUP BY 1 ORDER BY sessions DESC`,
      p
    ),
  ]);

  // ---- Sources: traffic joined with revenue, sorted by revenue then sessions
  const bySource = new Map();
  for (const r of sourceTraffic) bySource.set(r.source, { ...r });
  for (const r of sourceRevenue) {
    const row = bySource.get(r.source) || { source: r.source, sessions: 0, visitors: 0, bounces: 0, avg_duration_sec: null, page_views: 0 };
    bySource.set(r.source, { ...row, payments: r.payments, customers: r.customers, revenue: r.revenue, currency: r.currency });
  }
  const sources = [...bySource.values()]
    .map((r) => ({
      source: r.source,
      sessions: Number(r.sessions) || 0,
      visitors: Number(r.visitors) || 0,
      page_views: Number(r.page_views) || 0,
      bounce_rate_pct: pct(Number(r.bounces) || 0, Number(r.sessions) || 0),
      avg_duration_sec: r.avg_duration_sec == null ? null : Number(r.avg_duration_sec),
      payments: Number(r.payments) || 0,
      customers: Number(r.customers) || 0,
      revenue: Number(r.revenue) || 0,
      currency: r.currency || null,
      visitor_to_customer_pct: pct(Number(r.customers) || 0, Number(r.visitors) || 0),
      revenue_per_visitor: r.visitors ? Math.round(((Number(r.revenue) || 0) / Number(r.visitors)) * 100) / 100 : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue || b.sessions - a.sessions);

  const countryRows = countries.map((r) => ({
    country: r.country,
    sessions: Number(r.sessions),
    visitors: Number(r.visitors),
    bounce_rate_pct: pct(Number(r.bounces), Number(r.sessions)),
  }));

  // ---- Summary
  const totals = sourceTraffic.reduce(
    (t, r) => ({
      sessions: t.sessions + Number(r.sessions),
      bounces: t.bounces + Number(r.bounces),
      pageViews: t.pageViews + Number(r.page_views || 0),
    }),
    { sessions: 0, bounces: 0, pageViews: 0 }
  );
  const uniqueVisitors = (await getRows(
    `SELECT COUNT(DISTINCT visitor_id) AS n FROM sessions WHERE ${inRange('started_at')}`,
    p
  ))[0]?.n || 0;
  const completed = payments.filter((r) => r.status === 'completed');
  const revenueByCurrency = {};
  for (const r of completed) {
    const cur = (r.currency || '').toUpperCase() || 'N/A';
    revenueByCurrency[cur] = (revenueByCurrency[cur] || 0) + (Number(r.amount) || 0);
  }
  const payingCustomers = new Set(completed.map((r) => r.stripe_customer_email || r.identified_email || r.visitor_id)).size;
  const activePeople = people.filter((r) => r.last_seen && new Date(r.last_seen) >= new Date(from)).length;

  const summary = [
    { metric: 'Site', value: site.name || site.domain },
    { metric: 'Domain', value: site.domain },
    { metric: 'Site IDs included', value: ids.join(', ') },
    { metric: 'Date range', value: `${from} to ${range.to}` },
    { metric: 'Generated at (UTC)', value: new Date() },
    { metric: 'Unique visitors', value: uniqueVisitors },
    { metric: 'Sessions', value: totals.sessions },
    { metric: 'Page views', value: totals.pageViews },
    { metric: 'Bounce rate %', value: pct(totals.bounces, totals.sessions) },
    { metric: 'Identified people (all time)', value: people.length },
    { metric: 'Identified people active in range', value: activePeople },
    { metric: 'Completed payments', value: completed.length },
    { metric: 'Paying customers', value: payingCustomers },
    { metric: 'Visitor → customer %', value: pct(payingCustomers, uniqueVisitors) },
    ...Object.entries(revenueByCurrency).map(([cur, amt]) => ({ metric: `Revenue (${cur})`, value: Math.round(amt * 100) / 100 })),
    { metric: 'Top source by revenue', value: sources.find((s) => s.revenue > 0)?.source || '—' },
    { metric: 'Top source by sessions', value: [...sources].sort((a, b) => b.sessions - a.sessions)[0]?.source || '—' },
    { metric: 'Top page', value: pages[0]?.page || '—' },
  ];

  // ---- Build, trimming raw sheets if the file would be too large
  let cap = RAW_ROW_CAP;
  let file;
  for (let attempt = 0; attempt < 5; attempt++) {
    const notes = [];
    const trim = (rows, label) => {
      if (rows.length > cap) {
        notes.push({ metric: `Note: ${label}`, value: `Only the latest ${cap.toLocaleString()} rows included — narrow the date range for the full list` });
        return rows.slice(0, cap);
      }
      return rows;
    };
    const sheets = [
      { name: 'Sources', rows: sources },
      { name: 'People', rows: people },
      { name: 'Payments', rows: trim(payments, 'Payments') },
      { name: 'Sessions', rows: trim(sessions, 'Sessions') },
      { name: 'Events', rows: trim(events, 'Events') },
      { name: 'Page Views', rows: trim(pageViews, 'Page Views') },
      { name: 'Top Pages', rows: pages },
      { name: 'Countries', rows: countryRows },
      { name: 'Daily Stats', rows: daily },
    ];
    file = buildXlsx([{ name: 'Summary', columns: ['metric', 'value'], rows: [...summary, ...notes] }, ...sheets]);
    if (file.length <= MAX_BYTES) break;
    cap = Math.floor(cap / 2);
  }

  const slug = String(site.domain || site.name || `site-${siteId}`).replace(/[^a-z0-9.-]+/gi, '-');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="master-export-${slug}-${from}-to-${range.to}.xlsx"`);
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(file);
});
