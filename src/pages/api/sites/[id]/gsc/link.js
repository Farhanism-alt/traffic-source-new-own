import { withAuth } from '@/lib/withAuth';
import { getRow } from '@/lib/db';
import { linkSiteProperty, getUserConnection } from '@/lib/gsc';
import { syncSite } from '@/lib/gsc-sync';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { id } = req.query;
  const { property } = req.body || {};
  if (!property) return res.status(400).json({ error: 'property required' });

  const site = await getRow('SELECT id FROM sites WHERE id = ? AND user_id = ?', [
    id,
    req.user.userId,
  ]);
  if (!site) return res.status(404).json({ error: 'Site not found' });

  const conn = await getUserConnection(req.user.userId);
  if (!conn) {
    return res.status(400).json({ error: 'Google account not connected.' });
  }

  await linkSiteProperty(id, property);
  syncSite(parseInt(id, 10), { backfill: true }).catch((err) =>
    console.error('[GSC backfill]', err.message)
  );
  return res.status(200).json({ ok: true });
});
