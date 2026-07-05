import { getRow, run } from '@/lib/db';
import { detectCrawler } from '@/lib/crawlers';

let tableReady = null;
function ensureTable() {
  if (!tableReady) {
    tableReady = run(`CREATE TABLE IF NOT EXISTS bot_visits (
      id BIGSERIAL PRIMARY KEY,
      site_id TEXT NOT NULL,
      crawler_token TEXT NOT NULL,
      crawler_name TEXT,
      provider TEXT,
      category TEXT NOT NULL DEFAULT 'other',
      pathname TEXT NOT NULL,
      status_code INTEGER,
      user_agent TEXT,
      ip TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`)
      .then(() => run(`CREATE INDEX IF NOT EXISTS idx_bot_visits_site_at ON bot_visits(site_id, created_at DESC)`))
      .then(() => run(`CREATE INDEX IF NOT EXISTS idx_bot_visits_site_cat ON bot_visits(site_id, category)`))
      .catch(() => { tableReady = null; });
  }
  return tableReady;
}

export const config = {
  api: { bodyParser: { sizeLimit: '2kb' } },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { siteId, pathname, userAgent, statusCode } = body;

    if (!siteId || !pathname) return res.status(400).end();

    const site = await getRow('SELECT id FROM sites WHERE id = ?', [siteId]);
    if (!site) return res.status(404).end();

    const ua = (userAgent || req.headers['user-agent'] || '').slice(0, 500);
    const crawler = detectCrawler(ua);
    if (!crawler) return res.status(200).end();

    const ip =
      (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
      req.headers['cf-connecting-ip'] ||
      req.socket?.remoteAddress ||
      null;

    await ensureTable();
    await run(
      `INSERT INTO bot_visits (site_id, crawler_token, crawler_name, provider, category, pathname, status_code, user_agent, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [siteId, crawler.token, crawler.name, crawler.provider, crawler.category, pathname.slice(0, 500), statusCode || null, ua, ip]
    );

    res.status(200).end();
  } catch (err) {
    console.error('bot-track error:', err);
    res.status(500).end();
  }
}
