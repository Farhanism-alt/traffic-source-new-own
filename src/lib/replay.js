import zlib from 'zlib';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectsCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { getRow, getRows, run } from './db';

// Session replay: rrweb events recorded in the browser, uploaded as gzipped chunks.
// Chunks live in S3-compatible object storage (Supabase Storage on the free plan gives
// 1 GB) and only small metadata rows go in Postgres. Without storage configured, chunks
// fall back to a capped Postgres table so the feature still works.

export const DB_FALLBACK_CAP_BYTES = 100 * 1024 * 1024;
export const MAX_CHUNK_BYTES = 2 * 1024 * 1024; // compressed
export const MAX_REPLAY_CHUNKS = 3000;

// ---- Tables ----------------------------------------------------------------

let ready = null;
export function ensureReplayTables() {
  if (!ready) {
    ready = run(`CREATE TABLE IF NOT EXISTS replays (
        id TEXT PRIMARY KEY,
        site_id TEXT NOT NULL,
        session_id TEXT,
        visitor_id TEXT,
        started_at TIMESTAMPTZ,
        ended_at TIMESTAMPTZ,
        chunk_count INTEGER NOT NULL DEFAULT 0,
        bytes BIGINT NOT NULL DEFAULT 0,
        event_count INTEGER NOT NULL DEFAULT 0,
        first_url TEXT,
        last_url TEXT,
        page_count INTEGER NOT NULL DEFAULT 0,
        click_count INTEGER NOT NULL DEFAULT 0,
        key_count INTEGER NOT NULL DEFAULT 0,
        urls TEXT[] NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`)
      .then(() => run(`CREATE INDEX IF NOT EXISTS idx_replays_site_started ON replays(site_id, started_at DESC)`))
      .then(() => run(`CREATE INDEX IF NOT EXISTS idx_replays_site_visitor ON replays(site_id, visitor_id)`))
      .then(() => run(`CREATE TABLE IF NOT EXISTS replay_chunks (
        replay_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        site_id TEXT NOT NULL,
        size INTEGER NOT NULL,
        first_ts BIGINT,
        last_ts BIGINT,
        storage TEXT NOT NULL,
        data BYTEA,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (replay_id, seq)
      )`))
      .then(() => run(`CREATE TABLE IF NOT EXISTS replay_settings (
        site_id TEXT PRIMARY KEY,
        enabled BOOLEAN NOT NULL DEFAULT false,
        sample_rate INTEGER NOT NULL DEFAULT 100,
        mask_inputs BOOLEAN NOT NULL DEFAULT true,
        min_seconds INTEGER NOT NULL DEFAULT 3,
        retention_days INTEGER NOT NULL DEFAULT 30,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`))
      .catch((err) => { ready = null; throw err; });
  }
  return ready;
}

// ---- Per-site settings -----------------------------------------------------

export const DEFAULT_SETTINGS = { enabled: false, sample_rate: 100, mask_inputs: true, min_seconds: 3, retention_days: 30 };

export async function getReplaySettings(siteId) {
  await ensureReplayTables();
  const row = await getRow('SELECT * FROM replay_settings WHERE site_id = ?', [String(siteId)]);
  return { ...DEFAULT_SETTINGS, ...(row || {}) };
}

export async function saveReplaySettings(siteId, input) {
  await ensureReplayTables();
  const cur = await getReplaySettings(siteId);
  const clamp = (v, lo, hi, d) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
  };
  const next = {
    enabled: input.enabled === undefined ? cur.enabled : !!input.enabled,
    sample_rate: input.sample_rate === undefined ? cur.sample_rate : clamp(input.sample_rate, 1, 100, 100),
    mask_inputs: input.mask_inputs === undefined ? cur.mask_inputs : !!input.mask_inputs,
    min_seconds: input.min_seconds === undefined ? cur.min_seconds : clamp(input.min_seconds, 0, 600, 3),
    retention_days: input.retention_days === undefined ? cur.retention_days : clamp(input.retention_days, 0, 3650, 30),
  };
  await run(
    `INSERT INTO replay_settings (site_id, enabled, sample_rate, mask_inputs, min_seconds, retention_days, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW())
     ON CONFLICT (site_id) DO UPDATE SET enabled = EXCLUDED.enabled, sample_rate = EXCLUDED.sample_rate,
       mask_inputs = EXCLUDED.mask_inputs, min_seconds = EXCLUDED.min_seconds,
       retention_days = EXCLUDED.retention_days, updated_at = NOW()`,
    [String(siteId), next.enabled, next.sample_rate, next.mask_inputs, next.min_seconds, next.retention_days]
  );
  settingsCache.delete(String(siteId));
  return next;
}

// Ingest reads settings on every chunk: keep them in memory briefly.
const settingsCache = new Map();
export async function getCachedReplaySettings(siteId) {
  const key = String(siteId);
  const hit = settingsCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.value;
  const value = await getReplaySettings(key);
  if (settingsCache.size > 5000) settingsCache.clear();
  settingsCache.set(key, { value, exp: Date.now() + 60 * 1000 });
  return value;
}

// ---- Object storage --------------------------------------------------------

export function getStorageConfig() {
  const c = {
    endpoint: process.env.REPLAY_S3_ENDPOINT,
    region: process.env.REPLAY_S3_REGION || 'auto',
    bucket: process.env.REPLAY_S3_BUCKET,
    accessKeyId: process.env.REPLAY_S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.REPLAY_S3_SECRET_ACCESS_KEY,
    prefix: (process.env.REPLAY_S3_PREFIX || 'replays').replace(/^\/+|\/+$/g, ''),
  };
  return c.endpoint && c.bucket && c.accessKeyId && c.secretAccessKey ? c : null;
}

let client = null;
function s3() {
  const c = getStorageConfig();
  if (!c) return null;
  if (!client) {
    client = new S3Client({
      endpoint: c.endpoint,
      region: c.region,
      credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey },
      forcePathStyle: true,
    });
  }
  return { client, config: c };
}

function objectKey(config, siteId, replayId, seq) {
  return `${config.prefix ? `${config.prefix}/` : ''}${siteId}/${replayId}/${String(seq).padStart(6, '0')}.json.gz`;
}

export async function testStorage() {
  const s = s3();
  if (!s) throw new Error('Storage is not configured');
  await s.client.send(new HeadBucketCommand({ Bucket: s.config.bucket }));
  return true;
}

export function storageMode() {
  return getStorageConfig() ? 's3' : 'db';
}

// ---- Event stats -----------------------------------------------------------

// rrweb: EventType 3 = incremental, 4 = meta (page load, carries href).
// IncrementalSource 2 = mouse interaction (type 2 click, 4 dblclick), 5 = input.
export function summarizeEvents(events) {
  let firstTs = null;
  let lastTs = null;
  let clicks = 0;
  let keys = 0;
  const urls = [];
  for (const e of events) {
    if (!e || typeof e.timestamp !== 'number') continue;
    if (firstTs == null || e.timestamp < firstTs) firstTs = e.timestamp;
    if (lastTs == null || e.timestamp > lastTs) lastTs = e.timestamp;
    if (e.type === 4 && e.data && typeof e.data.href === 'string') urls.push(e.data.href.slice(0, 2000));
    if (e.type === 3 && e.data) {
      if (e.data.source === 2 && (e.data.type === 2 || e.data.type === 4)) clicks++;
      else if (e.data.source === 5) keys++;
    }
  }
  return { firstTs, lastTs, clicks, keys, urls, count: events.length };
}

// ---- Ingest ----------------------------------------------------------------

/**
 * Stores one chunk and folds its stats into the replay row.
 * body: Buffer, gzip if compressed, else plain JSON. Returns { ok, reason? }.
 */
export async function ingestChunk({ siteId, replayId, seq, sessionId, visitorId, body, compressed }) {
  await ensureReplayTables();

  let json;
  let gz;
  try {
    if (compressed) {
      gz = body;
      json = zlib.gunzipSync(body, { maxOutputLength: 64 * 1024 * 1024 }).toString('utf8');
    } else {
      json = body.toString('utf8');
      gz = zlib.gzipSync(body, { level: 6 });
    }
  } catch {
    return { ok: false, reason: 'bad_body' };
  }
  if (gz.length > MAX_CHUNK_BYTES) return { ok: false, reason: 'too_large' };

  let events;
  try {
    events = JSON.parse(json);
  } catch {
    return { ok: false, reason: 'bad_json' };
  }
  if (!Array.isArray(events) || !events.length) return { ok: false, reason: 'empty' };

  const stats = summarizeEvents(events);
  if (stats.firstTs == null) return { ok: false, reason: 'empty' };

  const id = `${siteId}_${replayId}`;
  const existing = await getRow('SELECT chunk_count FROM replays WHERE id = ?', [id]);
  if (existing && existing.chunk_count >= MAX_REPLAY_CHUNKS) return { ok: false, reason: 'replay_full' };

  const mode = storageMode();
  if (mode === 'db') {
    const used = await getRow(`SELECT COALESCE(SUM(size), 0) AS n FROM replay_chunks WHERE storage = 'db'`);
    if (Number(used.n) + gz.length > DB_FALLBACK_CAP_BYTES) return { ok: false, reason: 'db_cap' };
  }

  // Claim the (replay, seq) slot first so a retried upload isn't counted twice.
  const claimed = await getRows(
    `INSERT INTO replay_chunks (replay_id, seq, site_id, size, first_ts, last_ts, storage, data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (replay_id, seq) DO NOTHING
     RETURNING seq`,
    [id, seq, String(siteId), gz.length, stats.firstTs, stats.lastTs, mode, mode === 'db' ? gz : null]
  );
  if (!claimed.length) return { ok: true, duplicate: true };

  if (mode === 's3') {
    const { client: c, config } = s3();
    try {
      await c.send(new PutObjectCommand({
        Bucket: config.bucket,
        Key: objectKey(config, siteId, replayId, seq),
        Body: gz,
        ContentType: 'application/json',
        ContentEncoding: 'gzip',
      }));
    } catch (err) {
      await run('DELETE FROM replay_chunks WHERE replay_id = ? AND seq = ?', [id, seq]);
      throw err;
    }
  }

  const firstUrl = stats.urls[0] || null;
  const lastUrl = stats.urls[stats.urls.length - 1] || null;
  await run(
    `INSERT INTO replays (id, site_id, session_id, visitor_id, started_at, ended_at, chunk_count, bytes,
                          event_count, first_url, last_url, page_count, click_count, key_count, urls)
     VALUES (?, ?, ?, ?, to_timestamp(?::double precision / 1000), to_timestamp(?::double precision / 1000),
             1, ?, ?, ?, ?, ?, ?, ?, ?::text[])
     ON CONFLICT (id) DO UPDATE SET
       session_id = COALESCE(replays.session_id, EXCLUDED.session_id),
       visitor_id = COALESCE(replays.visitor_id, EXCLUDED.visitor_id),
       started_at = LEAST(replays.started_at, EXCLUDED.started_at),
       ended_at = GREATEST(replays.ended_at, EXCLUDED.ended_at),
       chunk_count = replays.chunk_count + 1,
       bytes = replays.bytes + EXCLUDED.bytes,
       event_count = replays.event_count + EXCLUDED.event_count,
       first_url = CASE WHEN EXCLUDED.started_at < replays.started_at OR replays.first_url IS NULL
                        THEN COALESCE(EXCLUDED.first_url, replays.first_url) ELSE replays.first_url END,
       last_url = CASE WHEN EXCLUDED.ended_at >= replays.ended_at OR replays.last_url IS NULL
                       THEN COALESCE(EXCLUDED.last_url, replays.last_url) ELSE replays.last_url END,
       page_count = replays.page_count + EXCLUDED.page_count,
       click_count = replays.click_count + EXCLUDED.click_count,
       key_count = replays.key_count + EXCLUDED.key_count,
       urls = CASE WHEN array_length(replays.urls, 1) >= 200 THEN replays.urls ELSE replays.urls || EXCLUDED.urls END,
       updated_at = NOW()`,
    [
      id, String(siteId), sessionId || null, visitorId || null, stats.firstTs, stats.lastTs,
      gz.length, stats.count, firstUrl, lastUrl, stats.urls.length, stats.clicks, stats.keys,
      stats.urls,
    ]
  );
  return { ok: true };
}

// ---- Read ------------------------------------------------------------------

/** Returns the gzipped bytes of one chunk, or null. */
export async function readChunk(replayRowId, seq) {
  const row = await getRow('SELECT site_id, storage, data FROM replay_chunks WHERE replay_id = ? AND seq = ?', [replayRowId, seq]);
  if (!row) return null;
  if (row.storage === 'db') return row.data;
  const s = s3();
  if (!s) throw new Error('Replay storage is not configured');
  const replayId = replayRowId.slice(String(row.site_id).length + 1);
  const out = await s.client.send(new GetObjectCommand({
    Bucket: s.config.bucket,
    Key: objectKey(s.config, row.site_id, replayId, seq),
  }));
  return Buffer.from(await out.Body.transformToByteArray());
}

// ---- Delete ----------------------------------------------------------------

/** Deletes replays (rows, chunks and stored objects). ids are replays.id values of one site. */
export async function deleteReplays(siteId, ids) {
  if (!ids.length) return 0;
  await ensureReplayTables();
  const site = String(siteId);
  let deleted = 0;
  for (let i = 0; i < ids.length; i += 500) {
    const batch = ids.slice(i, i + 500);
    const chunks = await getRows(
      `SELECT replay_id, seq FROM replay_chunks WHERE site_id = ? AND replay_id = ANY(?) AND storage = 's3'`,
      [site, batch]
    );
    const s = s3();
    if (chunks.length && s) {
      const keys = chunks.map((c) => ({ Key: objectKey(s.config, site, c.replay_id.slice(site.length + 1), c.seq) }));
      for (let k = 0; k < keys.length; k += 1000) {
        await s.client.send(new DeleteObjectsCommand({
          Bucket: s.config.bucket,
          Delete: { Objects: keys.slice(k, k + 1000), Quiet: true },
        }));
      }
    }
    await run('DELETE FROM replay_chunks WHERE site_id = ? AND replay_id = ANY(?)', [site, batch]);
    const res = await getRows('DELETE FROM replays WHERE site_id = ? AND id = ANY(?) RETURNING id', [site, batch]);
    deleted += res.length;
  }
  return deleted;
}

// Retention: drop replays older than the site's retention window. Runs at most hourly per site per instance.
const lastPrune = new Map();
export async function pruneExpiredReplays(siteId) {
  const key = String(siteId);
  if ((lastPrune.get(key) || 0) > Date.now() - 60 * 60 * 1000) return 0;
  lastPrune.set(key, Date.now());
  const { retention_days: days } = await getReplaySettings(key);
  if (!days) return 0;
  const old = await getRows(
    `SELECT id FROM replays WHERE site_id = ? AND started_at < NOW() - make_interval(days => ?::int) LIMIT 5000`,
    [key, days]
  );
  return deleteReplays(key, old.map((r) => r.id));
}
