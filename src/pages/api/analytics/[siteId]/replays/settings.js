import { withAuth } from '@/lib/withAuth';
import { verifySiteOwnership } from '@/lib/analytics';
import { getReplaySettings, saveReplaySettings, storageMode, getStorageConfig, testStorage } from '@/lib/replay';

// GET: settings + storage status. PUT: save settings. POST { test: true }: check the storage bucket.
export default withAuth(async function handler(req, res) {
  const { siteId } = req.query;
  const site = await verifySiteOwnership(siteId, req.user.userId);
  if (!site) return res.status(404).json({ error: 'Site not found' });

  const storage = () => {
    const c = getStorageConfig();
    return { mode: storageMode(), endpoint: c?.endpoint || null, bucket: c?.bucket || null };
  };

  if (req.method === 'GET') {
    return res.status(200).json({ settings: await getReplaySettings(siteId), storage: storage() });
  }
  if (req.method === 'PUT') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    return res.status(200).json({ settings: await saveReplaySettings(siteId, body), storage: storage() });
  }
  if (req.method === 'POST') {
    try {
      await testStorage();
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(200).json({ ok: false, error: err.message || String(err) });
    }
  }
  return res.status(405).json({ error: 'Method not allowed' });
});
