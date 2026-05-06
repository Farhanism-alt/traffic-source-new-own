import { getRow, getRows, run, getPool } from './db';
import {
  getSiteLink,
  getUserConnection,
  getDecryptedRefreshToken,
  refreshAccessToken,
  querySearchAnalytics,
  isGscConfigured,
} from './gsc';

function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}

function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

/**
 * Sync a single site. If `backfill` is true, fetches the full 90-day window;
 * otherwise fetches just yesterday's data (incremental).
 */
export async function syncSite(siteId, { backfill = false } = {}) {
  const link = await getSiteLink(siteId);
  if (!link) return { skipped: true };

  const site = await getRow('SELECT user_id FROM sites WHERE id = ?', [siteId]);
  if (!site) return { skipped: true };

  const userConn = await getUserConnection(site.user_id);
  if (!userConn) {
    await run("UPDATE gsc_site_links SET status='error', last_error=? WHERE site_id=?", [
      'User Google account not connected',
      siteId,
    ]);
    return { error: 'no user connection' };
  }

  let accessToken;
  try {
    accessToken = await refreshAccessToken(getDecryptedRefreshToken(userConn));
  } catch (err) {
    await run("UPDATE gsc_site_links SET status='error', last_error=? WHERE site_id=?", [
      err.message,
      siteId,
    ]);
    return { error: err.message };
  }

  // GSC data lags ~2-3 days
  const endDate = fmtDate(daysAgo(2));
  const startDate = backfill ? fmtDate(daysAgo(92)) : fmtDate(daysAgo(3));

  let queryRows, pageRows, totalRows, countryRows, deviceRows;
  try {
    [queryRows, pageRows, totalRows, countryRows, deviceRows] = await Promise.all([
      querySearchAnalytics({ accessToken, property: link.gsc_property, startDate, endDate, dimensions: ['date', 'query'], rowLimit: 25000 }),
      querySearchAnalytics({ accessToken, property: link.gsc_property, startDate, endDate, dimensions: ['date', 'page'], rowLimit: 25000 }),
      querySearchAnalytics({ accessToken, property: link.gsc_property, startDate, endDate, dimensions: ['date'], rowLimit: 1000 }),
      querySearchAnalytics({ accessToken, property: link.gsc_property, startDate, endDate, dimensions: ['date', 'country'], rowLimit: 25000 }),
      querySearchAnalytics({ accessToken, property: link.gsc_property, startDate, endDate, dimensions: ['date', 'device'], rowLimit: 5000 }),
    ]);
  } catch (err) {
    await run("UPDATE gsc_site_links SET status='error', last_error=? WHERE site_id=?", [
      err.message,
      siteId,
    ]);
    return { error: err.message };
  }

  // Batch insert via PG transaction
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    for (const r of queryRows) {
      const [date, query] = r.keys || [];
      if (!date || !query) continue;
      await client.query(
        `INSERT INTO gsc_daily (site_id, date, query, page, clicks, impressions, ctr, position)
         VALUES ($1, $2, $3, '', $4, $5, $6, $7)
         ON CONFLICT (site_id, date, query, page) DO UPDATE SET
           clicks = EXCLUDED.clicks, impressions = EXCLUDED.impressions, ctr = EXCLUDED.ctr, position = EXCLUDED.position`,
        [siteId, date, query, r.clicks || 0, r.impressions || 0, r.ctr || 0, r.position || 0]
      );
    }

    for (const r of pageRows) {
      const [date, page] = r.keys || [];
      if (!date || !page) continue;
      await client.query(
        `INSERT INTO gsc_daily_pages (site_id, date, page, clicks, impressions, ctr, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (site_id, date, page) DO UPDATE SET
           clicks = EXCLUDED.clicks, impressions = EXCLUDED.impressions, ctr = EXCLUDED.ctr, position = EXCLUDED.position`,
        [siteId, date, page, r.clicks || 0, r.impressions || 0, r.ctr || 0, r.position || 0]
      );
    }

    for (const r of totalRows) {
      const [date] = r.keys || [];
      if (!date) continue;
      await client.query(
        `INSERT INTO gsc_daily_totals (site_id, date, clicks, impressions, ctr, position)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (site_id, date) DO UPDATE SET
           clicks = EXCLUDED.clicks, impressions = EXCLUDED.impressions, ctr = EXCLUDED.ctr, position = EXCLUDED.position`,
        [siteId, date, r.clicks || 0, r.impressions || 0, r.ctr || 0, r.position || 0]
      );
    }

    for (const r of countryRows) {
      const [date, country] = r.keys || [];
      if (!date || !country) continue;
      await client.query(
        `INSERT INTO gsc_daily_countries (site_id, date, country, clicks, impressions, ctr, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (site_id, date, country) DO UPDATE SET
           clicks = EXCLUDED.clicks, impressions = EXCLUDED.impressions, ctr = EXCLUDED.ctr, position = EXCLUDED.position`,
        [siteId, date, country, r.clicks || 0, r.impressions || 0, r.ctr || 0, r.position || 0]
      );
    }

    for (const r of deviceRows) {
      const [date, device] = r.keys || [];
      if (!date || !device) continue;
      await client.query(
        `INSERT INTO gsc_daily_devices (site_id, date, device, clicks, impressions, ctr, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (site_id, date, device) DO UPDATE SET
           clicks = EXCLUDED.clicks, impressions = EXCLUDED.impressions, ctr = EXCLUDED.ctr, position = EXCLUDED.position`,
        [siteId, date, device, r.clicks || 0, r.impressions || 0, r.ctr || 0, r.position || 0]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // 90-day prune
  await run("DELETE FROM gsc_daily WHERE site_id = ? AND date < CURRENT_DATE - INTERVAL '90 days'", [siteId]);
  await run("DELETE FROM gsc_daily_pages WHERE site_id = ? AND date < CURRENT_DATE - INTERVAL '90 days'", [siteId]);
  await run("DELETE FROM gsc_daily_totals WHERE site_id = ? AND date < CURRENT_DATE - INTERVAL '90 days'", [siteId]);
  await run("DELETE FROM gsc_daily_countries WHERE site_id = ? AND date < CURRENT_DATE - INTERVAL '90 days'", [siteId]);
  await run("DELETE FROM gsc_daily_devices WHERE site_id = ? AND date < CURRENT_DATE - INTERVAL '90 days'", [siteId]);

  // Recompute trends
  await computeTrends(siteId);

  await run("UPDATE gsc_site_links SET status='active', last_sync_at=NOW(), last_error=NULL WHERE site_id=?", [siteId]);

  return { queries: queryRows.length, pages: pageRows.length, days: totalRows.length };
}

export async function computeTrends(siteId) {
  // current 28d window: dates >= today-30 and <= today-2
  // previous 28d window: dates >= today-58 and <= today-30
  const aggregate = await getRows(
    `SELECT query,
      SUM(CASE WHEN date >= CURRENT_DATE - INTERVAL '30 days' THEN clicks ELSE 0 END) AS clicks_28d,
      SUM(CASE WHEN date < CURRENT_DATE - INTERVAL '30 days' AND date >= CURRENT_DATE - INTERVAL '58 days' THEN clicks ELSE 0 END) AS clicks_prev_28d,
      SUM(CASE WHEN date >= CURRENT_DATE - INTERVAL '30 days' THEN impressions ELSE 0 END) AS imps_28d,
      SUM(CASE WHEN date < CURRENT_DATE - INTERVAL '30 days' AND date >= CURRENT_DATE - INTERVAL '58 days' THEN impressions ELSE 0 END) AS imps_prev_28d,
      AVG(CASE WHEN date >= CURRENT_DATE - INTERVAL '30 days' THEN position ELSE NULL END) AS pos_28d,
      AVG(CASE WHEN date < CURRENT_DATE - INTERVAL '30 days' AND date >= CURRENT_DATE - INTERVAL '58 days' THEN position ELSE NULL END) AS pos_prev_28d
    FROM gsc_daily
    WHERE site_id = ?
    GROUP BY query`,
    [siteId]
  );

  await run('DELETE FROM gsc_trends WHERE site_id = ?', [siteId]);

  // Batch insert via PG transaction
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    for (const r of aggregate) {
      const clicks28 = r.clicks_28d || 0;
      const clicksPrev = r.clicks_prev_28d || 0;
      const imps28 = r.imps_28d || 0;
      const impsPrev = r.imps_prev_28d || 0;
      const pos28 = r.pos_28d || 0;
      const posPrev = r.pos_prev_28d || 0;
      const deltaClicks = clicks28 - clicksPrev;
      // Position: lower is better, so delta is prev - current (positive = improved)
      const deltaPosition = posPrev && pos28 ? posPrev - pos28 : 0;
      const ctr = imps28 > 0 ? clicks28 / imps28 : 0;

      let status;
      if (clicksPrev === 0 && clicks28 > 0) status = 'new';
      else if (clicks28 === 0 && clicksPrev > 0) status = 'lost';
      else if (deltaClicks > 0 || deltaPosition > 0.5) status = 'growing';
      else if (deltaClicks < 0 || deltaPosition < -0.5) status = 'declining';
      else status = 'stable';

      await client.query(
        `INSERT INTO gsc_trends (site_id, query, clicks_28d, clicks_prev_28d, delta_clicks,
          impressions_28d, impressions_prev_28d, position_28d, position_prev_28d, delta_position, ctr_28d, status, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())`,
        [siteId, r.query, clicks28, clicksPrev, deltaClicks, imps28, impsPrev, pos28, posPrev, deltaPosition, ctr, status]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function syncAllConnections() {
  if (!(await isGscConfigured())) return { skipped: 'not configured' };
  const conns = await getRows('SELECT site_id, last_sync_at FROM gsc_site_links');
  const results = [];
  for (const c of conns) {
    // Only sync if last_sync_at is null or older than 12 hours
    if (c.last_sync_at) {
      const last = new Date(c.last_sync_at).getTime();
      if (Date.now() - last < 12 * 60 * 60 * 1000) continue;
    }
    try {
      const r = await syncSite(c.site_id, { backfill: !c.last_sync_at });
      results.push({ siteId: c.site_id, ...r });
    } catch (err) {
      results.push({ siteId: c.site_id, error: err.message });
    }
  }
  return { synced: results.length, results };
}
