import { getRows } from '@/lib/db';
import { withAuth } from '@/lib/withAuth';
import { verifySiteOwnership } from '@/lib/analytics';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { siteId } = req.query;
  const site = await verifySiteOwnership(siteId, req.user.userId);
  if (!site) return res.status(404).json({ error: 'Site not found' });

  const activeUsers = await getRows(
    `SELECT s.visitor_id, s.country, s.city, s.browser, s.os, s.device_type,
            s.exit_page as current_page, s.last_activity, s.started_at,
            COALESCE(s.utm_source, s.referrer_domain, 'Direct') as source
     FROM sessions s
     INNER JOIN (
       SELECT visitor_id, MAX(last_activity) as max_activity
       FROM sessions
       WHERE site_id = ? AND last_activity > NOW() - INTERVAL '5 minutes'
       GROUP BY visitor_id
     ) latest ON s.visitor_id = latest.visitor_id AND s.last_activity = latest.max_activity
     WHERE s.site_id = ?
     ORDER BY s.last_activity DESC`,
    [siteId, siteId]
  );

  res.status(200).json({ count: activeUsers.length, users: activeUsers });
});
