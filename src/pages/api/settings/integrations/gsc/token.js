import { withAuth } from '@/lib/withAuth';
import { run, getRow } from '@/lib/db';

async function ensureTable() {
  await run(`
    CREATE TABLE IF NOT EXISTS google_tokens (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL UNIQUE,
      access_token TEXT NOT NULL,
      token_expires_at TIMESTAMPTZ NOT NULL,
      google_email TEXT,
      connected_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

export default withAuth(async function handler(req, res) {
  await ensureTable();
  const userId = req.user.userId;

  if (req.method === 'GET') {
    const row = await getRow(
      `SELECT google_email, token_expires_at FROM google_tokens WHERE user_id = ?`,
      [userId]
    );
    if (!row) return res.json({ connected: false });
    const expired = new Date(row.token_expires_at) < new Date();
    return res.json({ connected: !expired, email: row.google_email || '' });
  }

  if (req.method === 'POST') {
    const { access_token, expires_in = 3600 } = req.body || {};
    if (!access_token) return res.status(400).json({ error: 'access_token required' });

    let email = null;
    try {
      const gRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      if (gRes.ok) {
        const gData = await gRes.json();
        email = gData.email || null;
      }
    } catch {}

    const expiresAt = new Date(Date.now() + expires_in * 1000).toISOString();

    await run(
      `INSERT INTO google_tokens (user_id, access_token, token_expires_at, google_email)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET
         access_token = EXCLUDED.access_token,
         token_expires_at = EXCLUDED.token_expires_at,
         google_email = EXCLUDED.google_email,
         connected_at = NOW()`,
      [userId, access_token, expiresAt, email]
    );

    return res.json({ connected: true, email: email || '' });
  }

  if (req.method === 'DELETE') {
    await run(`DELETE FROM google_tokens WHERE user_id = ?`, [userId]);
    return res.json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
});
