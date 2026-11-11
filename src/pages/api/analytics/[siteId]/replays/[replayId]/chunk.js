import { getRow } from '@/lib/db';
import { withAuth } from '@/lib/withAuth';
import { verifySiteOwnership, getLinkedSiteIds } from '@/lib/analytics';
import { readChunk } from '@/lib/replay';

// Streams one stored chunk. It is already gzipped, so it is sent with
// Content-Encoding: gzip and the browser decompresses it.
export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { siteId, replayId } = req.query;
  const seq = parseInt(req.query.seq, 10);
  if (!Number.isInteger(seq)) return res.status(400).json({ error: 'seq required' });
  const site = await verifySiteOwnership(siteId, req.user.userId);
  if (!site) return res.status(404).json({ error: 'Site not found' });
  const ids = (await getLinkedSiteIds(siteId)).map(String);
  const owned = await getRow('SELECT id FROM replays WHERE id = ? AND site_id = ANY(?)', [replayId, ids]);
  if (!owned) return res.status(404).json({ error: 'Replay not found' });

  const gz = await readChunk(replayId, seq);
  if (!gz) return res.status(404).json({ error: 'Chunk not found' });
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Encoding', 'gzip');
  res.setHeader('Content-Length', String(gz.length));
  res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
  res.status(200).end(gz);
});
