import { getRow, getRows } from '@/lib/db';
import { withAuth } from '@/lib/withAuth';
import { verifySiteOwnership } from '@/lib/analytics';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { siteId, visitorId, conversionId } = req.query;
  if (!visitorId) {
    return res.status(400).json({ error: 'visitorId is required' });
  }

  const site = await verifySiteOwnership(siteId, req.user.userId);
  if (!site) return res.status(404).json({ error: 'Site not found' });

  // Get the conversion record
  let conversion = null;
  if (conversionId) {
    conversion = await getRow(
      `SELECT * FROM conversions WHERE id = ? AND site_id = ? AND visitor_id = ?`,
      [conversionId, siteId, visitorId]
    );
  } else {
    conversion = await getRow(
      `SELECT * FROM conversions
       WHERE site_id = ? AND visitor_id = ? AND status = 'completed'
       ORDER BY created_at DESC LIMIT 1`,
      [siteId, visitorId]
    );
  }

  // Get ALL sessions and page views in parallel
  const [sessions, pageViews] = await Promise.all([
    getRows(
      `SELECT id, started_at, last_activity, entry_page, exit_page,
              country, city, browser, os, device_type,
              referrer, referrer_domain, utm_source, utm_medium, utm_campaign,
              page_count, duration, is_bounce
       FROM sessions
       WHERE site_id = ? AND visitor_id = ?
       ORDER BY started_at ASC
       LIMIT 50`,
      [siteId, visitorId]
    ),
    getRows(
      `SELECT id, session_id, pathname, hostname, querystring, timestamp
       FROM page_views
       WHERE site_id = ? AND visitor_id = ?
       ORDER BY timestamp ASC
       LIMIT 500`,
      [siteId, visitorId]
    ),
  ]);

  // Group page views by session
  const pageViewsBySession = {};
  for (const pv of pageViews) {
    if (!pageViewsBySession[pv.session_id]) {
      pageViewsBySession[pv.session_id] = [];
    }
    pageViewsBySession[pv.session_id].push(pv);
  }

  // Assemble sessions with their page views
  const sessionsWithPages = sessions.map((session) => ({
    ...session,
    pageViews: pageViewsBySession[session.id] || [],
  }));

  // Compute time-to-complete
  let timeToComplete = null;
  if (conversion && sessions.length > 0) {
    const firstVisit = new Date(sessions[0].started_at);
    const conversionTime = new Date(conversion.created_at);
    timeToComplete = Math.round((conversionTime - firstVisit) / 1000);
  }

  res.status(200).json({
    visitor: {
      id: visitorId,
      totalSessions: sessions.length,
      totalPageViews: pageViews.length,
      firstVisit: sessions[0]?.started_at || null,
      lastVisit: sessions[sessions.length - 1]?.last_activity || null,
    },
    conversion: conversion || null,
    timeToComplete,
    sessions: sessionsWithPages,
  });
});
