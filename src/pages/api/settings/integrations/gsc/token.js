import { withAuth } from '@/lib/withAuth';
import { run, getRow } from '@/lib/db';
import { encrypt, decrypt } from '@/lib/crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

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
  await run(`ALTER TABLE google_tokens ADD COLUMN IF NOT EXISTS refresh_token TEXT`);
}

export default withAuth(async function handler(req, res) {
  await ensureTable();
  const userId = req.user.userId;

  if (req.method === 'GET') {
    const row = await getRow(
      `SELECT google_email, token_expires_at, refresh_token FROM google_tokens WHERE user_id = ?`,
      [userId]
    );
    if (!row) return res.json({ connected: false });
    const expired = new Date(row.token_expires_at) < new Date();
    const connected = !expired || !!row.refresh_token;
    return res.json({ connected, email: row.google_email || '' });
  }

  if (req.method === 'POST') {
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ error: 'code required' });

    const clientId = (process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '').trim();
    const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
    if (!clientId || !clientSecret) {
      return res.status(500).json({ error: 'GOOGLE_CLIENT_SECRET not configured on server' });
    }

    let tokenData;
    try {
      const tokenRes = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: 'postmessage',
          grant_type: 'authorization_code',
        }),
      });
      if (!tokenRes.ok) {
        const errText = await tokenRes.text();
        // Include the client_id suffix so a client_id/secret mismatch is easy to spot
        const idHint = `${clientId.slice(0, 12)}...`;
        return res.status(400).json({ error: `Token exchange failed (using client_id ${idHint}): ${errText}` });
      }
      tokenData = await tokenRes.json();
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }

    const { access_token, refresh_token, expires_in = 3600 } = tokenData;
    if (!access_token) return res.status(400).json({ error: 'No access_token in response' });

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
    const encryptedRefresh = refresh_token ? encrypt(refresh_token) : null;

    await run(
      `INSERT INTO google_tokens (user_id, access_token, token_expires_at, google_email, refresh_token)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET
         access_token = EXCLUDED.access_token,
         token_expires_at = EXCLUDED.token_expires_at,
         google_email = EXCLUDED.google_email,
         refresh_token = COALESCE(EXCLUDED.refresh_token, google_tokens.refresh_token),
         connected_at = NOW()`,
      [userId, access_token, expiresAt, email, encryptedRefresh]
    );

    return res.json({ connected: true, email: email || '' });
  }

  if (req.method === 'DELETE') {
    await run(`DELETE FROM google_tokens WHERE user_id = ?`, [userId]);
    return res.json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
});
