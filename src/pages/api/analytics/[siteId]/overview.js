import { getRow, getRows } from '@/lib/db';
import { getDateRange } from '@/lib/analytics';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { siteId } = req.query;
  if (!siteId) return res.status(400).json({ error: 'siteId required' });

  // Public access: check if site has public analytics enabled
  const { withAuth } = await import('@/lib/withAuth');
  const { verifySiteOwnership } = await import('@/lib/analytics');

  // Try auth first, fall back to public
  let site;
  let isOwner = false;
  try {
    const user = await new Promise((resolve) => {
      const fakeRes = { status: () => ({ json: () => {} }) };
      const wrappedHandler = withAuth(async (req2) => { resolve(req2.user); });
      wrappedHandler(req, fakeRes).catch(() => resolve(null));
    });
    if (user) {
      site = await verifySiteOwnership(siteId, user.userId);
      isOwner = !!site;
    }
  } catch {}

  if (!site) {
    const { getRow: gr } = await import('@/lib/db');
    site = await gr('SELECT * FROM sites WHERE id = ? AND is_public = true', [siteId]);
  }

  if (!site) return res.status(404).json({ error: 'Not found' });

  const range = getDateRange(req.query.range, req.query.from, req.query.to);
  const dateEnd = range.to || new Date().toISOString();

  // Session-level filters (utm_source, referrer_domain, country, device_type, page_path)
  const sf = buildSessionFilters(req.query);
  const sfWhere = sf.params.length ? ` AND ${sf.clause}` : '';

  // For queries that alias sessions as 's'
  const sfAliased = buildSessionFilters(req.query, 's');
  const sfAliasedWhere = sfAliased.params.length ? ` AND ${sfAliased.clause}` : '';

  const useSessionFilters = sf.params.length > 0;

  // Page view filter
  const pvFilter = req.query.page_path;
  let pvSubquery = '';
  let pvSubParams = [];
  let pvFilterClause = '';
  let pvParams = [];
  let sessionJoinPv = '';
  if (pvFilter) {
    pvSubquery = ` AND id IN (SELECT session_id FROM page_views WHERE site_id = ? AND path = ?)`;
    pvSubParams = [siteId, pvFilter];
    pvFilterClause = ` AND s.id IN (SELECT session_id FROM page_views WHERE site_id = ? AND path = ?)`;
    pvParams = [siteId, pvFilter];
    sessionJoinPv = ` INNER JOIN page_views pv ON pv.session_id = s.id AND pv.site_id = s.site_id AND pv.path = ?`;
  }

  // ── Stats ──────────────────────────────────────────────────────────────────
  let statsPromise, bouncePromise;

  if (useSessionFilters || pvFilter) {
    const q = `SELECT COUNT(DISTINCT s.visitor_id) as total_visitors, COUNT(DISTINCT s.id) as total_sessions, COALESCE(SUM(s.page_count), 0) as total_page_views, COALESCE(SUM((COALESCE(s.is_bounce, s.page_count <= 1))::int), 0) as total_bounces, COALESCE(AVG(COALESCE(s.duration, 0)), 0) as avg_duration FROM sessions s ${sessionJoinPv} WHERE s.site_id = ? AND s.started_at BETWEEN ? AND ?${sfAliasedWhere}${pvFilterClause}`;
    const params = pvFilter
      ? [pvFilter, siteId, range.from, dateEnd, ...sfAliased.params, ...pvParams]
      : [siteId, range.from, dateEnd, ...sfAliased.params];
    statsPromise = getRow(q, params);
    bouncePromise = Promise.resolve(null);
  } else {
    const qCounts = `SELECT COALESCE(SUM(visitors), 0) as total_visitors, COALESCE(SUM(sessions), 0) as total_sessions, COALESCE(SUM(page_views), 0) as total_page_views FROM daily_stats WHERE site_id = ? AND date BETWEEN ? AND ?`;
    const qBounce = `SELECT COALESCE(SUM((COALESCE(is_bounce, page_count <= 1))::int), 0) as total_bounces, COALESCE(AVG(COALESCE(duration, 0)), 0) as avg_duration FROM sessions WHERE site_id = ? AND DATE(started_at) BETWEEN ? AND ?`;
    statsPromise = getRow(qCounts, [siteId, range.from, range.to || new Date().toISOString().slice(0, 10)]);
    bouncePromise = getRow(qBounce, [siteId, range.from, range.to || new Date().toISOString().slice(0, 10)]);
  }

  // ── Sources ────────────────────────────────────────────────────────────────
  const sourcesQ = useSessionFilters || pvFilter
    ? `SELECT COALESCE(s.utm_source, s.referrer_domain, 'Direct') as name, COUNT(DISTINCT s.id) as count, AVG((COALESCE(s.is_bounce, s.page_count <= 1))::int) as bounce_rate FROM sessions s ${sessionJoinPv} WHERE s.site_id = ? AND s.started_at BETWEEN ? AND ?${sfAliasedWhere}${pvFilterClause} GROUP BY name ORDER BY count DESC LIMIT 10`
    : `SELECT COALESCE(utm_source, referrer_domain, 'Direct') as name, COUNT(DISTINCT id) as count, AVG((COALESCE(is_bounce, page_count <= 1))::int) as bounce_rate FROM sessions WHERE site_id = ? AND started_at BETWEEN ? AND ?${sfWhere}${pvSubquery} GROUP BY name ORDER BY count DESC LIMIT 10`;
  const sourcesParams = useSessionFilters || pvFilter
    ? (pvFilter ? [pvFilter, siteId, range.from, dateEnd, ...sfAliased.params, ...pvParams] : [siteId, range.from, dateEnd, ...sfAliased.params])
    : [siteId, range.from, dateEnd, ...sf.params, ...pvSubParams];
  const sourcesPromise = getRows(sourcesQ, sourcesParams);

  // ── Entry Pages ────────────────────────────────────────────────────────────
  const entryQ = useSessionFilters || pvFilter
    ? `SELECT s.entry_page as name, COUNT(DISTINCT s.id) as count, AVG((COALESCE(s.is_bounce, s.page_count <= 1))::int) as bounce_rate FROM sessions s ${sessionJoinPv} WHERE s.site_id = ? AND s.started_at BETWEEN ? AND ? AND s.entry_page IS NOT NULL${sfAliasedWhere}${pvFilterClause} GROUP BY name ORDER BY count DESC LIMIT 10`
    : `SELECT entry_page as name, COUNT(DISTINCT id) as count, AVG((COALESCE(is_bounce, page_count <= 1))::int) as bounce_rate FROM sessions WHERE site_id = ? AND started_at BETWEEN ? AND ? AND entry_page IS NOT NULL${sfWhere}${pvSubquery} GROUP BY name ORDER BY count DESC LIMIT 10`;
  const entryParams = useSessionFilters || pvFilter
    ? (pvFilter ? [pvFilter, siteId, range.from, dateEnd, ...sfAliased.params, ...pvParams] : [siteId, range.from, dateEnd, ...sfAliased.params])
    : [siteId, range.from, dateEnd, ...sf.params, ...pvSubParams];
  const entryPagesPromise = getRows(entryQ, entryParams);

  const countriesPromise = sessQ(`site_id = ? AND started_at BETWEEN ? AND ? AND country IS NOT NULL AND country != ''`, [siteId, range.from, dateEnd, ...sf.params, ...pvSubParams], useSessionFilters || pvFilter ? null : undefined);
  const browsersPromise = sessQ(`site_id = ? AND started_at BETWEEN ? AND ? AND browser IS NOT NULL AND browser != ''`, [siteId, range.from, dateEnd, ...sf.params, ...pvSubParams], useSessionFilters || pvFilter ? null : undefined);
  const osPromise = sessQ(`site_id = ? AND started_at BETWEEN ? AND ? AND os IS NOT NULL AND os != ''`, [siteId, range.from, dateEnd, ...sf.params, ...pvSubParams], useSessionFilters || pvFilter ? null : undefined);
  const devicesPromise = sessQ(`site_id = ? AND started_at BETWEEN ? AND ? AND device_type IS NOT NULL AND device_type != ''`, [siteId, range.from, dateEnd, ...sf.params, ...pvSubParams], useSessionFilters || pvFilter ? null : undefined);

  // ── Conversions ────────────────────────────────────────────────────────────
  let convTotalsPromise, convBySourcePromise, convTimeSeriesPromise;
  if (useSessionFilters) {
    convTotalsPromise = getRow(`SELECT COUNT(*) as total_conversions, COALESCE(SUM(c.amount), 0) as total_revenue, COALESCE(AVG(c.amount), 0) as avg_value FROM conversions c INNER JOIN sessions s ON s.site_id = c.site_id AND s.id = c.session_id WHERE c.site_id = ? AND c.status = 'completed' AND c.created_at BETWEEN ? AND ?${sfAliasedWhere}`, [siteId, range.from, dateEnd, ...sfAliased.params]);
    convBySourcePromise = getRows(`SELECT COALESCE(s.utm_source, s.referrer_domain, 'Direct') as name, COUNT(*) as conversions, SUM(c.amount) as revenue FROM conversions c INNER JOIN sessions s ON s.site_id = c.site_id AND s.id = c.session_id WHERE c.site_id = ? AND c.status = 'completed' AND c.created_at BETWEEN ? AND ?${sfAliasedWhere} GROUP BY name ORDER BY revenue DESC LIMIT 10`, [siteId, range.from, dateEnd, ...sfAliased.params]);
    convTimeSeriesPromise = getRows(`SELECT DATE(c.created_at) as date, COUNT(*) as conversions, SUM(c.amount) as revenue FROM conversions c INNER JOIN sessions s ON s.site_id = c.site_id AND s.id = c.session_id WHERE c.site_id = ? AND c.status = 'completed' AND c.created_at BETWEEN ? AND ?${sfAliasedWhere} GROUP BY date ORDER BY date ASC`, [siteId, range.from, dateEnd, ...sfAliased.params]);
  } else {
    convTotalsPromise = getRow(`SELECT COUNT(*) as total_conversions, COALESCE(SUM(amount), 0) as total_revenue, COALESCE(AVG(amount), 0) as avg_value FROM conversions WHERE site_id = ? AND status = 'completed' AND created_at BETWEEN ? AND ?`, [siteId, range.from, dateEnd]);
    convBySourcePromise = getRows(`SELECT COALESCE(utm_source, referrer_domain, 'Direct') as name, COUNT(*) as conversions, SUM(amount) as revenue FROM conversions WHERE site_id = ? AND status = 'completed' AND created_at BETWEEN ? AND ? GROUP BY name ORDER BY revenue DESC LIMIT 10`, [siteId, range.from, dateEnd]);
    convTimeSeriesPromise = getRows(`SELECT DATE(created_at) as date, COUNT(*) as conversions, SUM(amount) as revenue FROM conversions WHERE site_id = ? AND status = 'completed' AND created_at BETWEEN ? AND ? GROUP BY date ORDER BY date ASC`, [siteId, range.from, dateEnd]);
  }

  const affiliateBreakdownPromise = getRows(`SELECT a.name, a.slug, COALESCE(v.visits, 0) as visits, COALESCE(c.conversions, 0) as conversions, COALESCE(c.revenue, 0) as revenue FROM affiliates a LEFT JOIN (SELECT affiliate_id, COUNT(*) as visits FROM affiliate_visits WHERE site_id = ? AND landed_at BETWEEN ? AND ? GROUP BY affiliate_id) v ON v.affiliate_id = a.id LEFT JOIN (SELECT affiliate_id, COUNT(*) as conversions, SUM(amount) as revenue FROM conversions WHERE site_id = ? AND status = 'completed' AND created_at BETWEEN ? AND ? GROUP BY affiliate_id) c ON c.affiliate_id = a.id WHERE a.site_id = ? ORDER BY COALESCE(c.revenue, 0) DESC, COALESCE(v.visits, 0) DESC LIMIT 10`, [siteId, range.from, dateEnd, siteId, range.from, dateEnd, siteId]);

  const rawDailySourcesPromise = getRows(`SELECT DATE(started_at) as date, COALESCE(utm_source, referrer_domain, 'Direct') as source, COUNT(*) as count FROM sessions WHERE site_id = ? AND started_at BETWEEN ? AND ?${sfWhere}${pvSubquery} GROUP BY DATE(started_at), COALESCE(utm_source, referrer_domain, 'Direct') ORDER BY date, count DESC`, [siteId, range.from, dateEnd, ...sf.params, ...pvSubParams]);

  const newReturningPromise = getRow(`
    WITH period_vids AS (
      SELECT DISTINCT visitor_id FROM sessions WHERE site_id = ? AND started_at BETWEEN ? AND ?${pvSubquery}
    )
    SELECT
      COUNT(CASE WHEN NOT EXISTS (
        SELECT 1 FROM sessions s2 WHERE s2.site_id = ? AND s2.visitor_id = pv.visitor_id AND s2.started_at < ?
      ) THEN 1 END) as new_visitors,
      COUNT(CASE WHEN EXISTS (
        SELECT 1 FROM sessions s2 WHERE s2.site_id = ? AND s2.visitor_id = pv.visitor_id AND s2.started_at < ?
      ) THEN 1 END) as returning_visitors
    FROM period_vids pv
  `, [siteId, range.from, dateEnd, ...pvSubParams, siteId, range.from, siteId, range.from]).catch(() => null);

  // ── Page Views ─────────────────────────────────────────────────────────────
  const pageViewsPromise = getRows(
    `SELECT path as name, COUNT(*) as count FROM page_views WHERE site_id = ? AND viewed_at BETWEEN ? AND ?${pvFilter ? " AND path = ?" : ""} GROUP BY path ORDER BY count DESC LIMIT 20`,
    pvFilter ? [siteId, range.from, dateEnd, pvFilter] : [siteId, range.from, dateEnd]
  );

  // ── Time Series ────────────────────────────────────────────────────────────
  let timeSeriesPromise;
  if (range.label === '1D') {
    timeSeriesPromise = getRows(`SELECT TO_CHAR(s.started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24":00"') as date, COUNT(DISTINCT s.id) as sessions, COUNT(DISTINCT s.visitor_id) as visitors, COALESCE(SUM(s.page_count), 0) as page_views FROM sessions s ${sessionJoinPv} WHERE s.site_id = ? AND s.started_at >= NOW() - INTERVAL '24 hours'${sfAliasedWhere}${pvFilterClause} GROUP BY date ORDER BY date ASC`, pvFilter ? [pvFilter, siteId, ...sfAliased.params, ...pvParams] : [siteId, ...sfAliased.params, ...pvParams]);
  } else {
    timeSeriesPromise = getRows(`SELECT DATE(s.started_at) as date, COUNT(DISTINCT s.visitor_id) as visitors, COUNT(DISTINCT s.id) as sessions, COALESCE(SUM(s.page_count), 0) as page_views FROM sessions s ${sessionJoinPv} WHERE s.site_id = ? AND s.started_at BETWEEN ? AND ?${sfAliasedWhere}${pvFilterClause} GROUP BY date ORDER BY date ASC`, pvFilter ? [pvFilter, siteId, range.from, dateEnd, ...sfAliased.params, ...pvParams] : [siteId, range.from, dateEnd, ...sfAliased.params, ...pvParams]);
  }

  // ── Await all ──────────────────────────────────────────────────────────────
  const [
    stats, bounceStats, sources, entryPages, convTotals, convBySource, convTimeSeries,
    affiliateBreakdown, rawDailySources, newReturning, pageViewsData, timeSeries
  ] = await Promise.all([
    statsPromise, bouncePromise, sourcesPromise, entryPagesPromise,
    convTotalsPromise, convBySourcePromise, convTimeSeriesPromise,
    affiliateBreakdownPromise, rawDailySourcesPromise, newReturningPromise,
    pageViewsPromise, timeSeriesPromise
  ]);

  const totalBounces = bounceStats ? Number(bounceStats.total_bounces) : Number(stats?.total_bounces || 0);
  const avgDuration = bounceStats ? Number(bounceStats.avg_duration) : Number(stats?.avg_duration || 0);
  const totalSessions = Number(stats?.total_sessions || 0);
  const bounceRate = totalSessions > 0 ? (totalBounces / totalSessions) * 100 : 0;

  // Build daily sources map
  const dailySourcesMap = {};
  for (const row of rawDailySources || []) {
    const d = String(row.date).slice(0, 10);
    if (!dailySourcesMap[d]) dailySourcesMap[d] = {};
    dailySourcesMap[d][row.source] = Number(row.count);
  }

  // Merge time series with daily sources
  const mergedTimeSeries = (timeSeries || []).map(row => {
    const d = String(row.date).slice(0, 10);
    return { ...row, sources: dailySourcesMap[d] || {} };
  });

  function mergeSources(rows, key) {
    const map = {};
    for (const row of rows || []) {
      const name = row.name;
      if (!map[name]) map[name] = { name, count: 0, conversions: 0, revenue: 0, bounce_rate: null };
      const ex = map[name];
      if ('count' in row) ex.count = Number(ex.count) + Number(row.count);
      if ('conversions' in row) ex.conversions = Number(ex.conversions) + Number(row.conversions);
      if ('revenue' in row) ex.revenue = Number(ex.revenue) + Number(row.revenue);
      if ('bounce_rate' in row) ex.bounce_rate = Number(row.bounce_rate);
    }
    return Object.values(map).sort((a, b) => b[key] - a[key]);
  }

  const convRate = totalSessions > 0
    ? ((Number(convTotals?.total_conversions || 0) / totalSessions) * 100).toFixed(2)
    : '0.00';

  const countries = await sessQRaw(`site_id = ? AND started_at BETWEEN ? AND ? AND country IS NOT NULL AND country != ''`, [siteId, range.from, dateEnd, ...sf.params, ...pvSubParams], useSessionFilters || pvFilter);
  const browsers = await sessQRaw(`site_id = ? AND started_at BETWEEN ? AND ? AND browser IS NOT NULL AND browser != ''`, [siteId, range.from, dateEnd, ...sf.params, ...pvSubParams], useSessionFilters || pvFilter);
  const os = await sessQRaw(`site_id = ? AND started_at BETWEEN ? AND ? AND os IS NOT NULL AND os != ''`, [siteId, range.from, dateEnd, ...sf.params, ...pvSubParams], useSessionFilters || pvFilter);
  const devices = await sessQRaw(`site_id = ? AND started_at BETWEEN ? AND ? AND device_type IS NOT NULL AND device_type != ''`, [siteId, range.from, dateEnd, ...sf.params, ...pvSubParams], useSessionFilters || pvFilter);

  return res.json({
    range: { from: range.from, to: dateEnd, label: range.label },
    stats: {
      totalVisitors: Number(stats?.total_visitors || 0),
      totalSessions,
      totalPageViews: Number(stats?.total_page_views || 0),
      bounceRate: parseFloat(bounceRate.toFixed(1)),
      avgDuration: Math.round(avgDuration),
    },
    sources: mergeSources([...( sources || []), ...(convBySource || [])], 'count'),
    entryPages: (entryPages || []).map(r => ({ ...r, count: Number(r.count), bounce_rate: Number(r.bounce_rate) })),
    countries: countries || [],
    browsers: browsers || [],
    os: os || [],
    devices: devices || [],
    conversions: { totals: { conversions: convTotals.total_conversions, revenue: convTotals.total_revenue, avgValue: Math.round(convTotals.avg_value), conversionRate: parseFloat(convRate) }, bySource: mergeSources(convBySource, 'conversions'), timeSeries: convTimeSeries },
    affiliates: affiliateBreakdown || [],
    pageViews: pageViewsData || [],
    timeSeries: mergedTimeSeries,
    newReturning: newReturning || { new_visitors: 0, returning_visitors: 0 },
    isOwner,
  });
}

function buildSessionFilters(query, alias) {
  const filters = [];
  const params = [];
  const a = alias ? `${alias}.` : '';

  if (query.utm_source) { filters.push(`${a}utm_source = ?`); params.push(query.utm_source); }
  if (query.referrer_domain) { filters.push(`${a}referrer_domain = ?`); params.push(query.referrer_domain); }
  if (query.country) { filters.push(`${a}country = ?`); params.push(query.country); }
  if (query.device_type) { filters.push(`${a}device_type = ?`); params.push(query.device_type); }

  return { clause: filters.join(' AND '), params };
}

async function sessQ(where, params, alias) {
  // Kept for compatibility — real queries use inline SQL now
  return [];
}

async function sessQRaw(where, allParams, hasFilters) {
  // Extract the base params (siteId, from, dateEnd) and any extras
  const [siteId, from, dateEnd, ...extra] = allParams;
  const extraWhere = extra.length ? '' : '';
  const rows = await getRows(
    `SELECT ${where.includes('country') ? 'country' : where.includes('browser') ? 'browser' : where.includes('os') ? 'os' : 'device_type'} as name, COUNT(DISTINCT id) as count FROM sessions WHERE ${where} GROUP BY name ORDER BY count DESC LIMIT 10`,
    allParams
  );
  return rows;
}
