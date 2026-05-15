import { getRows, getRow, run } from '@/lib/db';
import { withAuth } from '@/lib/withAuth';
import { parseDateRange, verifySiteOwnership } from '@/lib/analytics';

let ready = null;
function ensureTables() {
  if (!ready) {
    ready = run(`CREATE TABLE IF NOT EXISTS annotations (
      id BIGSERIAL PRIMARY KEY,
      site_id TEXT NOT NULL,
      date DATE NOT NULL,
      note TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`).catch(() => { ready = null; });
  }
  return ready;
}

export default withAuth(async function handler(req, res) {
  const { siteId } = req.query;
  const site = await verifySiteOwnership(siteId, req.user.userId);
  if (!site) return res.status(404).json({ error: 'Site not found' });

  await ensureTables();

  if (req.method === 'GET') {
    const range = parseDateRange(req.query);
    const annotations = await getRows(`
      SELECT id, date::text, note FROM annotations
      WHERE site_id = ? AND date BETWEEN ? AND ? ORDER BY date
    `, [siteId, range.from, range.to]);
    return res.json({ annotations });
  }

  if (req.method === 'POST') {
    const { date, note } = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!date || !note) return res.status(400).json({ error: 'date and note required' });
    const ann = await getRow(`
      INSERT INTO annotations (site_id, date, note) VALUES (?, ?, ?)
      RETURNING id, date::text, note
    `, [siteId, date, String(note).slice(0, 200)]);
    return res.status(201).json({ annotation: ann });
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).end();
    await run(`DELETE FROM annotations WHERE id = ? AND site_id = ?`, [id, siteId]);
    return res.json({ ok: true });
  }

  return res.status(405).end();
});
