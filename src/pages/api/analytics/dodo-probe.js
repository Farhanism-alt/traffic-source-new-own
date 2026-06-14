import { getRow, getRows } from '@/lib/db';
import { DodoPayments } from 'dodopayments';

// Temporary diagnostic - remove once sync issue resolved.
// GET /api/analytics/dodo-probe?secret=YOUR_CRON_SECRET
export default async function handler(req, res) {
  const secret = req.query.secret;
  if (!secret || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized — pass ?secret=YOUR_CRON_SECRET' });
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 86400 * 1000).toISOString();

  const sites = await getRows(
    'SELECT id, domain, dodo_api_key FROM sites WHERE dodo_api_key IS NOT NULL'
  );

  const out = { sevenDaysAgo, sitesFound: sites.length, sites: [] };

  for (const site of sites) {
    const report = { siteId: site.id, domain: site.domain, keyPreview: site.dodo_api_key?.slice(0, 8) + '...' };
    const dodo = new DodoPayments({ bearerToken: site.dodo_api_key });

    try {
      const payments = [];
      for await (const p of dodo.payments.list({ status: 'succeeded', created_at_gte: sevenDaysAgo, page_size: 100 })) {
        const dbRow = await getRow(
          'SELECT id, status, visitor_id, amount, created_at FROM conversions WHERE payment_intent_id = ? AND site_id = ?',
          [p.payment_id, site.id]
        );
        payments.push({
          id: p.payment_id,
          created_at: p.created_at,
          amount: p.total_amount,
          currency: p.currency,
          customer_email: p.customer?.email ?? null,
          dodo_status: p.status ?? null,
          inDB: !!dbRow,
          dbStatus: dbRow?.status ?? null,
          dbVisitorId: dbRow?.visitor_id ?? null,
          dbAmount: dbRow?.amount ?? null,
        });
      }
      report.payments = payments;
      report.totalInDodo = payments.length;
      report.notInDB = payments.filter(p => !p.inDB).length;
    } catch (e) {
      report.error = e.message;
    }

    out.sites.push(report);
  }

  return res.json(out);
}
