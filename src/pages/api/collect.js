import { getRow, run } from '@/lib/db';
import { normalizeSource } from '@/lib/sources';
import { upsertVisitorIdentity } from '@/lib/visitor-identity';
const UAParser = require('ua-parser-js');

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '32kb',
    },
  },
};

let eventsReady = null;
function ensureEventsTable() {
  if (!eventsReady) {
    eventsReady = run(`CREATE TABLE IF NOT EXISTS events (
      id BIGSERIAL PRIMARY KEY,
      site_id TEXT NOT NULL,
      session_id TEXT,
      visitor_id TEXT,
      name TEXT NOT NULL,
      properties JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`).then(() => run(`CREATE INDEX IF NOT EXISTS idx_events_site_name_at ON events(site_id, name, created_at)`))
      .catch(() => { eventsReady = null; });
  }
  return eventsReady;
}

// Site-existence cache: most hits skip the `SELECT id FROM sites` round-trip.
// Fluid instances serve many requests, so this stays warm between calls.
const SITE_TTL_MS = 10 * 60 * 1000;
const MISSING_SITE_TTL_MS = 60 * 1000;
const siteCache = new Map();

async function siteExists(siteId) {
  const key = String(siteId);
  const hit = siteCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.ok;
  const row = await getRow('SELECT id FROM sites WHERE id = ?', [key]);
  const ok = !!row;
  if (siteCache.size > 5000) siteCache.clear();
  siteCache.set(key, { ok, exp: Date.now() + (ok ? SITE_TTL_MS : MISSING_SITE_TTL_MS) });
  return ok;
}

// Set to false if `sessions.id` has no unique constraint for ON CONFLICT (Postgres 42P10)
let sessionUpsertSupported = true;

const MAX_BATCH = 25;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).end();
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).end();
  }
  if (!body) return res.status(400).end();

  // The tracker sends either a single hit or { batch: [...] }
  const items = Array.isArray(body.batch) ? body.batch.slice(0, MAX_BATCH) : [body];

  let status = 204;
  for (const data of items) {
    try {
      const code = await processHit(data, req);
      if (items.length === 1 && code !== 200) status = code;
    } catch (err) {
      console.error('Collection error:', err);
      status = 500;
    }
  }
  res.status(status).end();
}

async function processHit(data, req) {
  if (!data || !data.site_id || !data.visitor_id || !data.session_id || !data.type) {
    return 400;
  }

  if (!(await siteExists(data.site_id))) return 404;

  // Heartbeat: only refresh last_activity, no new records
  if (data.type === 'heartbeat') {
    await run('UPDATE sessions SET last_activity = NOW() WHERE id = ? AND site_id = ?', [
      data.session_id,
      data.site_id,
    ]);
    return 200;
  }

  // Identify: link visitor_id to an email address
  if (data.type === 'identify') {
    const email = (data.email || '').trim().toLowerCase();
    if (!email || email.indexOf('@') < 1) return 400;
    await upsertVisitorIdentity(data.site_id, data.visitor_id, email);
    return 200;
  }

  // Custom event
  if (data.type === 'event') {
    if (!data.name) return 400;
    await ensureEventsTable();
    await run(
      `INSERT INTO events (site_id, session_id, visitor_id, name, properties) VALUES (?, ?, ?, ?, ?)`,
      [data.site_id, data.session_id, data.visitor_id, String(data.name).slice(0, 100), JSON.stringify(data.props || {})]
    );
    return 200;
  }

  const ua = new UAParser(req.headers['user-agent']);
  const browser = ua.getBrowser();
  const os = ua.getOS();
  const device = ua.getDevice();

  // Use Vercel geo headers first, then Cloudflare
  let country =
    req.headers['x-vercel-ip-country'] || req.headers['cf-ipcountry'] || null;
  let city = null;
  try {
    city = req.headers['x-vercel-ip-city']
      ? decodeURIComponent(req.headers['x-vercel-ip-city'])
      : req.headers['cf-ipcity'] || null;
  } catch {
    city = req.headers['x-vercel-ip-city'] || null;
  }
  let continent =
    req.headers['x-vercel-ip-continent'] || req.headers['cf-ipcontinent'] || null;

  let referrerDomain = null;
  if (data.referrer) {
    try {
      referrerDomain = normalizeSource(new URL(data.referrer).hostname);
    } catch {
      // invalid referrer URL
    }
  }

  const deviceType =
    device.type ||
    (data.screen_width < 768
      ? 'mobile'
      : data.screen_width < 1024
        ? 'tablet'
        : 'desktop');

  const sessionValues = [
    data.session_id,
    data.site_id,
    data.visitor_id,
    data.pathname,
    data.pathname,
    data.referrer || null,
    referrerDomain,
    data.utm_source || data.ref || data.source || data.via || null,
    data.utm_medium || null,
    data.utm_campaign || null,
    data.utm_term || null,
    data.utm_content || null,
    country,
    city,
    continent,
    browser.name || null,
    browser.version || null,
    os.name || null,
    os.version || null,
    deviceType,
    data.screen_width || null,
    data.screen_height || null,
  ];

  const isNewSession = await upsertSession(sessionValues, data);

  // Affiliate tracking
  if (data.ref) {
    // Single statement: insert the visit only if the affiliate exists and this
    // visitor/session was not already recorded for it.
    await run(
      `INSERT INTO affiliate_visits (affiliate_id, site_id, visitor_id, session_id, landing_page)
       SELECT a.id, ?, ?, ?, ?
       FROM affiliates a
       WHERE a.site_id = ? AND a.slug = ?
         AND NOT EXISTS (
           SELECT 1 FROM affiliate_visits av
           WHERE av.affiliate_id = a.id AND av.visitor_id = ? AND av.session_id = ?
         )
       LIMIT 1`,
      [
        data.site_id, data.visitor_id, data.session_id, data.pathname,
        data.site_id, data.ref,
        data.visitor_id, data.session_id,
      ]
    );
  }

  if (data.type === 'pageview') {
    let querystring = null;
    try {
      querystring = new URL(data.url).search || null;
    } catch {
      // invalid URL
    }

    const today = new Date().toISOString().slice(0, 10);

    // One round-trip: record the page view and bump today's counters.
    // A new session also counts a visitor if they had no other session today.
    await run(
      `WITH pv AS (
         INSERT INTO page_views (site_id, session_id, visitor_id, pathname, hostname, querystring, referrer)
         VALUES (?, ?, ?, ?, ?, ?, ?)
       ),
       delta AS (
         SELECT
           CASE WHEN ?::boolean THEN 1 ELSE 0 END AS sessions,
           CASE WHEN ?::boolean AND NOT EXISTS (
             SELECT 1 FROM sessions
             WHERE site_id = ? AND visitor_id = ? AND DATE(started_at) = ?::date AND id != ?
           ) THEN 1 ELSE 0 END AS visitors
       )
       INSERT INTO daily_stats (site_id, date, page_views, sessions, visitors)
       SELECT ?, ?::date, 1, delta.sessions, delta.visitors FROM delta
       ON CONFLICT (site_id, date) DO UPDATE SET
         page_views = daily_stats.page_views + 1,
         sessions = daily_stats.sessions + EXCLUDED.sessions,
         visitors = daily_stats.visitors + EXCLUDED.visitors`,
      [
        data.site_id,
        data.session_id,
        data.visitor_id,
        data.pathname,
        data.hostname || null,
        querystring,
        data.referrer || null,
        isNewSession,
        isNewSession,
        data.site_id,
        data.visitor_id,
        today,
        data.session_id,
        data.site_id,
        today,
      ]
    );
  }

  return 200;
}

const SESSION_COLUMNS = `
  id, site_id, visitor_id, entry_page, exit_page,
  referrer, referrer_domain, utm_source, utm_medium, utm_campaign,
  utm_term, utm_content, country, city, continent,
  browser, browser_version, os, os_version, device_type,
  screen_width, screen_height,
  page_count, is_bounce, duration, last_activity`;
const SESSION_PLACEHOLDERS = `?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, true, 0, NOW()`;

// Creates the session or records another page on it. Returns true when the session is new.
async function upsertSession(values, data) {
  if (sessionUpsertSupported) {
    try {
      const r = await run(
        `INSERT INTO sessions (${SESSION_COLUMNS}) VALUES (${SESSION_PLACEHOLDERS})
         ON CONFLICT (id) DO UPDATE SET
           exit_page = EXCLUDED.exit_page,
           last_activity = NOW(),
           page_count = sessions.page_count + 1,
           is_bounce = false,
           duration = EXTRACT(EPOCH FROM NOW() - sessions.started_at)::INTEGER
         RETURNING (xmax = 0) AS inserted`,
        values
      );
      return !!r.rows[0]?.inserted;
    } catch (err) {
      if (err.code !== '42P10') throw err;
      sessionUpsertSupported = false;
    }
  }

  // Fallback when sessions.id has no unique constraint
  const existing = await getRow('SELECT id FROM sessions WHERE id = ?', [data.session_id]);
  if (!existing) {
    await run(`INSERT INTO sessions (${SESSION_COLUMNS}) VALUES (${SESSION_PLACEHOLDERS})`, values);
    return true;
  }
  await run(
    `UPDATE sessions SET
      exit_page = ?,
      last_activity = NOW(),
      page_count = page_count + 1,
      is_bounce = false,
      duration = EXTRACT(EPOCH FROM NOW() - started_at)::INTEGER
    WHERE id = ?`,
    [data.pathname, data.session_id]
  );
  return false;
}
