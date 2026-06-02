import { getRow, getRows } from '@/lib/db';
import { withAuth } from '@/lib/withAuth';
import { verifySiteOwnership } from '@/lib/analytics';
import { lookupVisitorByEmail } from '@/lib/visitor-identity';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { siteId, visitorId, conversionId } = req.query;

  const site = await verifySiteOwnership(siteId, req.user.userId);
  if (!site) return res.status(404).json({ error: 'Site not found' });

  // Look up conversion — by id+site_id only (no visitor_id requirement so
  // payments synced without ts_visitor_id metadata still show the correct amount)
  let conversion = null;
  if (conversionId) {
    conversion = await getRow(
      `SELECT * FROM conversions WHERE id = ? AND site_id = ?`,
      [conversionId, siteId]
    );
  } else if (visitorId) {
    conversion = await getRow(
      `SELECT * FROM conversions
       WHERE site_id = ? AND visitor_id = ? AND status = 'completed'
       ORDER BY created_at DESC LIMIT 1`,
      [siteId, visitorId]
    );
  }

  // Use the visitor_id from the query, then from the conversion row, then from email identity lookup
  let effectiveVisitorId = (visitorId && visitorId !== 'null') ? visitorId : (conversion?.visitor_id || null);
  if (!effectiveVisitorId && conversion?.stripe_customer_email) {
    effectiveVisitorId = await lookupVisitorByEmail(siteId, conversion.stripe_customer_email);
  }
  // Fallback: resolve visitor_id via the conversion's session_id
  if (!effectiveVisitorId && conversion?.session_id) {
    const linkedSess = await getRow(
      'SELECT visitor_id FROM sessions WHERE id = ? AND site_id = ?',
      [conversion.session_id, siteId]
    );
    if (linkedSess?.visitor_id) effectiveVisitorId = linkedSess.visitor_id;
  }
  // Fallback: find visitor_id from an older conversion with the same email that was already linked
  if (!effectiveVisitorId && conversion?.stripe_customer_email) {
    const prevConv = await getRow(
      `SELECT visitor_id FROM conversions WHERE site_id = ? AND stripe_customer_email = ? AND visitor_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
      [siteId, conversion.stripe_customer_email]
    );
    if (prevConv?.visitor_id) effectiveVisitorId = prevConv.visitor_id;
  }

  // Sessions and page views only when we have a real visitor id to look up
  let sessions = [];
  let pageViews = [];

  if (effectiveVisitorId) {
    [sessions, pageViews] = await Promise.all([
      getRows(
        `SELECT id, started_at, last_activity, entry_page, exit_page,
                country, city, browser, os, device_type,
                referrer, referrer_domain, utm_source, utm_medium, utm_campaign,
                page_count, duration, is_bounce
         FROM sessions
         WHERE site_id = ? AND visitor_id = ?
         ORDER BY started_at ASC
         LIMIT 50`,
        [siteId, effectiveVisitorId]
      ),
      getRows(
        `SELECT id, session_id, pathname, hostname, querystring, timestamp
         FROM page_views
         WHERE site_id = ? AND visitor_id = ?
         ORDER BY timestamp ASC
         LIMIT 500`,
        [siteId, effectiveVisitorId]
      ),
    ]);
  }

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
      id: effectiveVisitorId,
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
