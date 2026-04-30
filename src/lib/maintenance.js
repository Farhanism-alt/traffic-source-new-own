import { getRow, getRows, run, getPool } from './db';

export async function purgeOldPageViews(daysToKeep = 90) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysToKeep);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const result = await run('DELETE FROM page_views WHERE DATE(timestamp) < ?', [cutoffStr]);
  return { deleted: result.rowCount };
}

export async function getDatabaseSize() {
  const row = await getRow(
    `SELECT pg_database_size(current_database()) as size_bytes`
  );
  const sizeBytes = row ? parseInt(row.size_bytes, 10) : 0;
  return {
    bytes: sizeBytes,
    mb: (sizeBytes / (1024 * 1024)).toFixed(2),
  };
}

export async function vacuum() {
  // VACUUM ANALYZE cannot run inside a transaction; use pool directly
  const client = await getPool().connect();
  try {
    await client.query('VACUUM ANALYZE');
  } finally {
    client.release();
  }
}

export async function getTableCounts() {
  const tables = ['users', 'sites', 'sessions', 'page_views', 'conversions', 'daily_stats'];
  const results = {};
  await Promise.all(
    tables.map(async (table) => {
      const row = await getRow(`SELECT COUNT(*)::int as count FROM ${table}`);
      results[table] = row ? row.count : 0;
    })
  );
  return results;
}
