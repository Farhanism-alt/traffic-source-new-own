import { getRows, run } from './db';

// Billing emails that belong to a logged-in person: when someone pays with a different
// email than they log in with, the payment's email is linked to their login email and
// counted as theirs (Logins, All people, Footprint).

let ready = null;
export function ensureEmailLinksTable() {
  if (!ready) {
    ready = run(`CREATE TABLE IF NOT EXISTS email_links (
        site_id TEXT NOT NULL,
        email TEXT NOT NULL,
        linked_email TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'manual',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (site_id, linked_email)
      )`)
      .then(() => run('CREATE INDEX IF NOT EXISTS idx_email_links_site_email ON email_links(site_id, email)'))
      .catch((err) => { ready = null; throw err; });
  }
  return ready;
}

const norm = (e) => String(e || '').trim().toLowerCase();

/** Links linkedEmail (e.g. a billing email) to the person with email. A billing email belongs to one person. */
export async function linkEmails(siteId, email, linkedEmail, source = 'manual') {
  const a = norm(email);
  const b = norm(linkedEmail);
  if (!a.includes('@') || !b.includes('@') || a === b) return false;
  await ensureEmailLinksTable();
  await run(
    `INSERT INTO email_links (site_id, email, linked_email, source) VALUES (?, ?, ?, ?)
     ON CONFLICT (site_id, linked_email) DO UPDATE SET email = EXCLUDED.email, source = EXCLUDED.source, created_at = NOW()`,
    [String(siteId), a, b, source]
  );
  return true;
}

export async function unlinkEmail(siteIds, linkedEmail) {
  await ensureEmailLinksTable();
  await run('DELETE FROM email_links WHERE site_id = ANY(?) AND linked_email = ?', [siteIds.map(String), norm(linkedEmail)]);
}

export async function getLinkedEmails(siteIds, email) {
  await ensureEmailLinksTable();
  const rows = await getRows(
    'SELECT linked_email, source, created_at FROM email_links WHERE site_id = ANY(?) AND email = ? ORDER BY created_at',
    [siteIds.map(String), norm(email)]
  );
  return rows;
}
