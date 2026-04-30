import { getRow, getRows } from '@/lib/db';
import { parseDateRange } from '@/lib/analytics';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token required' });

  const affiliate = await getRow(
    'SELECT a.*, s.name as site_name, s.domain as site_domain FROM affiliates a JOIN sites s ON s.id = a.site_id WHERE a.share_token = ?',
    [token]
  );

  if (!affiliate) return res.status(404).json({ error: 'Not found' });

  const range = parseDateRange(req.query);
  const dateEnd = range.to + ' 23:59:59';

  const [stats, convStats, visitTimeSeries, landingPages] = await Promise.all([
    getRow(
      `SELECT COUNT(*) as visits, COUNT(DISTINCT visitor_id) as unique_visitors
       FROM affiliate_visits
       WHERE affiliate_id = ? AND landed_at BETWEEN ? AND ?`,
      [affiliate.id, range.from, dateEnd]
    ),
    getRow(
      `SELECT COUNT(*) as conversions, COALESCE(SUM(amount), 0) as revenue
       FROM conversions
       WHERE affiliate_id = ? AND status = 'completed'
         AND created_at BETWEEN ? AND ?`,
      [affiliate.id, range.from, dateEnd]
    ),
    getRows(
      `SELECT DATE(landed_at) as date, COUNT(*) as visits, COUNT(DISTINCT visitor_id) as unique_visitors
       FROM affiliate_visits
       WHERE affiliate_id = ? AND landed_at BETWEEN ? AND ?
       GROUP BY date ORDER BY date ASC`,
      [affiliate.id, range.from, dateEnd]
    ),
    getRows(
      `SELECT landing_page as name, COUNT(*) as count
       FROM affiliate_visits
       WHERE affiliate_id = ? AND landed_at BETWEEN ? AND ?
       AND landing_page IS NOT NULL
       GROUP BY landing_page ORDER BY count DESC LIMIT 10`,
      [affiliate.id, range.from, dateEnd]
    ),
  ]);

  const conversionRate =
    stats.unique_visitors > 0
      ? ((convStats.conversions / stats.unique_visitors) * 100).toFixed(2)
      : 0;

  const commission =
    affiliate.commission_rate > 0
      ? Math.round(convStats.revenue * affiliate.commission_rate)
      : 0;

  res.status(200).json({
    affiliate: {
      name: affiliate.name,
      slug: affiliate.slug,
      commission_rate: affiliate.commission_rate,
    },
    site: {
      name: affiliate.site_name,
      domain: affiliate.site_domain,
    },
    stats: {
      visits: stats.visits,
      uniqueVisitors: stats.unique_visitors,
      conversions: convStats.conversions,
      revenue: convStats.revenue,
      conversionRate: parseFloat(conversionRate),
      commission,
    },
    visitTimeSeries,
    landingPages,
  });
}
