import { getRows } from '@/lib/db';
import { withAuth } from '@/lib/withAuth';
import { parseDateRange, verifySiteOwnership, getLinkedSiteIds } from '@/lib/analytics';
import { queryPeople } from '@/lib/people';
import { buildXlsx } from '@/lib/xlsx';

// Master Export: one .xlsx with decision-ready summaries plus the raw data
// (people, payments, sessions, events, page views) for a site and its connected sites.

export const config = { maxDuration: 60 };

// Vercel caps function responses at 4.5 MB. Nothing is dropped to fit: raw sheets
// (payments, sessions, events, page views) are paged, oldest first. Part 1 carries
// the summaries plus the first page; when more rows remain the response sets
// X-Export-Next-Offset and the client asks for the next part with ?offset=.
const MAX_BYTES = 4.2 * 1024 * 1024;
const PART_ROWS = 20000;

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
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  const slug = String(site.domain || site.name || `site-${siteId}`).replace(/[^a-z0-9.-]+/gi, '-');
  const baseName = `master-export-${slug}-${from}-to-${range.to}`;

  // Raw rows in a stable oldest-first order, so rows arriving mid-export land at
  // the end and never shift earlier pages. Fetches one extra row to detect more.
  const rawPage = (limit) => Promise.all([
    safe(getRows(
      `SELECT c.*, vi.email AS identified_email
       FROM conversions c
       LEFT JOIN LATERAL (
         SELECT email FROM visitor_identities
         WHERE site_id = c.site_id::text AND visitor_id = c.visitor_id
         ORDER BY created_at DESC LIMIT 1
       ) vi ON true
       WHERE c.${inRange('created_at')}
       ORDER BY c.created_at ASC, c.id ASC
       LIMIT ${limit + 1} OFFSET ${offset}`,
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
       ORDER BY s.started_at ASC, s.id ASC
       LIMIT ${limit + 1} OFFSET ${offset}`,
      p
    ).catch(async (err) => {
      if (err.code !== '42P01') throw err; // visitor_identities missing: export sessions alone
      return getRows(`SELECT * FROM sessions WHERE ${inRange('started_at')} ORDER BY started_at ASC, id ASC LIMIT ${limit + 1} OFFSET ${offset}`, p);
    }),
    safe(getRows(
      `SELECT * FROM events WHERE ${inRange('created_at')} ORDER BY created_at ASC, id ASC LIMIT ${limit + 1} OFFSET ${offset}`,
      p
    )),
    getRows(
      `SELECT * FROM page_views WHERE ${inRange('timestamp')} ORDER BY timestamp ASC, id ASC LIMIT ${limit + 1} OFFSET ${offset}`,
      p
    ),
  ]);

  // Builds the file for this part, halving the page size until it fits.
  const buildPart = async (leadSheets) => {
    let limit = PART_ROWS;
    for (;;) {
      const [payments, sessions, events, pageViews] = await rawPage(limit);
      const hasMore = [payments, sessions, events, pageViews].some((r) => r.length > limit);
      const cut = (rows) => rows.slice(0, limit);
      const file = buildXlsx([
        ...leadSheets,
        { name: 'Payments', rows: cut(payments) },
        { name: 'Sessions', rows: cut(sessions) },
        { name: 'Events', rows: cut(events) },
        { name: 'Page Views', rows: cut(pageViews) },
      ]);
      if (file.length <= MAX_BYTES || limit <= 250) return { file, nextOffset: hasMore ? offset + limit : null };
      limit = Math.floor(limit / 2);
    }
  };

  const send = ({ file, nextOffset }) => {
    const part = offset === 0 ? '' : `-rows-${offset + 1}`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}${part}.xlsx"`);
    res.setHeader('Access-Control-Expose-Headers', 'X-Export-Next-Offset, Content-Disposition');
    if (nextOffset != null) res.setHeader('X-Export-Next-Offset', String(nextOffset));
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(file);
  };

  // Continuation parts: raw rows only.
  if (offset > 0) {
    const info = [{ metric: 'Site', value: site.name || site.domain }, { metric: 'Date range', value: `${from} to ${range.to}` }, { metric: 'Raw rows starting at', value: offset + 1 }];
    return send(await buildPart([{ name: 'Part Info', columns: ['metric', 'value'], rows: info }]));
  }

  // Group sessions by an expression: every value, no top-N cut-off.
  const sessionBreakdown = (expr, label) => getRows(
    `SELECT ${expr} AS ${label},
            COUNT(*) AS sessions,
            COUNT(DISTINCT visitor_id) AS visitors,
            SUM(CASE WHEN is_bounce THEN 1 ELSE 0 END) AS bounces,
            ROUND(AVG(duration)) AS avg_duration_sec,
            SUM(page_count) AS page_views
     FROM sessions WHERE ${inRange('started_at')}
     GROUP BY 1 ORDER BY sessions DESC`,
    p
  );

  const [
    people,
    daily,
    sourceTraffic,
    sourceRevenue,
    revenueTotals,
    pages,
    entryPages,
    exitPages,
    referrers,
    campaigns,
    channels,
    countries,
    cities,
    browsers,
    os,
    devices,
    screens,
    eventNames,
    visitorTotals,
  ] = await Promise.all([
    safe(queryPeople(ids)),
    getRows(
      `SELECT * FROM daily_stats WHERE site_id::text = ANY(?) AND date BETWEEN ?::date AND ?::date ORDER BY date ASC, site_id`,
      [ids, from, range.to]
    ),
    sessionBreakdown(`COALESCE(utm_source, referrer_domain, 'Direct')`, 'source'),
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
    safe(getRows(
      `SELECT UPPER(COALESCE(NULLIF(currency, ''), 'N/A')) AS currency,
              COUNT(*) AS payments,
              SUM(amount) AS revenue
       FROM conversions WHERE ${inRange('created_at')} AND status = 'completed'
       GROUP BY 1`,
      p
    )),
    getRows(
      `SELECT pathname AS page,
              COUNT(*) AS views,
              COUNT(DISTINCT visitor_id) AS unique_visitors,
              COUNT(DISTINCT session_id) AS sessions,
              MIN(timestamp) AS first_viewed,
              MAX(timestamp) AS last_viewed
       FROM page_views WHERE ${inRange('timestamp')}
       GROUP BY pathname ORDER BY views DESC, pathname`,
      p
    ),
    sessionBreakdown(`COALESCE(entry_page, '(none)')`, 'entry_page'),
    sessionBreakdown(`COALESCE(exit_page, '(none)')`, 'exit_page'),
    sessionBreakdown(`COALESCE(NULLIF(referrer, ''), 'Direct')`, 'referrer'),
    getRows(
      `SELECT utm_source, utm_medium, utm_campaign, utm_term, utm_content,
              COUNT(*) AS sessions,
              COUNT(DISTINCT visitor_id) AS visitors,
              SUM(CASE WHEN is_bounce THEN 1 ELSE 0 END) AS bounces,
              SUM(page_count) AS page_views
       FROM sessions
       WHERE ${inRange('started_at')}
         AND (utm_source IS NOT NULL OR utm_medium IS NOT NULL OR utm_campaign IS NOT NULL OR utm_term IS NOT NULL OR utm_content IS NOT NULL)
       GROUP BY 1, 2, 3, 4, 5 ORDER BY sessions DESC`,
      p
    ),
    sessionBreakdown(`COALESCE(utm_medium, CASE WHEN referrer_domain IS NULL OR referrer_domain = '' THEN 'direct' ELSE 'referral' END)`, 'medium'),
    sessionBreakdown(`COALESCE(country, 'Unknown')`, 'country'),
    sessionBreakdown(`COALESCE(city, 'Unknown') || ', ' || COALESCE(country, 'Unknown')`, 'city'),
    sessionBreakdown(`COALESCE(browser, 'Unknown')`, 'browser'),
    sessionBreakdown(`COALESCE(os, 'Unknown')`, 'os'),
    sessionBreakdown(`COALESCE(device_type, 'Unknown')`, 'device'),
    sessionBreakdown(`COALESCE(screen_width::text || 'x' || screen_height::text, 'Unknown')`, 'screen'),
    safe(getRows(
      `SELECT name AS event,
              COUNT(*) AS count,
              COUNT(DISTINCT visitor_id) AS visitors,
              MIN(created_at) AS first_seen,
              MAX(created_at) AS last_seen
       FROM events WHERE ${inRange('created_at')}
       GROUP BY name ORDER BY count DESC`,
      p
    )),
    getRows(
      `SELECT COUNT(DISTINCT visitor_id) AS visitors,
              MIN(started_at) AS first_session,
              MAX(COALESCE(last_activity, started_at)) AS last_session
       FROM sessions WHERE ${inRange('started_at')}`,
      p
    ),
  ]);

  const num = (v) => Number(v) || 0;
  const withRates = (rows) => rows.map(({ bounces, ...r }) => ({
    ...r,
    sessions: num(r.sessions),
    visitors: num(r.visitors),
    page_views: num(r.page_views),
    bounce_rate_pct: pct(num(bounces), num(r.sessions)),
    avg_duration_sec: r.avg_duration_sec == null ? null : Number(r.avg_duration_sec),
  }));

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
      sessions: num(r.sessions),
      visitors: num(r.visitors),
      page_views: num(r.page_views),
      bounce_rate_pct: pct(num(r.bounces), num(r.sessions)),
      avg_duration_sec: r.avg_duration_sec == null ? null : Number(r.avg_duration_sec),
      payments: num(r.payments),
      customers: num(r.customers),
      revenue: num(r.revenue),
      currency: r.currency || null,
      visitor_to_customer_pct: pct(num(r.customers), num(r.visitors)),
      revenue_per_visitor: r.visitors ? Math.round((num(r.revenue) / Number(r.visitors)) * 100) / 100 : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue || b.sessions - a.sessions);

  // ---- Summary
  const totals = sourceTraffic.reduce(
    (t, r) => ({ sessions: t.sessions + num(r.sessions), bounces: t.bounces + num(r.bounces), pageViews: t.pageViews + num(r.page_views) }),
    { sessions: 0, bounces: 0, pageViews: 0 }
  );
  const totalPageViews = pages.reduce((t, r) => t + num(r.views), 0);
  const vt = visitorTotals[0] || {};
  const completedCount = revenueTotals.reduce((t, r) => t + num(r.payments), 0);
  const payingCustomers = sourceRevenue.reduce((t, r) => t + num(r.customers), 0);
  const activePeople = people.filter((r) => r.last_seen && new Date(r.last_seen) >= new Date(from)).length;
  const eventCount = eventNames.reduce((t, r) => t + num(r.count), 0);

  const summary = [
    { metric: 'Site', value: site.name || site.domain },
    { metric: 'Domain', value: site.domain },
    { metric: 'Site IDs included', value: ids.join(', ') },
    { metric: 'Date range', value: `${from} to ${range.to}` },
    { metric: 'Generated at (UTC)', value: new Date() },
    { metric: 'First session captured', value: vt.first_session ? new Date(vt.first_session) : '—' },
    { metric: 'Last activity captured', value: vt.last_session ? new Date(vt.last_session) : '—' },
    { metric: 'Unique visitors', value: num(vt.visitors) },
    { metric: 'Sessions', value: totals.sessions },
    { metric: 'Page views', value: totalPageViews || totals.pageViews },
    { metric: 'Distinct pages viewed', value: pages.length },
    { metric: 'Bounce rate %', value: pct(totals.bounces, totals.sessions) },
    { metric: 'Custom events', value: eventCount },
    { metric: 'Identified people (all time)', value: people.length },
    { metric: 'Identified people active in range', value: activePeople },
    { metric: 'Completed payments', value: completedCount },
    { metric: 'Paying customers (approx., by source)', value: payingCustomers },
    { metric: 'Visitor → customer %', value: pct(payingCustomers, num(vt.visitors)) },
    ...revenueTotals.map((r) => ({ metric: `Revenue (${r.currency})`, value: Math.round(num(r.revenue) * 100) / 100 })),
    { metric: 'Top source by revenue', value: sources.find((s) => s.revenue > 0)?.source || '—' },
    { metric: 'Top source by sessions', value: [...sources].sort((a, b) => b.sessions - a.sessions)[0]?.source || '—' },
    { metric: 'Top page', value: pages[0]?.page || '—' },
    { metric: 'Raw data', value: 'Payments, Sessions, Events and Page Views are exported oldest first. Large sites download as several numbered files — together they contain every row.' },
  ];

  const lead = [
    { name: 'Summary', columns: ['metric', 'value'], rows: summary },
    { name: 'Sources', rows: sources },
    { name: 'All Pages', rows: pages },
    { name: 'Entry Pages', rows: withRates(entryPages) },
    { name: 'Exit Pages', rows: withRates(exitPages) },
    { name: 'Referrers', rows: withRates(referrers) },
    { name: 'Channels', rows: withRates(channels) },
    { name: 'UTM Campaigns', rows: withRates(campaigns) },
    { name: 'Countries', rows: withRates(countries) },
    { name: 'Cities', rows: withRates(cities) },
    { name: 'Browsers', rows: withRates(browsers) },
    { name: 'OS', rows: withRates(os) },
    { name: 'Devices', rows: withRates(devices) },
    { name: 'Screens', rows: withRates(screens) },
    { name: 'Event Types', rows: eventNames },
    { name: 'People', rows: people },
    { name: 'Daily Stats', rows: daily },
  ];

  send(await buildPart(lead));
});
