import { getRows, getRow, run } from '@/lib/db';
import { withAuth } from '@/lib/withAuth';
import { parseDateRange, verifySiteOwnership } from '@/lib/analytics';

let ready = null;
function ensureTables() {
  if (!ready) {
    ready = run(`CREATE TABLE IF NOT EXISTS funnels (
      id BIGSERIAL PRIMARY KEY,
      site_id TEXT NOT NULL,
      name TEXT NOT NULL,
      steps JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`).catch(() => { ready = null; });
  }
  return ready;
}

async function analyzeFunnel(siteId, steps, from, to) {
  const dateEnd = to + ' 23:59:59';
  const results = [];
  for (let i = 0; i < steps.length; i++) {
    let count = 0;
    try {
      if (i === 0) {
        const row = await getRow(`
          SELECT COUNT(DISTINCT session_id) as count FROM page_views
          WHERE site_id = ? AND pathname = ? AND timestamp BETWEEN ? AND ?
        `, [siteId, steps[0], from, dateEnd]);
        count = Number(row?.count || 0);
      } else {
        const row = await getRow(`
          SELECT COUNT(DISTINCT p2.session_id) as count
          FROM page_views p1
          JOIN page_views p2 ON p1.session_id = p2.session_id AND p2.timestamp > p1.timestamp
          WHERE p1.site_id = ? AND p1.pathname = ?
            AND p2.site_id = ? AND p2.pathname = ?
            AND p1.timestamp BETWEEN ? AND ?
        `, [siteId, steps[i - 1], siteId, steps[i], from, dateEnd]);
        count = Number(row?.count || 0);
      }
    } catch {}
    results.push({ step: steps[i], count });
  }
  return results;
}

export default withAuth(async function handler(req, res) {
  const { siteId } = req.query;
  const site = await verifySiteOwnership(siteId, req.user.userId);
  if (!site) return res.status(404).json({ error: 'Site not found' });

  await ensureTables();

  if (req.method === 'GET') {
    const funnels = await getRows(`
      SELECT id, name, steps, created_at FROM funnels
      WHERE site_id = ? ORDER BY created_at DESC
    `, [siteId]).catch(() => []);
    return res.json({ funnels });
  }

  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { name, steps, action } = body;

    if (action === 'analyze') {
      if (!steps || steps.length < 2) return res.status(400).json({ error: 'Need at least 2 steps' });
      const range = parseDateRange(req.query);
      const results = await analyzeFunnel(siteId, steps, body.from || range.from, body.to || range.to);
      return res.json({ results });
    }

    if (!name || !steps || steps.length < 2) {
      return res.status(400).json({ error: 'name and at least 2 steps required' });
    }
    const funnel = await getRow(`
      INSERT INTO funnels (site_id, name, steps) VALUES (?, ?, ?)
      RETURNING id, name, steps, created_at
    `, [siteId, String(name).slice(0, 100), JSON.stringify(steps)]);
    return res.status(201).json({ funnel });
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).end();
    await run(`DELETE FROM funnels WHERE id = ? AND site_id = ?`, [id, siteId]);
    return res.json({ ok: true });
  }

  return res.status(405).end();
});
