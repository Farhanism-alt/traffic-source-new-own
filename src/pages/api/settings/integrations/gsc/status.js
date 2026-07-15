import { withAuth } from '@/lib/withAuth';
import { getUserConnection } from '@/lib/gsc';

export default withAuth(async function handler(req, res) {
  const conn = await getUserConnection(req.user.userId);
  res.setHeader('Cache-Control', 'private, max-age=60');
  if (!conn) return res.status(200).json({ connected: false });
  return res.status(200).json({
    connected: true,
    email: conn.google_email,
    connectedAt: conn.connected_at,
    lastError: conn.last_error,
  });
});
