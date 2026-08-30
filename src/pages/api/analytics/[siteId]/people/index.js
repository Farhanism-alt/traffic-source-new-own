import { getRows, getRow, run } from '@/lib/db';
import { withAuth } from '@/lib/withAuth';
import { verifySiteOwnership, getLinkedSiteIds } from '@/lib/analytics';

let tableReady = null;
function ensureIdentitiesTable() {
  if (!tableReady) {
    tableReady = run(`
      CREATE TABLE IF NOT EXISTS visitor_identities (
        id BIGSERIAL PRIMARY KEY,
        site_id TEXT NOT NULL,
        visitor_id TEXT NOT NULL,
        email TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(site_id, email)
      )
    `)
      .then(() => run(`CREATE INDEX IF NOT EXISTS idx_visitor_identities_site_email ON visitor_identities(site_id, email)`))
      .then(() => run(`CREATE INDEX IF NOT EXISTS idx_visitor_identities_site_vid ON visitor_identities(site_id, visitor_id)`))
      .catch(() => { tableReady = null; });
  }
  return tableReady;
}

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { siteId, search, page = '1', limit = '25' } = req.query;
  const site = await verifySiteOwnership(siteId, req.user.userId);
  if (!site) return res.status(404).json({ error: 'Site not found' });

  await ensureIdentitiesTable();

  const pageNum = Math.max(1, parseInt(page, 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * pageSize;

  let searchClause = '';
  const searchParams = [];
  if (search) {
    searchClause = `AND (vi.email ILIKE ? OR vi.visitor_id ILIKE ?)`;
    const pattern = `%${search.trim()}%`;
    searchParams.push(pattern, pattern);
  }

  const linkedIds = await getLinkedSiteIds(siteId);
  const linkedIdStrings = linkedIds.map(String);

  // Count total people
  const countRow = await getRow(
    `SELECT COUNT(DISTINCT vi.email) as total
     FROM visitor_identities vi
     WHERE vi.site_id = ANY($1) ${searchClause}`,
    [linkedIdStrings, ...searchParams]
  );
  const total = Number(countRow?.total || 0);

  // Fetch people list with first/last session stats and conversion totals
  const people = await getRows(
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
    LIMIT ? OFFSET ?`,
    [
      linkedIdStrings,
      linkedIdStrings,
      linkedIdStrings,
      linkedIdStrings,
      linkedIdStrings,
      ...searchParams,
      pageSize,
      offset,
    ]
  );

  res.setHeader('Cache-Control', 'private, max-age=15');
  res.status(200).json({
    site: { id: site.id, name: site.name, domain: site.domain },
    people,
    pagination: {
      page: pageNum,
      limit: pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  });
});
