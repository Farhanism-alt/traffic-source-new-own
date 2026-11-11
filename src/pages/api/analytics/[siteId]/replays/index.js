import { getRow, getRows } from '@/lib/db';
import { withAuth } from '@/lib/withAuth';
import { parseDateRange, verifySiteOwnership, getLinkedSiteIds } from '@/lib/analytics';
import { ensureReplayTables, deleteReplays, pruneExpiredReplays, getReplaySettings, storageMode, DB_FALLBACK_CAP_BYTES } from '@/lib/replay';

// GET: list replays (search by email / visitor id / URL, filters, pagination)
// DELETE: { ids: [...] } or { before: 'YYYY-MM-DD' } (everything that started before that day)

const SORTS = {
  recent: 'r.started_at DESC',
  oldest: 'r.started_at ASC',
  longest: 'duration_sec DESC',
  clicks: 'r.click_count DESC',
  pages: 'r.page_count DESC',
};

async function hasIdentities() {
  try {
    await getRow('SELECT 1 FROM visitor_identities LIMIT 1');
    return true;
  } catch {
    return false;
  }
}

export default withAuth(async function handler(req, res) {
  const { siteId } = req.query;
  const site = await verifySiteOwnership(siteId, req.user.userId);
  if (!site) return res.status(404).json({ error: 'Site not found' });
  await ensureReplayTables();
  const ids = (await getLinkedSiteIds(siteId)).map(String);

  if (req.method === 'DELETE') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    let targets = [];
    if (Array.isArray(body.ids) && body.ids.length) {
      const rows = await getRows('SELECT id, site_id FROM replays WHERE site_id = ANY(?) AND id = ANY(?)', [ids, body.ids.map(String)]);
      targets = rows;
    } else if (body.before && /^\d{4}-\d{2}-\d{2}$/.test(body.before)) {
      targets = await getRows('SELECT id, site_id FROM replays WHERE site_id = ANY(?) AND started_at < ?::date', [ids, body.before]);
    } else {
      return res.status(400).json({ error: 'Pass ids or before' });
    }
    let deleted = 0;
    const bySite = new Map();
    for (const t of targets) bySite.set(t.site_id, [...(bySite.get(t.site_id) || []), t.id]);
    for (const [sid, list] of bySite) deleted += await deleteReplays(sid, list);
    return res.status(200).json({ deleted });
  }

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  await Promise.all(ids.map((id) => pruneExpiredReplays(id).catch(() => 0)));

  const range = parseDateRange(req.query);
  const from = range.from;
  const to = range.to + ' 23:59:59';
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const search = String(req.query.search || '').trim();
  const minSeconds = Math.max(0, parseInt(req.query.min_seconds, 10) || 0);
  const order = SORTS[req.query.sort] || SORTS.recent;
  const identities = await hasIdentities();

  const params = [];
  const add = (v) => { params.push(v); return '?'; };
  const where = [`r.site_id = ANY(${add(ids)})`, `r.started_at BETWEEN ${add(from)} AND ${add(to)}`];
  if (minSeconds) where.push(`EXTRACT(EPOCH FROM (r.ended_at - r.started_at)) >= ${add(minSeconds)}`);
  if (req.query.identified === '1') where.push('vi.email IS NOT NULL');
  if (req.query.clicked === '1') where.push('r.click_count > 0');
  if (['desktop', 'mobile', 'tablet'].includes(req.query.device)) where.push(`LOWER(s.device_type) = ${add(req.query.device)}`);
  if (search) {
    const like = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push(`(${identities ? `vi.email ILIKE ${add(like)} OR ` : ''}r.visitor_id ILIKE ${add(like)}
      OR r.session_id ILIKE ${add(like)} OR array_to_string(r.urls, ' ') ILIKE ${add(like)})`);
  }

  const identityJoin = identities
    ? `LEFT JOIN LATERAL (
         SELECT email FROM visitor_identities
         WHERE site_id = r.site_id AND visitor_id = r.visitor_id
         ORDER BY created_at DESC LIMIT 1
       ) vi ON true`
    : 'LEFT JOIN LATERAL (SELECT NULL::text AS email) vi ON true';

  const rows = await getRows(
    `SELECT r.id, r.site_id, r.session_id, r.visitor_id, r.started_at, r.ended_at, r.chunk_count, r.bytes,
            r.event_count, r.first_url, r.last_url, r.page_count, r.click_count, r.key_count,
            EXTRACT(EPOCH FROM (r.ended_at - r.started_at)) AS duration_sec,
            vi.email, s.country, s.city, s.browser, s.os, s.device_type,
            COALESCE(NULLIF(s.utm_source, ''), NULLIF(s.referrer_domain, ''), 'Direct') AS source,
            COUNT(*) OVER () AS total_count
     FROM replays r
     ${identityJoin}
     LEFT JOIN LATERAL (
       SELECT country, city, browser, os, device_type, utm_source, referrer_domain
       FROM sessions WHERE id = r.session_id AND site_id::text = r.site_id LIMIT 1
     ) s ON true
     WHERE ${where.join(' AND ')}
     ORDER BY ${order}, r.id
     LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
    params
  );

  const [usage, settings] = await Promise.all([
    getRow(
      `SELECT COUNT(*) AS replays, COALESCE(SUM(bytes), 0) AS bytes, MIN(started_at) AS oldest
       FROM replays WHERE site_id = ANY(?)`,
      [ids]
    ),
    getReplaySettings(siteId),
  ]);
  const mode = storageMode();
  const dbUsed = mode === 'db'
    ? Number((await getRow(`SELECT COALESCE(SUM(size), 0) AS n FROM replay_chunks WHERE storage = 'db'`)).n)
    : null;

  const total = rows[0] ? Number(rows[0].total_count) : 0;
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    site: { id: site.id, name: site.name, domain: site.domain },
    replays: rows.map(({ total_count, ...r }) => ({
      ...r,
      duration_sec: Math.max(0, Math.round(Number(r.duration_sec) || 0)),
      bytes: Number(r.bytes),
    })),
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    usage: {
      replays: Number(usage.replays),
      bytes: Number(usage.bytes),
      oldest: usage.oldest,
      storage: mode,
      dbUsedBytes: dbUsed,
      dbCapBytes: mode === 'db' ? DB_FALLBACK_CAP_BYTES : null,
    },
    settings,
  });
});
