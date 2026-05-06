import { getRow, getRows } from '@/lib/db';
import { withAuth } from '@/lib/withAuth';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const userId = req.user.userId;

  // Get all user's sites
  const sites = await getRows('SELECT id, name, domain FROM sites WHERE user_id = ?', [userId]);
  if (sites.length === 0) {
    return res.json({ visitors: [], countries: [], recentPayments: [], activeUsers: 0, totals: {} });
  }

  const siteIds = sites.map((s) => s.id);

  // Active visitors across all sites (last 5 min)
  const [activeUsers, countries, totals, recentPayments] = await Promise.all([
    getRows(
      `SELECT s.visitor_id, s.country, s.city, s.browser, s.device_type,
              s.exit_page as current_page, s.last_activity,
              COALESCE(s.utm_source, s.referrer_domain, 'Direct') as source,
              s.site_id
       FROM sessions s
       INNER JOIN (
         SELECT visitor_id, site_id, MAX(last_activity) as max_activity
         FROM sessions
         WHERE site_id = ANY($1) AND last_activity > NOW() - INTERVAL '5 minutes'
         GROUP BY visitor_id, site_id
       ) latest ON s.visitor_id = latest.visitor_id
                AND s.site_id = latest.site_id
                AND s.last_activity = latest.max_activity
       WHERE s.site_id = ANY($1)
       ORDER BY s.last_activity DESC`,
      [siteIds]
    ),
    getRows(
      `SELECT country as name, COUNT(*) as count
       FROM sessions
       WHERE site_id = ANY($1)
       AND started_at > NOW() - INTERVAL '30 days'
       AND country IS NOT NULL AND country != ''
       GROUP BY country ORDER BY count DESC`,
      [siteIds]
    ),
    getRow(
      `SELECT
        COALESCE(SUM(visitors), 0) as visitors,
        COALESCE(SUM(sessions), 0) as sessions,
        COALESCE(SUM(page_views), 0) as pageviews
       FROM daily_stats
       WHERE site_id = ANY($1)
       AND date >= CURRENT_DATE - INTERVAL '30 days'`,
      [siteIds]
    ),
    getRows(
      `SELECT c.id, c.amount, c.created_at, c.stripe_customer_email,
              s.name as site_name, s.domain as site_domain,
              COALESCE(se.utm_source, se.referrer_domain, 'Direct') as source,
              se.country
       FROM conversions c
       LEFT JOIN sites s ON s.id = c.site_id
       LEFT JOIN sessions se ON se.id = c.session_id AND se.site_id = c.site_id
       WHERE c.site_id = ANY($1) AND c.status = 'completed'
       ORDER BY c.created_at DESC
       LIMIT 20`,
      [siteIds]
    ),
  ]);

  // Map site_id to site info for active users
  const siteMap = {};
  for (const s of sites) siteMap[s.id] = s;

  const enrichedUsers = activeUsers.map((u) => ({
    ...u,
    site_name: siteMap[u.site_id]?.name,
    site_domain: siteMap[u.site_id]?.domain,
  }));

  res.json({
    activeUsers: enrichedUsers,
    countries,
    recentPayments,
    totals,
    sites,
  });
});
