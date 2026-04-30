import { getRow, getRows } from '@/lib/db';
import { withAuth } from '@/lib/withAuth';
import { parseDateRange, verifySiteOwnership } from '@/lib/analytics';

function buildSessionFilters(query, alias = '') {
  const pfx = alias ? `${alias}.` : '';
  const clauses = [];
  const params = [];

  if (query.channel) {
    if (query.channel === 'Direct') {
      clauses.push(`(${pfx}utm_source IS NULL AND (${pfx}referrer_domain IS NULL OR ${pfx}referrer_domain = ''))`);
    } else {
      clauses.push(`(${pfx}utm_source = ? OR ${pfx}referrer_domain = ?)`);
      params.push(query.channel, query.channel);
    }
  }
  if (query.country) {
    clauses.push(`${pfx}country = ?`);
    params.push(query.country);
  }
  if (query.city) {
    clauses.push(`${pfx}city = ?`);
    params.push(query.city);
  }
  if (query.entry_page) {
    clauses.push(`${pfx}entry_page = ?`);
    params.push(query.entry_page);
  }
  if (query.exit_page) {
    clauses.push(`${pfx}exit_page = ?`);
    params.push(query.exit_page);
  }
  if (query.browser) {
    clauses.push(`${pfx}browser = ?`);
    params.push(query.browser);
  }
  if (query.os) {
    clauses.push(`${pfx}os = ?`);
    params.push(query.os);
  }
  if (query.device) {
    clauses.push(`${pfx}device_type = ?`);
    params.push(query.device);
  }

  return { clauses, params };
}

function buildPageViewFilters(query) {
  const clauses = [];
  const params = [];

  if (query.page) {
    clauses.push(`pathname = ?`);
    params.push(query.page);
  }

  return { clauses, params };
}

function hasSessionFilters(query) {
  return query.channel || query.country || query.city || query.entry_page ||
    query.exit_page || query.browser || query.os || query.device;
}

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { siteId } = req.query;
  const site = await verifySiteOwnership(siteId, req.user.userId);
  if (!site) return res.status(404).json({ error: 'Site not found' });

  const range = parseDateRange(req.query);
  const dateEnd = range.to + ' 23:59:59';

  // Previous period for comparison
  const fromDate = new Date(range.from);
  const toDate = new Date(range.to);
  const daysDiff = Math.ceil((toDate - fromDate) / (1000 * 60 * 60 * 24));
  const prevFrom = new Date(fromDate);
  prevFrom.setDate(prevFrom.getDate() - daysDiff);
  const prevRange = {
    from: prevFrom.toISOString().slice(0, 10),
    to: new Date(fromDate.getTime() - 86400000).toISOString().slice(0, 10),
  };

  const sf = buildSessionFilters(req.query);
  const sfAliased = buildSessionFilters(req.query, 's');
  const pvf = buildPageViewFilters(req.query);
  const useSessionFilters = hasSessionFilters(req.query);
  const usePageFilter = !!req.query.page;

  const sfWhere = sf.clauses.length > 0 ? ' AND ' + sf.clauses.join(' AND ') : '';
  const sfAliasedWhere = sfAliased.clauses.length > 0 ? ' AND ' + sfAliased.clauses.join(' AND ') : '';
  const pvfWhere = pvf.clauses.length > 0 ? ' AND ' + pvf.clauses.join(' AND ') : '';

  // Current period totals — when filters are active, compute from sessions table
  let current, previous;
  if (useSessionFilters || usePageFilter) {
    const sessionJoinPv = usePageFilter
      ? `INNER JOIN page_views pv ON pv.site_id = s.site_id AND pv.session_id = s.id`
      : '';
    const pvFilterClause = usePageFilter ? ` AND pv.pathname = ?` : '';
    const pvParams = usePageFilter ? [req.query.page] : [];

    [current, previous] = await Promise.all([
      getRow(
        `SELECT
          COUNT(DISTINCT s.visitor_id) as total_visitors,
          COUNT(DISTINCT s.id) as total_sessions,
          COALESCE(SUM(s.page_count), 0) as total_page_views,
          COALESCE(SUM(s.is_bounce::int), 0) as total_bounces,
          COALESCE(AVG(s.duration), 0) as avg_duration
         FROM sessions s
         ${sessionJoinPv}
         WHERE s.site_id = ? AND s.started_at BETWEEN ? AND ?${sfAliasedWhere}${pvFilterClause}`,
        [siteId, range.from, dateEnd, ...sfAliased.params, ...pvParams]
      ),
      getRow(
        `SELECT
          COUNT(DISTINCT s.visitor_id) as total_visitors,
          COUNT(DISTINCT s.id) as total_sessions,
          COALESCE(SUM(s.page_count), 0) as total_page_views,
          COALESCE(SUM(s.is_bounce::int), 0) as total_bounces,
          COALESCE(AVG(s.duration), 0) as avg_duration
         FROM sessions s
         ${sessionJoinPv}
         WHERE s.site_id = ? AND s.started_at BETWEEN ? AND ?${sfAliasedWhere}${pvFilterClause}`,
        [siteId, prevRange.from, prevRange.to + ' 23:59:59', ...sfAliased.params, ...pvParams]
      ),
    ]);
  } else {
    [current, previous] = await Promise.all([
      getRow(
        `SELECT
          COALESCE(SUM(visitors), 0) as total_visitors,
          COALESCE(SUM(sessions), 0) as total_sessions,
          COALESCE(SUM(page_views), 0) as total_page_views,
          COALESCE(SUM(bounces), 0) as total_bounces,
          COALESCE(AVG(avg_duration), 0) as avg_duration
         FROM daily_stats
         WHERE site_id = ? AND date BETWEEN ? AND ?`,
        [siteId, range.from, range.to]
      ),
      getRow(
        `SELECT
          COALESCE(SUM(visitors), 0) as total_visitors,
          COALESCE(SUM(sessions), 0) as total_sessions,
          COALESCE(SUM(page_views), 0) as total_page_views,
          COALESCE(SUM(bounces), 0) as total_bounces,
          COALESCE(AVG(avg_duration), 0) as avg_duration
         FROM daily_stats
         WHERE site_id = ? AND date BETWEEN ? AND ?`,
        [siteId, prevRange.from, prevRange.to]
      ),
    ]);
  }

  const bounceRate =
    current.total_sessions > 0
      ? ((current.total_bounces / current.total_sessions) * 100).toFixed(1)
      : 0;
  const prevBounceRate =
    previous.total_sessions > 0
      ? ((previous.total_bounces / previous.total_sessions) * 100).toFixed(1)
      : 0;

  // Helper: apply session filters to a sessions-based query (returns Promise)
  const sessQ = (baseWhere, baseParams, select, groupOrder) => {
    return getRows(
      `${select} FROM sessions WHERE ${baseWhere}${sfWhere} ${groupOrder}`,
      [...baseParams, ...sf.params]
    );
  };

  // Time series — when filters active, build from sessions
  let timeSeriesPromise;
  if (useSessionFilters || usePageFilter) {
    const sessionJoinPv = usePageFilter
      ? `INNER JOIN page_views pv ON pv.site_id = s.site_id AND pv.session_id = s.id`
      : '';
    const pvFilterClause = usePageFilter ? ` AND pv.pathname = ?` : '';
    const pvParams = usePageFilter ? [req.query.page] : [];

    if (req.query.period === '24h') {
      timeSeriesPromise = getRows(
        `SELECT TO_CHAR(s.started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24":00"') as date,
                COUNT(DISTINCT s.id) as sessions,
                COUNT(DISTINCT s.visitor_id) as visitors,
                COALESCE(SUM(s.page_count), 0) as page_views
         FROM sessions s
         ${sessionJoinPv}
         WHERE s.site_id = ? AND s.started_at >= NOW() - INTERVAL '24 hours'${sfAliasedWhere}${pvFilterClause}
         GROUP BY date ORDER BY date ASC`,
        [siteId, ...sfAliased.params, ...pvParams]
      );
    } else {
      timeSeriesPromise = getRows(
        `SELECT DATE(s.started_at) as date,
                COUNT(DISTINCT s.visitor_id) as visitors,
                COUNT(DISTINCT s.id) as sessions,
                COALESCE(SUM(s.page_count), 0) as page_views
         FROM sessions s
         ${sessionJoinPv}
         WHERE s.site_id = ? AND s.started_at BETWEEN ? AND ?${sfAliasedWhere}${pvFilterClause}
         GROUP BY date ORDER BY date ASC`,
        [siteId, range.from, dateEnd, ...sfAliased.params, ...pvParams]
      );
    }
  } else {
    if (req.query.period === '24h') {
      timeSeriesPromise = getRows(
        `SELECT TO_CHAR(timestamp AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24":00"') as date,
                COUNT(*) as page_views,
                COUNT(DISTINCT visitor_id) as visitors
         FROM page_views
         WHERE site_id = ? AND timestamp >= NOW() - INTERVAL '24 hours'
         GROUP BY date ORDER BY date ASC`,
        [siteId]
      );
    } else {
      timeSeriesPromise = getRows(
        `SELECT date, visitors, sessions, page_views
         FROM daily_stats
         WHERE site_id = ? AND date BETWEEN ? AND ?
         ORDER BY date ASC`,
        [siteId, range.from, range.to]
      );
    }
  }

  // --- Sources ---
  const sourcesPromise = sessQ(
    `site_id = ? AND started_at BETWEEN ? AND ?`,
    [siteId, range.from, dateEnd],
    `SELECT COALESCE(utm_source, referrer_domain, 'Direct') as name,
      COUNT(*) as sessions,
      COUNT(DISTINCT visitor_id) as visitors,
      ROUND(AVG(is_bounce::float) * 100, 1) as bounce_rate`,
    `GROUP BY name ORDER BY sessions DESC LIMIT 20`
  );

  // --- Pages (from page_views, needs session join for filters) ---
  let pagesPromise;
  if (useSessionFilters) {
    pagesPromise = getRows(
      `SELECT pv.pathname as name, COUNT(*) as views,
        COUNT(DISTINCT pv.visitor_id) as visitors
       FROM page_views pv
       INNER JOIN sessions s ON s.site_id = pv.site_id AND s.id = pv.session_id
       WHERE pv.site_id = ? AND pv.timestamp BETWEEN ? AND ?${sfAliasedWhere}${pvfWhere}
       GROUP BY pv.pathname ORDER BY views DESC LIMIT 20`,
      [siteId, range.from, dateEnd, ...sfAliased.params, ...pvf.params]
    );
  } else {
    pagesPromise = getRows(
      `SELECT pathname as name, COUNT(*) as views,
        COUNT(DISTINCT visitor_id) as visitors
       FROM page_views
       WHERE site_id = ? AND timestamp BETWEEN ? AND ?${pvfWhere}
       GROUP BY pathname ORDER BY views DESC LIMIT 20`,
      [siteId, range.from, dateEnd, ...pvf.params]
    );
  }

  const entryPagesPromise = sessQ(
    `site_id = ? AND started_at BETWEEN ? AND ?`,
    [siteId, range.from, dateEnd],
    `SELECT entry_page as name, COUNT(*) as sessions,
      ROUND(AVG(is_bounce::float) * 100, 1) as bounce_rate`,
    `GROUP BY entry_page ORDER BY sessions DESC LIMIT 10`
  );

  const exitPagesPromise = sessQ(
    `site_id = ? AND started_at BETWEEN ? AND ?`,
    [siteId, range.from, dateEnd],
    `SELECT exit_page as name, COUNT(*) as sessions`,
    `GROUP BY exit_page ORDER BY sessions DESC LIMIT 10`
  );

  // --- Geography ---
  const countriesPromise = sessQ(
    `site_id = ? AND started_at BETWEEN ? AND ? AND country IS NOT NULL AND country != ''`,
    [siteId, range.from, dateEnd],
    `SELECT country as name, COUNT(*) as count`,
    `GROUP BY country ORDER BY count DESC LIMIT 20`
  );

  const citiesPromise = sessQ(
    `site_id = ? AND started_at BETWEEN ? AND ? AND city IS NOT NULL AND city != ''`,
    [siteId, range.from, dateEnd],
    `SELECT city as name, COUNT(*) as count`,
    `GROUP BY city ORDER BY count DESC LIMIT 20`
  );

  // --- Tech ---
  const browsersPromise = sessQ(
    `site_id = ? AND started_at BETWEEN ? AND ? AND browser IS NOT NULL AND browser != ''`,
    [siteId, range.from, dateEnd],
    `SELECT browser as name, COUNT(*) as count`,
    `GROUP BY browser ORDER BY count DESC LIMIT 10`
  );

  const osPromise = sessQ(
    `site_id = ? AND started_at BETWEEN ? AND ? AND os IS NOT NULL AND os != ''`,
    [siteId, range.from, dateEnd],
    `SELECT os as name, COUNT(*) as count`,
    `GROUP BY os ORDER BY count DESC LIMIT 10`
  );

  const devicesPromise = sessQ(
    `site_id = ? AND started_at BETWEEN ? AND ? AND device_type IS NOT NULL AND device_type != ''`,
    [siteId, range.from, dateEnd],
    `SELECT device_type as name, COUNT(*) as count`,
    `GROUP BY device_type ORDER BY count DESC LIMIT 10`
  );

  // --- Conversions (apply session filters via join) ---
  let convTotalsPromise, convBySourcePromise, convTimeSeriesPromise;

  if (useSessionFilters) {
    convTotalsPromise = getRow(
      `SELECT
        COUNT(*) as total_conversions,
        COALESCE(SUM(c.amount), 0) as total_revenue,
        COALESCE(AVG(c.amount), 0) as avg_value
       FROM conversions c
       INNER JOIN sessions s ON s.site_id = c.site_id AND s.id = c.session_id
       WHERE c.site_id = ? AND c.status = 'completed'
       AND c.created_at BETWEEN ? AND ?${sfAliasedWhere}`,
      [siteId, range.from, dateEnd, ...sfAliased.params]
    );

    convBySourcePromise = getRows(
      `SELECT COALESCE(s.utm_source, s.referrer_domain, 'Direct') as name,
        COUNT(*) as conversions,
        SUM(c.amount) as revenue
       FROM conversions c
       INNER JOIN sessions s ON s.site_id = c.site_id AND s.id = c.session_id
       WHERE c.site_id = ? AND c.status = 'completed'
       AND c.created_at BETWEEN ? AND ?${sfAliasedWhere}
       GROUP BY name ORDER BY revenue DESC LIMIT 10`,
      [siteId, range.from, dateEnd, ...sfAliased.params]
    );

    convTimeSeriesPromise = getRows(
      `SELECT DATE(c.created_at) as date,
        COUNT(*) as conversions,
        SUM(c.amount) as revenue
       FROM conversions c
       INNER JOIN sessions s ON s.site_id = c.site_id AND s.id = c.session_id
       WHERE c.site_id = ? AND c.status = 'completed'
       AND c.created_at BETWEEN ? AND ?${sfAliasedWhere}
       GROUP BY date ORDER BY date ASC`,
      [siteId, range.from, dateEnd, ...sfAliased.params]
    );
  } else {
    convTotalsPromise = getRow(
      `SELECT
        COUNT(*) as total_conversions,
        COALESCE(SUM(amount), 0) as total_revenue,
        COALESCE(AVG(amount), 0) as avg_value
       FROM conversions
       WHERE site_id = ? AND status = 'completed'
       AND created_at BETWEEN ? AND ?`,
      [siteId, range.from, dateEnd]
    );

    convBySourcePromise = getRows(
      `SELECT COALESCE(utm_source, referrer_domain, 'Direct') as name,
        COUNT(*) as conversions,
        SUM(amount) as revenue
       FROM conversions
       WHERE site_id = ? AND status = 'completed'
       AND created_at BETWEEN ? AND ?
       GROUP BY name ORDER BY revenue DESC LIMIT 10`,
      [siteId, range.from, dateEnd]
    );

    convTimeSeriesPromise = getRows(
      `SELECT DATE(created_at) as date,
        COUNT(*) as conversions,
        SUM(amount) as revenue
       FROM conversions
       WHERE site_id = ? AND status = 'completed'
       AND created_at BETWEEN ? AND ?
       GROUP BY date ORDER BY date ASC`,
      [siteId, range.from, dateEnd]
    );
  }

  // --- Affiliates ---
  const affiliateBreakdownPromise = getRows(
    `SELECT a.name, a.slug,
      COALESCE(v.visits, 0) as visits,
      COALESCE(c.conversions, 0) as conversions,
      COALESCE(c.revenue, 0) as revenue
     FROM affiliates a
     LEFT JOIN (
       SELECT affiliate_id, COUNT(*) as visits
       FROM affiliate_visits
       WHERE site_id = ? AND landed_at BETWEEN ? AND ?
       GROUP BY affiliate_id
     ) v ON v.affiliate_id = a.id
     LEFT JOIN (
       SELECT affiliate_id, COUNT(*) as conversions, SUM(amount) as revenue
       FROM conversions
       WHERE site_id = ? AND status = 'completed'
         AND created_at BETWEEN ? AND ?
       GROUP BY affiliate_id
     ) c ON c.affiliate_id = a.id
     WHERE a.site_id = ?
     ORDER BY COALESCE(c.revenue, 0) DESC, COALESCE(v.visits, 0) DESC
     LIMIT 10`,
    [siteId, range.from, dateEnd, siteId, range.from, dateEnd, siteId]
  );

  // --- Daily source attribution ---
  const rawDailySourcesPromise = getRows(
    `SELECT DATE(started_at) as date,
       COALESCE(utm_source, referrer_domain, 'Direct') as source,
       COUNT(*) as count
     FROM sessions
     WHERE site_id = ? AND started_at BETWEEN ? AND ?
     GROUP BY DATE(started_at), COALESCE(utm_source, referrer_domain, 'Direct')
     ORDER BY date, count DESC`,
    [siteId, range.from, dateEnd]
  );

  // Await all in parallel
  const [
    timeSeries,
    sources,
    pages,
    entryPages,
    exitPages,
    countries,
    cities,
    browsers,
    os,
    devices,
    convTotals,
    convBySource,
    convTimeSeries,
    affiliateBreakdown,
    rawDailySources,
  ] = await Promise.all([
    timeSeriesPromise,
    sourcesPromise,
    pagesPromise,
    entryPagesPromise,
    exitPagesPromise,
    countriesPromise,
    citiesPromise,
    browsersPromise,
    osPromise,
    devicesPromise,
    convTotalsPromise,
    convBySourcePromise,
    convTimeSeriesPromise,
    affiliateBreakdownPromise,
    rawDailySourcesPromise,
  ]);

  // Keep only the top source per day
  const dailySources = {};
  for (const row of rawDailySources) {
    const dateKey = row.date instanceof Date ? row.date.toISOString().slice(0, 10) : row.date;
    if (!dailySources[dateKey]) {
      dailySources[dateKey] = { source: row.source, count: row.count };
    }
  }

  const convRate =
    current.total_sessions > 0
      ? ((convTotals.total_conversions / current.total_sessions) * 100).toFixed(2)
      : 0;

  function pctChange(curr, prev) {
    if (prev === 0) return curr > 0 ? 100 : 0;
    return (((curr - prev) / prev) * 100).toFixed(1);
  }

  res.status(200).json({
    site,
    current: {
      visitors: current.total_visitors,
      sessions: current.total_sessions,
      pageViews: current.total_page_views,
      bounceRate: parseFloat(bounceRate),
      avgDuration: Math.round(current.avg_duration),
    },
    changes: {
      visitors: parseFloat(pctChange(current.total_visitors, previous.total_visitors)),
      sessions: parseFloat(pctChange(current.total_sessions, previous.total_sessions)),
      pageViews: parseFloat(pctChange(current.total_page_views, previous.total_page_views)),
      bounceRate: parseFloat(pctChange(bounceRate, prevBounceRate)),
      avgDuration: parseFloat(pctChange(current.avg_duration, previous.avg_duration)),
    },
    timeSeries,
    sources,
    pages,
    entryPages,
    exitPages,
    countries,
    cities,
    browsers,
    os,
    devices,
    conversions: {
      totals: {
        conversions: convTotals.total_conversions,
        revenue: convTotals.total_revenue,
        avgValue: Math.round(convTotals.avg_value),
        conversionRate: parseFloat(convRate),
      },
      bySource: convBySource,
      timeSeries: convTimeSeries,
    },
    affiliates: affiliateBreakdown,
    dailySources,
  });
});
