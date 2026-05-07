import { query } from '@/lib/db';

export default async function handler(req, res) {
  const dbUrl = process.env.DATABASE_URL;
  const masked = dbUrl
    ? dbUrl.replace(/:([^:@]+)@/, ':***@').substring(0, 80)
    : 'NOT SET';

  const tables = ['users', 'sites', 'sessions', 'page_views', 'daily_stats', 'conversions', 'affiliates', 'affiliate_visits'];
  const results = {};

  for (const table of tables) {
    try {
      const r = await query(`SELECT COUNT(*)::int as n FROM ${table}`);
      results[table] = { ok: true, count: r.rows[0].n };
    } catch (err) {
      results[table] = { ok: false, error: err.message };
    }
  }

  return res.status(200).json({
    db_url_preview: masked,
    tables: results,
  });
}
