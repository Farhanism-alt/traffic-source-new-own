import { getRow } from '@/lib/db';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const row = await getRow('SELECT COUNT(*)::int as count FROM users');
  const count = row ? row.count : 0;

  res.status(200).json({ hasUsers: count > 0 });
}
