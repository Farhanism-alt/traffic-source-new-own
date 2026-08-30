import { run, getRow } from '@/lib/db';

export default async function handler(req, res) {
  // Support CORS for server-to-server or webhook calls
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};
    let siteId = body.site_id || body.siteId || req.query.site_id || req.query.siteId;
    let email = body.email;
    let visitorId = body.visitor_id || body.visitorId;

    // Handle Supabase Auth Webhook format (auth.users INSERT event)
    if (!email && body.record && body.record.email) {
      email = body.record.email;
      visitorId = body.record.raw_user_meta_data?.visitor_id || body.record.user_metadata?.visitor_id || null;
      if (!siteId) {
        siteId = body.record.raw_user_meta_data?.site_id || body.record.user_metadata?.site_id || '1';
      }
    }

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    email = String(email).trim().toLowerCase();
    siteId = String(siteId || '1');

    // If visitorId is not explicitly provided, find the most recent session from the same IP/domain or fallback
    if (!visitorId) {
      const recentSession = await getRow(
        'SELECT visitor_id FROM sessions WHERE site_id::text = ?::text ORDER BY started_at DESC LIMIT 1',
        [siteId]
      );
      visitorId = recentSession?.visitor_id || `srv_${Math.random().toString(36).slice(2, 11)}`;
    }

    // Upsert into visitor_identities
    await run(
      `INSERT INTO visitor_identities (site_id, visitor_id, email, created_at)
       VALUES (?, ?, ?, NOW())
       ON CONFLICT (site_id, email)
       DO UPDATE SET visitor_id = EXCLUDED.visitor_id`,
      [siteId, visitorId, email]
    );

    return res.status(200).json({
      success: true,
      message: `Successfully identified ${email} for site ${siteId}`,
      siteId,
      email,
      visitorId,
    });
  } catch (err) {
    console.error('Server identification webhook error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
