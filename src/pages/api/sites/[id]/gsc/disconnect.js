import { withAuth } from '@/lib/withAuth';
import { getRow } from '@/lib/db';
import { unlinkSite } from '@/lib/gsc';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'DELETE') return res.status(405).end();
  const { id } = req.query;
  const site = await getRow('SELECT id FROM sites WHERE id = ? AND user_id = ?', [
    id,
    req.user.userId,
  ]);
  if (!site) return res.status(404).json({ error: 'Site not found' });
  await unlinkSite(id);
  return res.status(200).json({ ok: true });
});
