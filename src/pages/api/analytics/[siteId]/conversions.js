import { getRow, getRows } from '@/lib/db';
import { withAuth } from '@/lib/withAuth';
import { parseDateRange, verifySiteOwnership } from '@/lib/analytics';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { siteId, search, page = '1', limit = '25' } = req.query;
  const site = await verifySiteOwnership(siteId, req.user.userId);
  if (!site) return res.status(404).json({ error: 'Site not found' });

  const range = parseDateRange(req.query);
  const dateEnd = range.to + ' 23:59:59';
  const pageNum = Math.max(1, parseInt(page));
  const pageSize = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * pageSize;

  // Build WHERE clause for optional search filter
  let searchClause = '';
  const baseParams = [siteId, range.from, dateEnd];
  const searchParams = [];

  if (search) {
    searchClause = `AND (
      c.stripe_customer_email LIKE ?
      OR c.visitor_id LIKE ?
      OR c.referrer_domain LIKE ?
      OR c.utm_source LIKE ?
    )`;
    const pattern = `%${search}%`;
    searchParams.push(pattern, pattern, pattern, pattern);
  }

  // Total count for pagination
  const totalRow = await getRow(
    `SELECT COUNT(*) as total
     FROM conversions c
     WHERE c.site_id = ? AND c.status = 'completed'
     AND c.created_at BETWEEN ? AND ?
     ${searchClause}`,
    [...baseParams, ...searchParams]
  );

  // Main query: conversions joined with session data
  const conversions = await getRows(
    `SELECT
      c.id,
      c.visitor_id,
      c.session_id,
      c.stripe_customer_email,
      c.amount,
      c.currency,
      c.status,
      c.utm_source,
      c.utm_medium,
      c.utm_campaign,
      c.referrer_domain,
      c.created_at,
      s.country,
      s.city,
      s.browser,
      s.os,
      s.device_type,
      s.entry_page,
      s.exit_page,
      s.page_count,
      s.duration as session_duration
     FROM conversions c
     LEFT JOIN sessions s ON c.session_id = s.id
     WHERE c.site_id = ? AND c.status = 'completed'
     AND c.created_at BETWEEN ? AND ?
     ${searchClause}
     ORDER BY c.created_at DESC
     LIMIT ? OFFSET ?`,
    [...baseParams, ...searchParams, pageSize, offset]
  );

  // Enrich each conversion with time-to-complete and page journey
  const enriched = await Promise.all(
    conversions.map(async (conv) => {
      let timeToComplete = null;
      let journey = [];

      // If LEFT JOIN returned no session data, try finding by visitor_id
      if (!conv.country && !conv.browser && conv.visitor_id) {
        const fallbackSession = await getRow(
          `SELECT country, city, browser, os, device_type, entry_page, exit_page, page_count, duration
           FROM sessions
           WHERE site_id = ? AND visitor_id = ?
           ORDER BY started_at DESC LIMIT 1`,
          [siteId, conv.visitor_id]
        );
        if (fallbackSession) {
          conv = { ...conv, ...fallbackSession, session_duration: fallbackSession.duration };
        }
      }

      if (conv.visitor_id) {
        const [firstSession, journeyRows] = await Promise.all([
          getRow(
            `SELECT started_at FROM sessions
             WHERE site_id = ? AND visitor_id = ?
             ORDER BY started_at ASC LIMIT 1`,
            [siteId, conv.visitor_id]
          ),
          getRows(
            `SELECT pathname, timestamp FROM page_views
             WHERE site_id = ? AND visitor_id = ?
             ORDER BY timestamp ASC
             LIMIT 20`,
            [siteId, conv.visitor_id]
          ),
        ]);

        if (firstSession) {
          timeToComplete = Math.round(
            (new Date(conv.created_at).getTime() -
              new Date(firstSession.started_at).getTime()) /
              1000
          );
        }

        journey = journeyRows;
      }

      return { ...conv, timeToComplete, journey };
    })
  );

  res.status(200).json({
    site: { id: site.id, name: site.name, domain: site.domain },
    conversions: enriched,
    pagination: {
      page: pageNum,
      limit: pageSize,
      total: totalRow.total,
      totalPages: Math.ceil(totalRow.total / pageSize),
    },
  });
});
