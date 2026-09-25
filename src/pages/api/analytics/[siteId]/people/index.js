import { getRow, run } from '@/lib/db';
import { withAuth } from '@/lib/withAuth';
import { verifySiteOwnership, getLinkedSiteIds } from '@/lib/analytics';
import { queryPeople } from '@/lib/people';

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
  const people = await queryPeople(linkedIdStrings, { searchClause, searchParams, limit: pageSize, offset });

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
