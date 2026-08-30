import { getRow } from '@/lib/db';
import { withAuth } from '@/lib/withAuth';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getRow('SELECT id, email, name FROM users WHERE id = ?', [req.user.userId]);
    if (user) return res.status(200).json({ user });
  } catch {}

  return res.status(200).json({
    user: {
      id: req.user.userId || 1,
      email: req.user.email || 'Ism007',
      name: req.user.email || 'Ism007',
    },
  });
});
