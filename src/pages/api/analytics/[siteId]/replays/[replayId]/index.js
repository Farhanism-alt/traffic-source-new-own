import { getRow, getRows } from '@/lib/db';
import { withAuth } from '@/lib/withAuth';
import { verifySiteOwnership, getLinkedSiteIds } from '@/lib/analytics';
import { ensureReplayTables } from '@/lib/replay';

// One replay: metadata, who it was, and the list of chunks to download.
export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { siteId, replayId } = req.query;
  const site = await verifySiteOwnership(siteId, req.user.userId);
  if (!site) return res.status(404).json({ error: 'Site not found' });
  await ensureReplayTables();
  const ids = (await getLinkedSiteIds(siteId)).map(String);

  const replay = await getRow('SELECT * FROM replays WHERE id = ? AND site_id = ANY(?)', [replayId, ids]);
  if (!replay) return res.status(404).json({ error: 'Replay not found' });

  const [chunks, session, identity] = await Promise.all([
    getRows('SELECT seq, size FROM replay_chunks WHERE replay_id = ? ORDER BY seq', [replay.id]),
    replay.session_id
      ? getRow(
          `SELECT country, city, browser, os, device_type, referrer, referrer_domain, utm_source, utm_medium, utm_campaign, entry_page
           FROM sessions WHERE id = ? AND site_id::text = ? LIMIT 1`,
          [replay.session_id, replay.site_id]
        ).catch(() => null)
      : null,
    replay.visitor_id
      ? getRow(
          'SELECT email FROM visitor_identities WHERE site_id = ? AND visitor_id = ? ORDER BY created_at DESC LIMIT 1',
          [replay.site_id, replay.visitor_id]
        ).catch(() => null)
      : null,
  ]);

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    replay: { ...replay, bytes: Number(replay.bytes) },
    chunks: chunks.map((c) => ({ seq: c.seq, size: c.size })),
    session,
    email: identity?.email || null,
  });
});
