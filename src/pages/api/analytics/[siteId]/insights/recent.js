import { withAuth } from '@/lib/withAuth';
import { verifySiteOwnership } from '@/lib/analytics';
import { getRows } from '@/lib/db';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { siteId } = req.query;
  const site = await verifySiteOwnership(siteId, req.user.userId);
  if (!site) return res.status(404).json({ error: 'Site not found' });

  const insights = await getRows(
    `SELECT id, period, created_at, insights FROM ai_insights WHERE site_id = ? ORDER BY created_at DESC LIMIT 10`,
    [siteId]
  ).catch(() => []);

  return res.json({ insights: insights || [] });
});
