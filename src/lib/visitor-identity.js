import { run, getRow } from './db';

let ready = null;

function ensureTable() {
  if (!ready) {
    ready = run(`
      CREATE TABLE IF NOT EXISTS visitor_identities (
        id BIGSERIAL PRIMARY KEY,
        site_id TEXT NOT NULL,
        visitor_id TEXT NOT NULL,
        email TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(site_id, email)
      )
    `)
      .then(() => run(
        `CREATE INDEX IF NOT EXISTS idx_visitor_identities_site_email ON visitor_identities(site_id, email)`
      ))
      .catch(() => { ready = null; });
  }
  return ready;
}

export async function upsertVisitorIdentity(siteId, visitorId, email) {
  try {
    await ensureTable();
    await run(
      `INSERT INTO visitor_identities (site_id, visitor_id, email) VALUES (?, ?, ?)
       ON CONFLICT (site_id, email) DO UPDATE SET visitor_id = EXCLUDED.visitor_id, created_at = NOW()`,
      [siteId, visitorId, email.trim().toLowerCase()]
    );
  } catch {
    // Non-fatal — attribution degrades gracefully
  }
}

export async function lookupVisitorByEmail(siteId, email) {
  if (!email) return null;
  try {
    await ensureTable();
    const row = await getRow(
      'SELECT visitor_id FROM visitor_identities WHERE site_id = ? AND email = ?',
      [siteId, email.trim().toLowerCase()]
    );
    return row?.visitor_id || null;
  } catch {
    return null;
  }
}
