import { getDb } from '@/lib/db';
import { withAuth } from '@/lib/withAuth';

export default withAuth(function handler(req, res) {
  const db = getDb();

  if (req.method === 'GET') {
    const sites = db
      .prepare(
        `SELECT s.id, s.user_id, s.domain, s.name, s.created_at,
          (SELECT COUNT(*) FROM page_views pv WHERE pv.site_id = s.id
           AND pv.timestamp >= datetime('now', '-7 days')) as views_7d
         FROM sites s WHERE s.user_id = ? ORDER BY s.created_at DESC`
      )
      .all(req.user.userId);

    return res.status(200).json({ sites });
  }

  if (req.method === 'POST') {
    const { domain, name } = req.body;

    if (!domain || !name) {
      return res.status(400).json({ error: 'Domain and name are required' });
    }

    const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/+$/, '');

    try {
      const result = db
        .prepare('INSERT INTO sites (user_id, domain, name) VALUES (?, ?, ?)')
        .run(req.user.userId, cleanDomain, name);

      const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(result.lastInsertRowid);

      return res.status(201).json({ site });
    } catch (err) {
      if (err.message.includes('UNIQUE constraint')) {
        return res.status(409).json({ error: 'Site with this domain already exists' });
      }
      throw err;
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
});
