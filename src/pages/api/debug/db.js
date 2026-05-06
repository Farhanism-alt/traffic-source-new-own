import { query } from '@/lib/db';

export default async function handler(req, res) {
  const dbUrl = process.env.DATABASE_URL;
  const masked = dbUrl
    ? dbUrl.replace(/:([^:@]+)@/, ':***@').substring(0, 80)
    : 'NOT SET';

  try {
    const result = await query('SELECT COUNT(*)::int as users FROM users');
    return res.status(200).json({
      ok: true,
      db_url_set: !!dbUrl,
      db_url_preview: masked,
      users_count: result.rows[0].users,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      db_url_set: !!dbUrl,
      db_url_preview: masked,
      error: err.message,
      code: err.code,
    });
  }
}
