import { getRows, getRow } from '@/lib/db';
import { withAuth } from '@/lib/withAuth';
import { verifySiteOwnership, getLinkedSiteIds } from '@/lib/analytics';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { siteId, email } = req.query;
  const site = await verifySiteOwnership(siteId, req.user.userId);
  if (!site) return res.status(404).json({ error: 'Site not found' });

  const decodedEmail = decodeURIComponent(email || '').trim().toLowerCase();
  if (!decodedEmail) return res.status(400).json({ error: 'Email is required' });

  const linkedIds = await getLinkedSiteIds(siteId);
  const linkedIdStrings = linkedIds.map(String);

  // Look up identity across linked sites
  const identity = await getRow(
    'SELECT * FROM visitor_identities WHERE site_id = ANY(?) AND email = ? ORDER BY created_at ASC LIMIT 1',
    [linkedIdStrings, decodedEmail]
  );

  // Fallback: If not in visitor_identities table yet, check if in conversions
  let visitorId = identity?.visitor_id || null;
  if (!visitorId) {
    const conv = await getRow(
      'SELECT visitor_id FROM conversions WHERE site_id::text = ANY(?) AND stripe_customer_email = ? AND visitor_id IS NOT NULL ORDER BY created_at DESC LIMIT 1',
      [linkedIdStrings, decodedEmail]
    );
    visitorId = conv?.visitor_id || null;
  }

  if (!visitorId && !identity) {
    return res.status(404).json({ error: 'Person not found' });
  }

  // Fetch all sessions for this visitor across linked sites
  const sessions = visitorId
    ? await getRows(
        `SELECT id, started_at, last_activity, entry_page, exit_page,
                referrer, referrer_domain, utm_source, utm_medium, utm_campaign, utm_term, utm_content,
                country, city, continent, browser, browser_version, os, os_version, device_type,
                page_count, is_bounce, duration
         FROM sessions
         WHERE site_id::text = ANY(?) AND visitor_id = ?
         ORDER BY started_at DESC`,
        [linkedIdStrings, visitorId]
      )
    : [];

  // Fetch all pageviews
  const pageViews = visitorId
    ? await getRows(
        `SELECT id, session_id, pathname, hostname, querystring, referrer, timestamp
         FROM page_views
         WHERE site_id::text = ANY(?) AND visitor_id = ?
         ORDER BY timestamp ASC`,
        [linkedIdStrings, visitorId]
      )
    : [];

  // Fetch all custom events
  const events = visitorId
    ? await getRows(
        `SELECT id, session_id, name, properties, created_at
         FROM events
         WHERE site_id::text = ANY(?) AND visitor_id = ?
         ORDER BY created_at ASC`,
        [linkedIdStrings, visitorId]
      ).catch(() => [])
    : [];

  // Fetch conversions
  const conversions = await getRows(
    `SELECT id, session_id, visitor_id, amount, currency, status, payment_provider, payment_intent_id,
            utm_source, utm_medium, utm_campaign, referrer_domain, created_at
     FROM conversions
     WHERE site_id::text = ANY(?) AND (visitor_id = ? OR stripe_customer_email = ?)
     ORDER BY created_at ASC`,
    [linkedIdStrings, visitorId || '', decodedEmail]
  );

  // Group page views & events by session
  const pageViewsBySession = {};
  for (const pv of pageViews) {
    if (!pageViewsBySession[pv.session_id]) pageViewsBySession[pv.session_id] = [];
    pageViewsBySession[pv.session_id].push(pv);
  }

  const eventsBySession = {};
  for (const ev of events) {
    if (!eventsBySession[ev.session_id]) eventsBySession[ev.session_id] = [];
    eventsBySession[ev.session_id].push(ev);
  }

  // Construct comprehensive chronological timeline
  const timeline = [];

  // 1. Session entries
  for (const s of sessions) {
    timeline.push({
      type: 'session_start',
      timestamp: s.started_at,
      sessionId: s.id,
      title: 'Session Started',
      hostname: s.entry_page,
      data: s,
    });
  }

  // 2. Page views
  for (const pv of pageViews) {
    timeline.push({
      type: 'pageview',
      timestamp: pv.timestamp,
      sessionId: pv.session_id,
      title: pv.pathname,
      hostname: pv.hostname,
      data: pv,
    });
  }

  // 3. Events (Sign Up, Login, Custom Events)
  for (const ev of events) {
    timeline.push({
      type: 'event',
      timestamp: ev.created_at,
      sessionId: ev.session_id,
      title: `Event: ${ev.name}`,
      data: ev,
    });
  }

  // 4. Identity confirmation
  if (identity?.created_at) {
    timeline.push({
      type: 'identify',
      timestamp: identity.created_at,
      title: `Identified as ${decodedEmail}`,
      data: identity,
    });
  }

  // 5. Conversions / Purchases
  for (const conv of conversions) {
    timeline.push({
      type: 'conversion',
      timestamp: conv.created_at,
      sessionId: conv.session_id,
      title: `Payment: $${(conv.amount / 100).toFixed(2)} ${conv.currency.toUpperCase()}`,
      data: conv,
    });
  }

  // Sort timeline chronologically (latest first or earliest first - let's sort newest first)
  timeline.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const firstSession = sessions[sessions.length - 1];
  const lastSession = sessions[0];
  const totalSpent = conversions
    .filter((c) => c.status === 'completed')
    .reduce((acc, c) => acc + (c.amount || 0), 0);

  res.setHeader('Cache-Control', 'private, max-age=10');
  res.status(200).json({
    person: {
      email: decodedEmail,
      visitorId,
      identifiedAt: identity?.created_at || conversions[0]?.created_at || null,
      firstSeen: firstSession?.started_at || null,
      lastSeen: lastSession?.last_activity || lastSession?.started_at || null,
      acquisitionSource: firstSession?.utm_source || firstSession?.referrer_domain || 'Direct',
      acquisitionCampaign: firstSession?.utm_campaign || null,
      country: firstSession?.country || null,
      city: firstSession?.city || null,
      browser: firstSession?.browser || null,
      os: firstSession?.os || null,
      deviceType: firstSession?.device_type || null,
      totalSessions: sessions.length,
      totalPageViews: pageViews.length,
      totalEvents: events.length,
      totalConversions: conversions.length,
      totalSpent,
      spentCurrency: conversions[0]?.currency || 'usd',
    },
    sessions: sessions.map((s) => ({
      ...s,
      pageViews: pageViewsBySession[s.id] || [],
      events: eventsBySession[s.id] || [],
    })),
    conversions,
    timeline,
  });
});
