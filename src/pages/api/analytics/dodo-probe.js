import { withAuth } from '@/lib/withAuth';
import { getRow, getRows } from '@/lib/db';
import { DodoPayments } from 'dodopayments';

// Temporary diagnostic. Hit while logged in:
//   GET /api/analytics/dodo-probe?pid=pay_0NgzIqhJ0dBxwtaxGvTJC
export default withAuth(async function handler(req, res) {
  const targetPid = req.query.pid || 'pay_0NgzIqhJ0dBxwtaxGvTJC';
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400 * 1000).toISOString();

  const sites = await getRows(
    'SELECT id, domain, dodo_api_key FROM sites WHERE user_id = ? AND dodo_api_key IS NOT NULL',
    [req.user.userId]
  );

  const out = { targetPid, sevenDaysAgo, sitesFound: sites.length, sites: [] };

  for (const site of sites) {
    const keyPreview = site.dodo_api_key ? site.dodo_api_key.slice(0, 8) + '...' : 'MISSING';
    const report = { siteId: site.id, domain: site.domain, keyPreview };
    const dodo = new DodoPayments({ bearerToken: site.dodo_api_key });

    // 1. Directly retrieve the target payment
    try {
      const p = await dodo.payments.retrieve(targetPid);
      report.retrieve = {
        found: true,
        status: p?.status ?? null,
        total_amount: p?.total_amount ?? null,
        created_at: p?.created_at ?? null,
        customer_email: p?.customer?.email ?? null,
        refund_status: p?.refund_status ?? null,
      };
    } catch (e) {
      report.retrieve = { found: false, error: e.message };
    }

    // 2. List with created_at_gte + status succeeded
    try {
      const ids = [];
      let count = 0;
      for await (const p of dodo.payments.list({ status: 'succeeded', created_at_gte: sevenDaysAgo, page_size: 100 })) {
        count++;
        ids.push({ id: p.payment_id, created_at: p.created_at, status: p.status ?? null, amount: p.total_amount });
        if (count >= 200) break;
      }
      report.listSucceeded7d = {
        count,
        targetFound: ids.some(x => x.id === targetPid),
        allIds: ids,
      };
    } catch (e) {
      report.listSucceeded7d = { error: e.message };
    }

    // 3. List all statuses (no filter) last 7 days
    try {
      const ids = [];
      let count = 0;
      for await (const p of dodo.payments.list({ created_at_gte: sevenDaysAgo, page_size: 100 })) {
        count++;
        ids.push({ id: p.payment_id, created_at: p.created_at, status: p.status ?? null, amount: p.total_amount });
        if (count >= 200) break;
      }
      report.listAll7d = {
        count,
        targetFound: ids.some(x => x.id === targetPid),
        allIds: ids,
      };
    } catch (e) {
      report.listAll7d = { error: e.message };
    }

    // 4. DB check
    try {
      const row = await getRow(
        'SELECT id, status, visitor_id, amount, currency, payment_provider, created_at FROM conversions WHERE payment_intent_id = ? AND site_id = ?',
        [targetPid, site.id]
      );
      report.dbRow = row || null;
    } catch (e) {
      report.dbRow = { error: e.message };
    }

    out.sites.push(report);
  }

  return res.json(out);
});
