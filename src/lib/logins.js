import { getRows } from './db';
import { friendlySourceName, sourceType } from './sources';

// Custom event names that count as a login (or the signup that starts one).
export const LOGIN_EVENT_RE = /(log[\s_-]?in|sign(ed)?[\s_-]?in|sign[\s_-]?up|register)/i;
// Same pattern for Postgres (~*). Passed as a parameter: the db helper treats every ? as a placeholder.
const LOGIN_EVENT_SQL_RE = '(log[[:space:]_-]?in|sign(ed)?[[:space:]_-]?in|sign[[:space:]_-]?up|register)';

/**
 * Everyone who logged in, one row per email, with first/recent login, first-touch source,
 * last activity, location and payments. linkedIds: string site ids.
 * includeIdentified: also count being identified by email (window.__ts.identify) as a login.
 */
export async function queryLogins(linkedIds, { from, to, includeIdentified = false }) {
  // Being identified by email (everyone on All people) counts as a login: the identity row
  // (its time is the latest identify) plus the per-session 'Identified' events logged since.
  const identifiedUnion = includeIdentified
    ? `UNION ALL
       SELECT vi.visitor_id, NULL::text AS session_id, vi.created_at, '_identity' AS name, NULL::text AS provider, LOWER(vi.email) AS email
       FROM visitor_identities vi
       WHERE vi.site_id = ANY(?)
       UNION ALL
       SELECT e.visitor_id, e.session_id, e.created_at, e.name, NULL::text AS provider, LOWER(e.properties->>'_email') AS email
       FROM events e
       WHERE e.site_id = ANY(?) AND e.name = 'Identified'`
    : '';

  const params = [linkedIds, LOGIN_EVENT_SQL_RE];
  if (includeIdentified) params.push(linkedIds, linkedIds);
  params.push(from, to, from, to, from, to, linkedIds, linkedIds, linkedIds, linkedIds);

  const rows = await getRows(
    `WITH le AS (
       SELECT e.visitor_id, e.session_id, e.created_at, e.name, e.properties->>'provider' AS provider,
              LOWER(COALESCE(NULLIF(e.properties->>'_email', ''), vi.email)) AS email
       FROM events e
       LEFT JOIN LATERAL (
         SELECT email FROM visitor_identities v
         WHERE v.site_id = e.site_id AND v.visitor_id = e.visitor_id
         ORDER BY v.created_at DESC LIMIT 1
       ) vi ON true
       WHERE e.site_id = ANY(?) AND e.name ~* ?
       ${identifiedUnion}
     ),
     p AS (
       SELECT email,
              MIN(created_at) AS first_login,
              MAX(created_at) AS last_login,
              -- the identity row marks a time but isn't a login of its own when history exists
              GREATEST(COUNT(*) FILTER (WHERE name <> '_identity'), 1) AS logins,
              GREATEST(COUNT(*) FILTER (WHERE created_at BETWEEN ? AND ? AND name <> '_identity'),
                       CASE WHEN BOOL_OR(created_at BETWEEN ? AND ?) THEN 1 ELSE 0 END) AS logins_in_range,
              BOOL_OR(created_at BETWEEN ? AND ?) AS active_in_range,
              (ARRAY_AGG(provider ORDER BY created_at DESC) FILTER (WHERE provider IS NOT NULL))[1] AS provider,
              ARRAY_AGG(DISTINCT visitor_id) FILTER (WHERE visitor_id IS NOT NULL) AS login_vids
       FROM le
       WHERE email IS NOT NULL AND email LIKE '%@%'
       GROUP BY email
     ),
     pv AS (
       SELECT p.*,
              ARRAY(
                SELECT DISTINCT x FROM unnest(
                  COALESCE(p.login_vids, '{}') ||
                  COALESCE((SELECT ARRAY_AGG(v.visitor_id) FROM visitor_identities v WHERE v.site_id = ANY(?) AND LOWER(v.email) = p.email), '{}')
                ) x
              ) AS vids
       FROM p
     )
     SELECT pv.email, pv.first_login, pv.last_login, pv.logins, pv.logins_in_range, pv.active_in_range, pv.provider,
            fs.utm_source, fs.utm_medium, fs.utm_campaign, fs.referrer, fs.referrer_domain, fs.entry_page, fs.started_at AS first_seen,
            ls.country, ls.city, ls.device_type, ls.browser, ls.last_active,
            pay.payments, pay.spent, pay.currency, pay.last_paid,
            pv.vids[1] AS visitor_id
     FROM pv
     LEFT JOIN LATERAL (
       SELECT utm_source, utm_medium, utm_campaign, referrer, referrer_domain, entry_page, started_at
       FROM sessions WHERE site_id::text = ANY(?) AND visitor_id = ANY(pv.vids)
       ORDER BY started_at ASC LIMIT 1
     ) fs ON true
     LEFT JOIN LATERAL (
       SELECT country, city, device_type, browser, COALESCE(last_activity, started_at) AS last_active
       FROM sessions WHERE site_id::text = ANY(?) AND visitor_id = ANY(pv.vids)
       ORDER BY COALESCE(last_activity, started_at) DESC LIMIT 1
     ) ls ON true
     LEFT JOIN LATERAL (
       SELECT COUNT(*) AS payments, SUM(amount) AS spent, MAX(UPPER(currency)) AS currency, MAX(created_at) AS last_paid
       FROM conversions
       WHERE site_id::text = ANY(?) AND status = 'completed'
         AND (LOWER(stripe_customer_email) = pv.email OR visitor_id = ANY(pv.vids))
     ) pay ON true`,
    params
  );

  return rows.map((r) => {
    const raw = r.utm_source || r.referrer_domain || null;
    const lastActive = [r.last_active, r.last_login].filter(Boolean).map((d) => new Date(d)).sort((a, b) => b - a)[0] || null;
    return {
      email: r.email,
      visitorId: r.visitor_id || null,
      firstLogin: r.first_login,
      lastLogin: r.last_login,
      logins: Number(r.logins),
      loginsInRange: Number(r.logins_in_range),
      activeInRange: !!r.active_in_range,
      provider: r.provider || null,
      source: friendlySourceName(raw),
      sourceType: sourceType(raw),
      referrer: r.referrer || null,
      utmMedium: r.utm_medium || null,
      utmCampaign: r.utm_campaign || null,
      entryPage: r.entry_page || null,
      firstSeen: r.first_seen,
      lastActive,
      country: r.country || null,
      city: r.city || null,
      device: r.device_type || null,
      browser: r.browser || null,
      payments: Number(r.payments) || 0,
      spentCents: Number(r.spent) || 0,
      currency: r.currency || null,
      lastPaid: r.last_paid,
    };
  });
}
