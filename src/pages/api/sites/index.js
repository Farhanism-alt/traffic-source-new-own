import { getRow, getRows, run } from '@/lib/db';
import { withAuth } from '@/lib/withAuth';

export default withAuth(async function handler(req, res) {
  if (req.method === 'GET') {
    const sites = await getRows(
      `SELECT s.id, s.user_id, s.domain, s.name, s.created_at,
        (SELECT COUNT(*) FROM page_views pv WHERE pv.site_id = s.id
         AND pv.timestamp >= NOW() - INTERVAL '7 days') as views_7d
       FROM sites s WHERE s.user_id = ? ORDER BY s.created_at DESC`,
      [req.user.userId]
    );

    // Fetch hourly pageviews + visitors for last 24h per site
    const siteIds = sites.map((s) => s.id);
    const hourlyMap = {};
    if (siteIds.length > 0) {
      const rows = await getRows(
        `SELECT site_id, TO_CHAR(timestamp AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24":00"') as hour,
                COUNT(*) as pageviews,
                COUNT(DISTINCT visitor_id) as visitors
         FROM page_views
         WHERE site_id = ANY($1)
           AND timestamp >= NOW() - INTERVAL '24 hours'
         GROUP BY site_id, hour
         ORDER BY hour`,
        [siteIds]
      );
      for (const row of rows) {
        if (!hourlyMap[row.site_id]) hourlyMap[row.site_id] = [];
        hourlyMap[row.site_id].push({ hour: row.hour, pageviews: row.pageviews, visitors: row.visitors });
      }
    }

    const enriched = sites.map((s) => ({
      ...s,
      hourly: hourlyMap[s.id] || [],
    }));

    return res.status(200).json({ sites: enriched });
  }

  if (req.method === 'POST') {
    const { domain, name } = req.body;

    if (!domain || !name) {
      return res.status(400).json({ error: 'Domain and name are required' });
    }

    const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/+$/, '');

    try {
      const result = await run(
        'INSERT INTO sites (user_id, domain, name) VALUES (?, ?, ?) RETURNING id',
        [req.user.userId, cleanDomain, name]
      );
      const newId = result.rows[0].id;
      const site = await getRow('SELECT * FROM sites WHERE id = ?', [newId]);

      return res.status(201).json({ site });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Site with this domain already exists' });
      }
      throw err;
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
});
