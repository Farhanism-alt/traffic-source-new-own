import { getDb } from '@/lib/db';

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const adminSecret = process.env.JWT_SECRET;
  if (!adminSecret) {
    return res.status(500).json({ error: 'JWT_SECRET not configured on server' });
  }

  const provided = req.headers['x-admin-secret'] || req.body?.secret;
  if (provided !== adminSecret) {
    return res.status(401).json({ error: 'Invalid admin secret' });
  }

  try {
    const db = getDb();
    const result = db.prepare('DELETE FROM users').run();
    return res.status(200).json({
      success: true,
      deleted: result.changes,
      message: 'All user accounts deleted. You can now register a fresh admin account at /register',
    });
  } catch (err) {
    console.error('Reset error:', err);
    return res.status(500).json({ error: err.message });
  }
}
