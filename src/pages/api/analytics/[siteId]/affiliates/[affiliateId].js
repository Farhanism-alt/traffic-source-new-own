import { getRow, getRows } from '@/lib/db';
import { withAuth } from '@/lib/withAuth';
import { parseDateRange, verifySiteOwnership } from '@/lib/analytics';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { siteId, affiliateId } = req.query;
  const site = await verifySiteOwnership(siteId, req.user.userId);
  if (!site) return res.status(404).json({ error: 'Site not found' });

  const affiliate = await getRow(
    'SELECT * FROM affiliates WHERE id = ? AND site_id = ?',
    [affiliateId, siteId]
  );
  if (!affiliate) return res.status(404).json({ error: 'Affiliate not found' });

  const range = parseDateRange(req.query);
  const dateEnd = range.to + ' 23:59:59';

  const [stats, convStats, visitTimeSeries, convTimeSeries, landingPages, conversions] =
    await Promise.all([
      getRow(
        `SELECT
          COUNT(*) as visits,
          COUNT(DISTINCT visitor_id) as unique_visitors
         FROM affiliate_visits
         WHERE affiliate_id = ? AND landed_at BETWEEN ? AND ?`,
        [affiliateId, range.from, dateEnd]
      ),
      getRow(
        `SELECT
          COUNT(*) as conversions,
          COALESCE(SUM(amount), 0) as revenue
         FROM conversions
         WHERE affiliate_id = ? AND status = 'completed'
           AND created_at BETWEEN ? AND ?`,
        [affiliateId, range.from, dateEnd]
      ),
      getRows(
        `SELECT DATE(landed_at) as date,
          COUNT(*) as visits,
          COUNT(DISTINCT visitor_id) as unique_visitors
         FROM affiliate_visits
         WHERE affiliate_id = ? AND landed_at BETWEEN ? AND ?
         GROUP BY date ORDER BY date ASC`,
        [affiliateId, range.from, dateEnd]
      ),
      getRows(
        `SELECT DATE(created_at) as date,
          COUNT(*) as conversions,
          SUM(amount) as revenue
         FROM conversions
         WHERE affiliate_id = ? AND status = 'completed'
           AND created_at BETWEEN ? AND ?
         GROUP BY date ORDER BY date ASC`,
        [affiliateId, range.from, dateEnd]
      ),
      getRows(
        `SELECT landing_page as name, COUNT(*) as count
         FROM affiliate_visits
         WHERE affiliate_id = ? AND landed_at BETWEEN ? AND ?
         AND landing_page IS NOT NULL
         GROUP BY landing_page ORDER BY count DESC LIMIT 10`,
        [affiliateId, range.from, dateEnd]
      ),
      getRows(
        `SELECT c.*, a.name as affiliate_name
         FROM conversions c
         LEFT JOIN affiliates a ON a.id = c.affiliate_id
         WHERE c.affiliate_id = ? AND c.status = 'completed'
           AND c.created_at BETWEEN ? AND ?
         ORDER BY c.created_at DESC LIMIT 20`,
        [affiliateId, range.from, dateEnd]
      ),
    ]);

  const conversionRate =
    stats.visits > 0
      ? ((convStats.conversions / stats.unique_visitors) * 100).toFixed(2)
      : 0;

  const commission =
    affiliate.commission_rate > 0
      ? Math.round(convStats.revenue * affiliate.commission_rate)
      : 0;

  res.status(200).json({
    site,
    affiliate,
    stats: {
      visits: stats.visits,
      uniqueVisitors: stats.unique_visitors,
      conversions: convStats.conversions,
      revenue: convStats.revenue,
      conversionRate: parseFloat(conversionRate),
      commission,
    },
    visitTimeSeries,
    convTimeSeries,
    landingPages,
    conversions,
  });
});
