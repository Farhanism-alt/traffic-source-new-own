import { getRow, getRows, run } from '@/lib/db';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const cronSecret = req.headers['x-cron-secret'];
  if (process.env.CRON_SECRET && cronSecret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const date = yesterday.toISOString().slice(0, 10);

    // Get all sites
    const sites = await getRows('SELECT id FROM sites');

    for (const site of sites) {
      // Ensure daily_stats row exists
      await run(
        `INSERT INTO daily_stats (site_id, date) VALUES (?, ?) ON CONFLICT (site_id, date) DO NOTHING`,
        [site.id, date]
      );

      // Recompute stats from raw data
      const [stats, pageViews] = await Promise.all([
        getRow(
          `SELECT
            COUNT(DISTINCT visitor_id) as visitors,
            COUNT(*) as sessions,
            SUM(is_bounce::int) as bounces,
            AVG(duration) as avg_duration
           FROM sessions
           WHERE site_id = ? AND DATE(started_at) = ?`,
          [site.id, date]
        ),
        getRow(
          `SELECT COUNT(*) as count FROM page_views
           WHERE site_id = ? AND DATE(timestamp) = ?`,
          [site.id, date]
        ),
      ]);

      await run(
        `UPDATE daily_stats SET
          visitors = ?, sessions = ?, page_views = ?,
          bounces = ?, avg_duration = ?
         WHERE site_id = ? AND date = ?`,
        [
          stats.visitors || 0,
          stats.sessions || 0,
          pageViews.count || 0,
          stats.bounces || 0,
          stats.avg_duration || 0,
          site.id,
          date,
        ]
      );
    }

    res.status(200).json({ aggregated: date, sites: sites.length });
  } catch (err) {
    console.error('Aggregation error:', err);
    res.status(500).json({ error: 'Aggregation failed' });
  }
}
