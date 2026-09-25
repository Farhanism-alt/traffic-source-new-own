import { getRows } from './db';

/**
 * Identified people with first-touch acquisition, activity and revenue totals.
 * linkedIds: string site ids (a site plus its connected sites).
 * Pass limit = null to return everyone (used by the Master Export).
 */
export function queryPeople(linkedIds, { searchClause = '', searchParams = [], limit = null, offset = 0 } = {}) {
  const paging = limit == null ? '' : 'LIMIT ? OFFSET ?';
  return getRows(
    `SELECT
      vi.id,
      vi.email,
      vi.visitor_id,
      vi.created_at as identified_at,
      COALESCE(s_first.utm_source, s_first.referrer_domain, 'Direct') as acquisition_source,
      s_first.utm_medium,
      s_first.utm_campaign,
      s_first.referrer,
      s_first.entry_page,
      s_first.country,
      s_first.city,
      s_first.browser,
      s_first.os,
      s_first.device_type,
      s_first.started_at as first_seen,
      s_last.last_activity as last_seen,
      COALESCE(s_agg.session_count, 0) as total_sessions,
      COALESCE(s_agg.total_page_views, 0) as total_page_views,
      COALESCE(c_agg.total_conversions, 0) as total_conversions,
      COALESCE(c_agg.total_spent, 0) as total_spent,
      c_agg.currency as spent_currency
    FROM visitor_identities vi
    LEFT JOIN LATERAL (
      SELECT started_at, utm_source, utm_medium, utm_campaign, referrer, referrer_domain, entry_page, country, city, browser, os, device_type
      FROM sessions
      WHERE site_id::text = ANY(?) AND visitor_id = vi.visitor_id
      ORDER BY started_at ASC
      LIMIT 1
    ) s_first ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(last_activity, started_at) as last_activity
      FROM sessions
      WHERE site_id::text = ANY(?) AND visitor_id = vi.visitor_id
      ORDER BY COALESCE(last_activity, started_at) DESC
      LIMIT 1
    ) s_last ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(DISTINCT id) as session_count, COALESCE(SUM(page_count), 0) as total_page_views
      FROM sessions
      WHERE site_id::text = ANY(?) AND visitor_id = vi.visitor_id
    ) s_agg ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) as total_conversions, COALESCE(SUM(amount), 0) as total_spent, MAX(currency) as currency
      FROM conversions
      WHERE site_id::text = ANY(?) AND (visitor_id = vi.visitor_id OR stripe_customer_email = vi.email) AND status = 'completed'
    ) c_agg ON true
    WHERE vi.site_id = ANY(?) ${searchClause}
    ORDER BY vi.created_at DESC
    ${paging}`,
    [
      linkedIds,
      linkedIds,
      linkedIds,
      linkedIds,
      linkedIds,
      ...searchParams,
      ...(limit == null ? [] : [limit, offset]),
    ]
  );
}
