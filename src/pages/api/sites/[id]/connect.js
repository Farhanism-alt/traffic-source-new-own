import { getRows, run } from '@/lib/db';
import { withAuth } from '@/lib/withAuth';
import { verifySiteOwnership, ensureConnectedSitesTable, getLinkedSiteIds } from '@/lib/analytics';

export default withAuth(async function handler(req, res) {
  const siteId = req.query.id || req.query.siteId;
  const site = await verifySiteOwnership(siteId, req.user.userId);
  if (!site) return res.status(404).json({ error: 'Site not found' });

  await ensureConnectedSitesTable();
  const currentSiteId = parseInt(siteId, 10);

  if (req.method === 'GET') {
    // Get all sites owned by the user
    const userSites = await getRows(
      'SELECT id, name, domain FROM sites WHERE user_id = ? ORDER BY name ASC',
      [req.user.userId]
    );

    // Get linked site IDs
    const linkedIds = await getLinkedSiteIds(currentSiteId);
    const connectedIds = linkedIds.filter((id) => id !== currentSiteId);

    const connectedSites = userSites.filter((s) => connectedIds.includes(s.id));
    const availableSites = userSites.filter((s) => s.id !== currentSiteId && !connectedIds.includes(s.id));

    return res.status(200).json({
      connectedSites,
      availableSites,
    });
  }

  if (req.method === 'POST') {
    const { targetSiteId } = req.body;
    const targetId = parseInt(targetSiteId, 10);

    if (!targetId || targetId === currentSiteId) {
      return res.status(400).json({ error: 'Invalid target site ID' });
    }

    // Verify ownership of target site
    const targetSite = await verifySiteOwnership(targetId, req.user.userId);
    if (!targetSite) {
      return res.status(404).json({ error: 'Target site not found or not owned by you' });
    }

    // Insert connection in both directions
    await run(
      `INSERT INTO site_connections (site_id, connected_site_id)
       VALUES (?, ?)
       ON CONFLICT DO NOTHING`,
      [currentSiteId, targetId]
    );

    return res.status(200).json({
      success: true,
      message: `Connected ${site.name} (${site.domain}) with ${targetSite.name} (${targetSite.domain})`,
    });
  }

  if (req.method === 'DELETE') {
    const { targetSiteId } = req.body;
    const targetId = parseInt(targetSiteId, 10);

    if (!targetId) {
      return res.status(400).json({ error: 'Invalid target site ID' });
    }

    await run(
      `DELETE FROM site_connections
       WHERE (site_id = ? AND connected_site_id = ?)
          OR (site_id = ? AND connected_site_id = ?)`,
      [currentSiteId, targetId, targetId, currentSiteId]
    );

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
});
