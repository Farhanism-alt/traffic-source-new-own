import { getRows, getRow } from '@/lib/db';
import { withAuth } from '@/lib/withAuth';
import { parseDateRange, verifySiteOwnership } from '@/lib/analytics';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { siteId, category } = req.query;
  const site = await verifySiteOwnership(siteId, req.user.userId);
  if (!site) return res.status(404).json({ error: 'Site not found' });

  const range = parseDateRange(req.query);
  const dateEnd = range.to + ' 23:59:59';

  const empty = {
    site: { id: site.id, name: site.name, domain: site.domain },
    stats: { total: 0, answers: 0, indexing: 0, training: 0, other: 0, notFound: 0 },
    providers: [], crawlers: [], topPages: [], notFoundPages: [], recentVisits: [],
  };

  try {
    await getRow('SELECT 1 FROM bot_visits LIMIT 1', []);
  } catch {
    return res.status(200).json(empty);
  }

  const validCategories = ['answers', 'indexing', 'training', 'other'];
  const catClause =
    category && validCategories.includes(category)
      ? `AND category = '${category}'`
      : '';

  const baseWhere = `site_id = ? AND created_at BETWEEN ? AND ? ${catClause}`;
  const params = [siteId, range.from, dateEnd];

  const [statRows, crawlerRows, topPageRows, notFoundRows, recentRows] = await Promise.all([
    getRows(`SELECT category, COUNT(*) as count FROM bot_visits WHERE ${baseWhere} GROUP BY category`, params),
    getRows(
      `SELECT crawler_token, crawler_name, provider, category, COUNT(*) as count, MAX(created_at) as last_seen
       FROM bot_visits WHERE ${baseWhere}
       GROUP BY crawler_token, crawler_name, provider, category
       ORDER BY count DESC`,
      params
    ),
    getRows(
      `SELECT pathname, COUNT(*) as count FROM bot_visits WHERE ${baseWhere}
       GROUP BY pathname ORDER BY count DESC LIMIT 20`,
      params
    ),
    getRows(
      `SELECT pathname, COUNT(*) as count FROM bot_visits WHERE ${baseWhere} AND status_code = 404
       GROUP BY pathname ORDER BY count DESC LIMIT 20`,
      params
    ),
    getRows(
      `SELECT crawler_token, crawler_name, provider, category, pathname, status_code, created_at
       FROM bot_visits WHERE ${baseWhere}
       ORDER BY created_at DESC LIMIT 50`,
      params
    ),
  ]);

  const statMap = { answers: 0, indexing: 0, training: 0, other: 0 };
  let total = 0;
  for (const row of statRows) {
    statMap[row.category] = (statMap[row.category] || 0) + Number(row.count);
    total += Number(row.count);
  }

  const providerMap = {};
  for (const c of crawlerRows) {
    const cnt = Number(c.count);
    if (!providerMap[c.provider]) {
      providerMap[c.provider] = { provider: c.provider, count: 0, crawlers: [], lastSeen: c.last_seen };
    }
    providerMap[c.provider].count += cnt;
    providerMap[c.provider].crawlers.push({ token: c.crawler_token, name: c.crawler_name, category: c.category, count: cnt });
    if (c.last_seen > providerMap[c.provider].lastSeen) {
      providerMap[c.provider].lastSeen = c.last_seen;
    }
  }

  const notFoundCount = notFoundRows.reduce((s, r) => s + Number(r.count), 0);

  res.status(200).json({
    site: { id: site.id, name: site.name, domain: site.domain },
    stats: { total, answers: statMap.answers, indexing: statMap.indexing, training: statMap.training, other: statMap.other, notFound: notFoundCount },
    providers: Object.values(providerMap).sort((a, b) => b.count - a.count),
    crawlers: crawlerRows,
    topPages: topPageRows,
    notFoundPages: notFoundRows,
    recentVisits: recentRows,
  });
});
