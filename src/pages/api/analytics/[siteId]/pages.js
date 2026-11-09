import { getRows } from '@/lib/db';
import { withAuth } from '@/lib/withAuth';
import { parseDateRange, verifySiteOwnership, getLinkedSiteIds } from '@/lib/analytics';
import { friendlySourceName, sourceType, sourceTypeSql, SOURCE_TYPES } from '@/lib/sources';

// Every page that captured at least one visitor or one bot hit in the range,
// with visitors, time spent and where its visitors came from.
// ?search= &sort= &order=asc|desc &source=AI|Search|Social|Referral|Direct
// &traffic=all|humans|bots &page= &limit= &format=csv (all matching rows)

export const config = { maxDuration: 60 };

// A page view with no next view in its session is timed up to the session's
// last heartbeat; any single gap is capped so an idle open tab doesn't count for hours.
const MAX_VIEW_SECONDS = 30 * 60;

const SORTS = {
  visitors: 'visitors',
  views: 'views',
  time: 'total_time_sec',
  avg_time: 'avg_time_sec',
  bots: 'bot_hits',
  sessions: 'sessions',
  entries: 'entries',
  recent: 'last_seen',
  first_seen: 'first_seen',
  page: 'page',
  source_visitors: 'source_visitors',
};

// Unknown (no next view, no heartbeat) stays NULL so it's left out of the average.
const CLAMPED_SECS = `CASE WHEN raw_secs IS NULL THEN NULL WHEN raw_secs < 0 THEN 0 ELSE LEAST(raw_secs, ${MAX_VIEW_SECONDS}) END`;

const SOURCE_EXPR = `COALESCE(NULLIF(s.utm_source, ''), NULLIF(s.referrer_domain, ''), 'Direct')`;

async function botTableExists() {
  try {
    await getRows('SELECT 1 FROM bot_visits LIMIT 1');
    return true;
  } catch {
    return false;
  }
}

function csvCell(v) {
  if (v == null) return '';
  const s = v instanceof Date ? v.toISOString() : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { siteId } = req.query;
  const site = await verifySiteOwnership(siteId, req.user.userId);
  if (!site) return res.status(404).json({ error: 'Site not found' });

  const range = parseDateRange(req.query);
  const from = range.from;
  const to = range.to + ' 23:59:59';
  const ids = (await getLinkedSiteIds(siteId)).map(String);

  const csv = req.query.format === 'csv';
  const search = String(req.query.search || '').trim();
  const sortCol = SORTS[req.query.sort] || 'visitors';
  const order = req.query.order === 'asc' ? 'ASC' : 'DESC';
  const source = SOURCE_TYPES.includes(req.query.source) ? req.query.source : null;
  const traffic = ['humans', 'bots'].includes(req.query.traffic) ? req.query.traffic : 'all';
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);

  const hasBots = await botTableExists();

  const params = [];
  const add = (...v) => { params.push(...v); return '?'; };

  const botCte = hasBots
    ? `bots AS (
        SELECT pathname,
               COUNT(*) AS bot_hits,
               SUM(CASE WHEN category IN ('answers', 'training') THEN 1 ELSE 0 END) AS ai_bot_hits,
               MIN(created_at) AS first_seen,
               MAX(created_at) AS last_seen
        FROM bot_visits
        WHERE site_id = ANY(${add(ids)}) AND created_at BETWEEN ${add(from)} AND ${add(to)}
        GROUP BY pathname
      )`
    : `bots AS (
        SELECT NULL::text AS pathname, 0::bigint AS bot_hits, 0::bigint AS ai_bot_hits,
               NULL::timestamptz AS first_seen, NULL::timestamptz AS last_seen
        WHERE false
      )`;

  // Per-view seconds: until the next view in the same session, else the session's last activity.
  const viewsCte = `views AS (
      SELECT pv.pathname, pv.visitor_id, pv.session_id, pv.timestamp,
             s.entry_page,
             ${SOURCE_EXPR} AS raw_source,
             EXTRACT(EPOCH FROM (
               COALESCE(
                 LEAD(pv.timestamp) OVER (PARTITION BY pv.session_id ORDER BY pv.timestamp, pv.id),
                 s.last_activity
               ) - pv.timestamp)) AS raw_secs
      FROM page_views pv
      LEFT JOIN sessions s ON s.id = pv.session_id AND s.site_id::text = pv.site_id::text
      WHERE pv.site_id::text = ANY(${add(ids)}) AND pv.timestamp BETWEEN ${add(from)} AND ${add(to)}
    )`;

  const sourceVisitors = source
    ? `COUNT(DISTINCT CASE WHEN ${sourceTypeSql('raw_source')} = ${add(source)} THEN visitor_id END)`
    : '0';

  const humansCte = `humans AS (
      SELECT pathname,
             COUNT(*) AS views,
             COUNT(DISTINCT visitor_id) AS visitors,
             COUNT(DISTINCT session_id) AS sessions,
             COUNT(DISTINCT CASE WHEN entry_page = pathname THEN session_id END) AS entries,
             ROUND(SUM(${CLAMPED_SECS})) AS total_time_sec,
             ROUND(AVG(${CLAMPED_SECS})) AS avg_time_sec,
             ${sourceVisitors} AS source_visitors,
             MIN(timestamp) AS first_seen,
             MAX(timestamp) AS last_seen
      FROM views
      GROUP BY pathname
    )`;

  const where = [];
  if (search) where.push(`page ILIKE ${add(`%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)}`);
  if (traffic === 'humans') where.push('visitors > 0');
  if (traffic === 'bots') where.push('bot_hits > 0');
  if (source) where.push('source_visitors > 0');

  const paging = csv ? '' : `LIMIT ${limit} OFFSET ${(page - 1) * limit}`;

  const rows = await getRows(
    `WITH ${botCte}, ${viewsCte}, ${humansCte},
     merged AS (
       SELECT COALESCE(h.pathname, b.pathname) AS page,
              COALESCE(h.visitors, 0) AS visitors,
              COALESCE(h.views, 0) AS views,
              COALESCE(h.sessions, 0) AS sessions,
              COALESCE(h.entries, 0) AS entries,
              COALESCE(h.total_time_sec, 0) AS total_time_sec,
              h.avg_time_sec,
              COALESCE(h.source_visitors, 0) AS source_visitors,
              COALESCE(b.bot_hits, 0) AS bot_hits,
              COALESCE(b.ai_bot_hits, 0) AS ai_bot_hits,
              LEAST(h.first_seen, b.first_seen) AS first_seen,
              GREATEST(h.last_seen, b.last_seen) AS last_seen
       FROM humans h
       FULL OUTER JOIN bots b ON b.pathname = h.pathname
     )
     SELECT *, COUNT(*) OVER () AS total_count
     FROM merged
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY ${sortCol} ${order} NULLS LAST, visitors DESC, bot_hits DESC, page ASC
     ${paging}`,
    params
  );

  const total = rows[0] ? Number(rows[0].total_count) : 0;

  // Where each listed page's visitors came from (by the visit's session source).
  const sourcesByPage = new Map();
  const humanPages = rows.filter((r) => Number(r.visitors) > 0).map((r) => r.page);
  if (humanPages.length) {
    const srcRows = await getRows(
      `SELECT pv.pathname, ${SOURCE_EXPR} AS raw_source, COUNT(DISTINCT pv.visitor_id) AS visitors
       FROM page_views pv
       LEFT JOIN sessions s ON s.id = pv.session_id AND s.site_id::text = pv.site_id::text
       WHERE pv.site_id::text = ANY(?) AND pv.timestamp BETWEEN ? AND ? AND pv.pathname = ANY(?)
       GROUP BY 1, 2`,
      [ids, from, to, humanPages]
    );
    for (const r of srcRows) {
      const name = friendlySourceName(r.raw_source);
      const m = sourcesByPage.get(r.pathname) || new Map();
      const cur = m.get(name) || { name, type: sourceType(r.raw_source), visitors: 0 };
      cur.visitors += Number(r.visitors);
      m.set(name, cur);
      sourcesByPage.set(r.pathname, m);
    }
  }

  const pages = rows.map((r) => {
    const visitors = Number(r.visitors);
    const sources = [...(sourcesByPage.get(r.page)?.values() || [])].sort((a, b) => b.visitors - a.visitors);
    const top = sources[0] || null;
    return {
      page: r.page,
      visitors,
      views: Number(r.views),
      sessions: Number(r.sessions),
      entries: Number(r.entries),
      totalTimeSec: Number(r.total_time_sec) || 0,
      avgTimeSec: r.avg_time_sec == null ? null : Number(r.avg_time_sec),
      botHits: Number(r.bot_hits),
      aiBotHits: Number(r.ai_bot_hits),
      sourceVisitors: source ? Number(r.source_visitors) : null,
      firstSeen: r.first_seen,
      lastSeen: r.last_seen,
      topSource: top ? { ...top, sharePct: visitors ? Math.round((top.visitors / visitors) * 1000) / 10 : 0 } : null,
      sources: sources.slice(0, 5),
    };
  });

  if (csv) {
    const header = [
      'Page', 'Visitors', 'Page views', 'Sessions', 'Entrances', 'Total time spent (sec)', 'Avg time per view (sec)',
      'Top source', 'Top source type', 'Top source visitors', 'Top source share %', 'All sources (visitors)',
      ...(source ? [`${source} visitors`] : []),
      'Bot hits', 'AI bot hits', 'First seen (UTC)', 'Last seen (UTC)',
    ];
    const lines = [header.map(csvCell).join(',')];
    for (const p of pages) {
      lines.push([
        p.page, p.visitors, p.views, p.sessions, p.entries, p.totalTimeSec, p.avgTimeSec,
        p.topSource?.name, p.topSource?.type, p.topSource?.visitors, p.topSource?.sharePct,
        [...(sourcesByPage.get(p.page)?.values() || [])].sort((a, b) => b.visitors - a.visitors).map((s) => `${s.name} (${s.visitors})`).join('; '),
        ...(source ? [p.sourceVisitors] : []),
        p.botHits, p.aiBotHits,
        p.firstSeen ? new Date(p.firstSeen).toISOString() : '', p.lastSeen ? new Date(p.lastSeen).toISOString() : '',
      ].map(csvCell).join(','));
    }
    const slug = String(site.domain || site.name || `site-${siteId}`).replace(/[^a-z0-9.-]+/gi, '-');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="pages-${slug}-${from}-to-${range.to}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send('﻿' + lines.join('\r\n'));
  }

  res.setHeader('Cache-Control', 'private, max-age=30');
  res.status(200).json({
    site: { id: site.id, name: site.name, domain: site.domain },
    range: { from, to: range.to },
    pages,
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  });
});
