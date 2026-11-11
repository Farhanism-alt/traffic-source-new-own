import { getRow } from '@/lib/db';
import { getCachedReplaySettings, ingestChunk, pruneExpiredReplays, MAX_CHUNK_BYTES } from '@/lib/replay';

// Public endpoint used by the tracker on customers' sites.
// GET  ?config=1&s=SITE      → replay settings for the recorder (CDN-cached)
// POST ?s=SITE&r=REPLAY&q=SEQ&sid=SESSION&v=VISITOR&z=1|0   body: gzip (z=1) or JSON array of rrweb events

export const config = { api: { bodyParser: false }, maxDuration: 30 };

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const siteCache = new Map();
async function siteExists(siteId) {
  const hit = siteCache.get(siteId);
  if (hit && hit.exp > Date.now()) return hit.ok;
  const ok = !!(await getRow('SELECT id FROM sites WHERE id::text = ?', [siteId]));
  if (siteCache.size > 5000) siteCache.clear();
  siteCache.set(siteId, { ok, exp: Date.now() + 10 * 60 * 1000 });
  return ok;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const siteId = String(req.query.s || '');
  if (!ID_RE.test(siteId)) return res.status(400).json({ error: 'bad site' });

  if (req.method === 'GET') {
    if (!(await siteExists(siteId))) return res.status(404).json({ enabled: false });
    const s = await getCachedReplaySettings(siteId);
    // Cached at the CDN so visitors' config checks rarely reach the function.
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({
      enabled: !!s.enabled,
      sample: s.sample_rate,
      maskInputs: s.mask_inputs,
      minSeconds: s.min_seconds,
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const replayId = String(req.query.r || '');
  const seq = parseInt(req.query.q, 10);
  const sessionId = req.query.sid ? String(req.query.sid).slice(0, 64) : null;
  const visitorId = req.query.v ? String(req.query.v).slice(0, 64) : null;
  if (!ID_RE.test(replayId) || !Number.isInteger(seq) || seq < 0 || seq > 100000) {
    return res.status(400).json({ error: 'bad params' });
  }

  try {
    if (!(await siteExists(siteId))) return res.status(404).json({ error: 'unknown site' });
    const settings = await getCachedReplaySettings(siteId);
    if (!settings.enabled) return res.status(403).json({ error: 'replay disabled' });

    const compressed = req.query.z === '1';
    const body = await readBody(req, compressed ? MAX_CHUNK_BYTES : 16 * 1024 * 1024);
    const result = await ingestChunk({ siteId, replayId, seq, sessionId, visitorId, body, compressed });

    pruneExpiredReplays(siteId).catch(() => {});

    if (!result.ok) {
      const status = result.reason === 'db_cap' || result.reason === 'replay_full' ? 507 : 400;
      return res.status(status).json({ error: result.reason });
    }
    return res.status(204).end();
  } catch (err) {
    if (err.status === 413) return res.status(413).json({ error: 'too large' });
    console.error('[replay] ingest failed', err);
    return res.status(500).json({ error: 'ingest failed' });
  }
}
