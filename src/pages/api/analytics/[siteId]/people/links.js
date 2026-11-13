import { getRows } from '@/lib/db';
import { withAuth } from '@/lib/withAuth';
import { verifySiteOwnership, getLinkedSiteIds } from '@/lib/analytics';
import { ensureEmailLinksTable, linkEmails, unlinkEmail, getLinkedEmails } from '@/lib/email-links';

// Link a payment's billing email to a logged-in person.
// GET ?email=&q=   → this person's linked emails + other payment emails to pick from (unmatched first)
// POST { email, linked_email }   DELETE { linked_email }

export default withAuth(async function handler(req, res) {
  const { siteId } = req.query;
  const site = await verifySiteOwnership(siteId, req.user.userId);
  if (!site) return res.status(404).json({ error: 'Site not found' });
  const ids = (await getLinkedSiteIds(siteId)).map(String);
  await ensureEmailLinksTable();
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};

  if (req.method === 'POST') {
    const ok = await linkEmails(siteId, body.email, body.linked_email, 'manual');
    if (!ok) return res.status(400).json({ error: 'Enter two different, valid email addresses' });
    return res.status(200).json({ ok: true, links: await getLinkedEmails(ids, body.email) });
  }

  if (req.method === 'DELETE') {
    if (!body.linked_email) return res.status(400).json({ error: 'linked_email required' });
    await unlinkEmail(ids, body.linked_email);
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const email = String(req.query.email || '').trim().toLowerCase();
  const q = String(req.query.q || '').trim().toLowerCase();
  const links = email ? await getLinkedEmails(ids, email) : [];

  // Payment emails other than this person's own that aren't linked to anyone yet
  let candidates = [];
  try {
    candidates = await getRows(
      `SELECT LOWER(TRIM(c.stripe_customer_email)) AS email,
              COUNT(*) FILTER (WHERE c.status = 'completed') AS payments,
              SUM(c.amount) FILTER (WHERE c.status = 'completed') AS spent,
              MAX(UPPER(c.currency)) AS currency,
              MAX(c.created_at) AS last_paid
       FROM conversions c
       WHERE c.site_id::text = ANY(?) AND c.stripe_customer_email IS NOT NULL AND TRIM(c.stripe_customer_email) <> ''
         AND LOWER(TRIM(c.stripe_customer_email)) <> ?
         AND LOWER(TRIM(c.stripe_customer_email)) NOT IN (SELECT linked_email FROM email_links WHERE site_id = ANY(?))
         AND (? = '' OR LOWER(c.stripe_customer_email) LIKE ?)
       GROUP BY 1
       ORDER BY MAX(c.created_at) DESC
       LIMIT 100`,
      [ids, email, ids, q, `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`]
    );
  } catch (err) {
    if (err.code !== '42P01') throw err;
  }

  let known = new Set();
  if (candidates.length) {
    try {
      const rows = await getRows(
        'SELECT DISTINCT LOWER(TRIM(email)) AS email FROM visitor_identities WHERE site_id = ANY(?) AND LOWER(TRIM(email)) = ANY(?)',
        [ids, candidates.map((c) => c.email)]
      );
      known = new Set(rows.map((r) => r.email));
    } catch (err) {
      if (err.code !== '42P01') throw err;
    }
  }
  candidates.sort((a, b) => Number(known.has(a.email)) - Number(known.has(b.email)));

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    links,
    candidates: candidates.map((c) => ({
      email: c.email,
      payments: Number(c.payments) || 0,
      spentCents: Number(c.spent) || 0,
      currency: c.currency,
      lastPaid: c.last_paid,
      identified: known.has(c.email), // also listed as its own person until linked
    })),
  });
});
