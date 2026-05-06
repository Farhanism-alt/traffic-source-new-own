import { getRow, run } from '@/lib/db';
import { withAuth } from '@/lib/withAuth';
import { verifySiteOwnership } from '@/lib/analytics';

export default withAuth(async function handler(req, res) {
  const { id: siteId, affiliateId } = req.query;
  const site = await verifySiteOwnership(siteId, req.user.userId);
  if (!site) return res.status(404).json({ error: 'Site not found' });

  const affiliate = await getRow(
    'SELECT * FROM affiliates WHERE id = ? AND site_id = ?',
    [affiliateId, siteId]
  );
  if (!affiliate) return res.status(404).json({ error: 'Affiliate not found' });

  if (req.method === 'GET') {
    return res.status(200).json({ affiliate });
  }

  if (req.method === 'PUT') {
    const { name, slug, commission_rate } = req.body;
    const updates = [];
    const params = [];

    if (name) { updates.push('name = ?'); params.push(name); }
    if (slug) {
      const slugClean = slug.toLowerCase().replace(/[^a-z0-9-_]/g, '');
      const existing = await getRow(
        'SELECT id FROM affiliates WHERE site_id = ? AND slug = ? AND id != ?',
        [siteId, slugClean, affiliateId]
      );
      if (existing) return res.status(409).json({ error: 'Slug already exists' });
      updates.push('slug = ?');
      params.push(slugClean);
    }
    if (commission_rate !== undefined) { updates.push('commission_rate = ?'); params.push(commission_rate); }

    if (updates.length > 0) {
      params.push(affiliateId);
      await run(`UPDATE affiliates SET ${updates.join(', ')} WHERE id = ?`, params);
    }

    const updated = await getRow('SELECT * FROM affiliates WHERE id = ?', [affiliateId]);
    return res.status(200).json({ affiliate: updated });
  }

  if (req.method === 'DELETE') {
    await run('DELETE FROM affiliates WHERE id = ?', [affiliateId]);
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
});
