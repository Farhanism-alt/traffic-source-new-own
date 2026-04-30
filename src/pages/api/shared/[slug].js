import { getRow, getRows } from '@/lib/db';
import { parseDateRange } from '@/lib/analytics';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { slug } = req.query;

  const site = await getRow(
    'SELECT * FROM sites WHERE public_slug = ? AND is_public = true',
    [slug]
  );

  if (!site) {
    return res.status(404).json({ error: 'Not found' });
  }

  const siteId = site.id;
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

  const [current, previous] = await Promise.all([
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

  const bounceRate =
    current.total_sessions > 0
      ? ((current.total_bounces / current.total_sessions) * 100).toFixed(1)
      : 0;
  const prevBounceRate =
    previous.total_sessions > 0
      ? ((previous.total_bounces / previous.total_sessions) * 100).toFixed(1)
      : 0;

  // Time series
  let timeSeriesPromise;
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

  const [timeSeries, sources, pages, countries, browsers, os, devices] = await Promise.all([
    timeSeriesPromise,
    getRows(
      `SELECT COALESCE(utm_source, referrer_domain, 'Direct') as name,
        COUNT(*) as sessions, COUNT(DISTINCT visitor_id) as visitors
       FROM sessions
       WHERE site_id = ? AND started_at BETWEEN ? AND ?
       GROUP BY name ORDER BY sessions DESC LIMIT 10`,
      [siteId, range.from, dateEnd]
    ),
    getRows(
      `SELECT pathname as name, COUNT(*) as views
       FROM page_views
       WHERE site_id = ? AND timestamp BETWEEN ? AND ?
       GROUP BY pathname ORDER BY views DESC LIMIT 10`,
      [siteId, range.from, dateEnd]
    ),
    getRows(
      `SELECT country as name, COUNT(*) as count
       FROM sessions
       WHERE site_id = ? AND started_at BETWEEN ? AND ?
       AND country IS NOT NULL AND country != ''
       GROUP BY country ORDER BY count DESC LIMIT 10`,
      [siteId, range.from, dateEnd]
    ),
    getRows(
      `SELECT browser as name, COUNT(*) as count
       FROM sessions
       WHERE site_id = ? AND started_at BETWEEN ? AND ?
       AND browser IS NOT NULL AND browser != ''
       GROUP BY browser ORDER BY count DESC LIMIT 10`,
      [siteId, range.from, dateEnd]
    ),
    getRows(
      `SELECT os as name, COUNT(*) as count
       FROM sessions
       WHERE site_id = ? AND started_at BETWEEN ? AND ?
       AND os IS NOT NULL AND os != ''
       GROUP BY os ORDER BY count DESC LIMIT 10`,
      [siteId, range.from, dateEnd]
    ),
    getRows(
      `SELECT device_type as name, COUNT(*) as count
       FROM sessions
       WHERE site_id = ? AND started_at BETWEEN ? AND ?
       AND device_type IS NOT NULL AND device_type != ''
       GROUP BY device_type ORDER BY count DESC LIMIT 10`,
      [siteId, range.from, dateEnd]
    ),
  ]);

  function pctChange(curr, prev) {
    if (prev === 0) return curr > 0 ? 100 : 0;
    return (((curr - prev) / prev) * 100).toFixed(1);
  }

  res.status(200).json({
    site: { name: site.name, domain: site.domain },
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
    countries,
    browsers,
    os,
    devices,
  });
}
