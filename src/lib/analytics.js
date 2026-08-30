import { getRow, getRows, run } from './db';

export function parseDateRange(query) {
  const { from, to, period } = query;
  if (from && to) {
    return { from, to };
  }
  const now = new Date();
  if (period === 'all') {
    return { from: '2000-01-01', to: now.toISOString().slice(0, 10) };
  }
  const periods = {
    '24h': 1,
    '7d': 7,
    '30d': 30,
    '90d': 90,
    '12m': 365,
  };
  const days = periods[period] || 30;
  const fromDate = new Date(now);
  fromDate.setDate(fromDate.getDate() - days);
  return {
    from: fromDate.toISOString().slice(0, 10),
    to: now.toISOString().slice(0, 10),
  };
}

export async function verifySiteOwnership(siteId, userId) {
  return getRow('SELECT * FROM sites WHERE id = ? AND user_id = ?', [siteId, userId]);
}

let connectedTableReady = null;
export async function ensureConnectedSitesTable() {
  if (!connectedTableReady) {
    connectedTableReady = run(`
      CREATE TABLE IF NOT EXISTS site_connections (
        id SERIAL PRIMARY KEY,
        site_id INTEGER NOT NULL,
        connected_site_id INTEGER NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(site_id, connected_site_id)
      )
    `)
      .then(() => run(`CREATE INDEX IF NOT EXISTS idx_site_conn_site_id ON site_connections(site_id)`))
      .then(() => run(`CREATE INDEX IF NOT EXISTS idx_site_conn_connected_id ON site_connections(connected_site_id)`))
      .catch(() => { connectedTableReady = null; });
  }
  return connectedTableReady;
}

export async function getLinkedSiteIds(siteId) {
  await ensureConnectedSitesTable();
  const numericId = parseInt(siteId, 10);
  if (isNaN(numericId)) return [String(siteId)];

  try {
    const rows = await getRows(
      `SELECT connected_site_id FROM site_connections WHERE site_id = ?
       UNION
       SELECT site_id FROM site_connections WHERE connected_site_id = ?`,
      [numericId, numericId]
    );
    const ids = new Set([numericId, ...rows.map(r => r.connected_site_id || r.site_id)]);
    return Array.from(ids);
  } catch {
    return [numericId];
  }
}
