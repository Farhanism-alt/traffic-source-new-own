import { getRows } from '@/lib/db';
import { withAuth } from '@/lib/withAuth';
import { parseDateRange, verifySiteOwnership } from '@/lib/analytics';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const { siteId } = req.query;
  const site = await verifySiteOwnership(siteId, req.user.userId);
  if (!site) return res.status(404).json({ error: 'Site not found' });

  const range = parseDateRange(req.query);
  const dateEnd = range.to + ' 23:59:59';

  try {
    if (req.query.name) {
      // Property breakdown for a specific event
      const rows = await getRows(`
        SELECT properties, COUNT(*) as count
        FROM events
        WHERE site_id = ? AND name = ? AND created_at BETWEEN ? AND ?
        GROUP BY properties ORDER BY count DESC LIMIT 20
      `, [siteId, req.query.name, range.from, dateEnd]);
      return res.json({ rows });
    }

    const events = await getRows(`
      SELECT name, COUNT(*) as count, COUNT(DISTINCT visitor_id) as unique_visitors
      FROM events
      WHERE site_id = ? AND created_at BETWEEN ? AND ?
      GROUP BY name ORDER BY count DESC LIMIT 20
    `, [siteId, range.from, dateEnd]);

    res.json({ events });
  } catch {
    res.json({ events: [] });
  }
});
