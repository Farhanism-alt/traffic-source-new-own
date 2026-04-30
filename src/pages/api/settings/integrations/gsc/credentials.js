import { withAuth } from '@/lib/withAuth';
import { getGscCredentials, saveGscCredentials, clearGscCredentials, getRedirectUri } from '@/lib/gsc';

export default withAuth(async function handler(req, res) {
  if (req.method === 'GET') {
    const { clientId, clientSecret } = await getGscCredentials();
    return res.status(200).json({
      configured: !!(clientId && clientSecret),
      clientIdMasked: clientId ? clientId.slice(0, 12) + '…' + clientId.slice(-6) : null,
      hasSecret: !!clientSecret,
      redirectUri: getRedirectUri(req),
    });
  }

  if (req.method === 'POST') {
    const { clientId, clientSecret } = req.body || {};
    if (!clientId || !clientSecret) {
      return res.status(400).json({ error: 'clientId and clientSecret are required' });
    }
    await saveGscCredentials({ clientId: clientId.trim(), clientSecret: clientSecret.trim() });
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    await clearGscCredentials();
    return res.status(200).json({ ok: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
});
