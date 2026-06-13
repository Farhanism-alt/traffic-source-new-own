import { withAuth } from '@/lib/withAuth';
import { getRow, getRows } from '@/lib/db';

// TEMPORARY diagnostic endpoint to debug why a specific Dodo payment is not
// being captured by the sync. Visit while logged in:
//   /api/analytics/dodo-probe              (uses default target payment id)
//   /api/analytics/dodo-probe?pid=pay_xxx  (probe a specific payment id)
// Remove once the sync issue is resolved.
export default withAuth(async function handler(req, res) {
  const { DodoPayments } = await import('dodopayments');

  const targetPid = req.query.pid || 'pay_0NguK831crTbTszvBYYWn';
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400 * 1000).toISOString();

  const sites = await getRows(
    'SELECT id, domain, dodo_api_key FROM sites WHERE user_id = ? AND dodo_api_key IS NOT NULL',
    [req.user.userId]
  );

  const out = { targetPid, sevenDaysAgo, sitesChecked: sites.length, sites: [] };

  for (const site of sites) {
    const report = { siteId: site.id, domain: site.domain };
    const dodo = new DodoPayments({ bearerToken: site.dodo_api_key });

    // 1) Ground truth: retrieve the target payment directly
    try {
      const p = await dodo.payments.retrieve(targetPid);
      report.retrieve = {
        found: true,
        status: p?.status ?? null,
        total_amount: p?.total_amount ?? null,
        currency: p?.currency ?? null,
        created_at: p?.created_at ?? null,
        customer_email: p?.customer?.email ?? null,
        refund_status: p?.refund_status ?? null,
      };
    } catch (e) {
      report.retrieve = { found: false, error: e.message };
    }

    // 2) List WITH status:'succeeded' + created_at_gte (what the sync uses)
    try {
      const ids = [];
      let count = 0;
      for await (const p of dodo.payments.list({ status: 'succeeded', created_at_gte: sevenDaysAgo, page_size: 100 })) {
        count++;
        if (ids.length < 50) ids.push({ id: p.payment_id, created_at: p.created_at, status: p.status ?? null, amount: p.total_amount });
        if (count >= 300) break;
      }
      report.listSucceeded = {
        count,
        includesTarget: ids.some((x) => x.id === targetPid) || count >= 300,
        firstFew: ids.slice(0, 5),
        targetInSample: ids.find((x) => x.id === targetPid) || null,
      };
    } catch (e) {
      report.listSucceeded = { error: e.message };
    }

    // 3) List WITHOUT status filter + created_at_gte (to see if status filtering hides it)
    try {
      const ids = [];
      let count = 0;
      let targetEntry = null;
      for await (const p of dodo.payments.list({ created_at_gte: sevenDaysAgo, page_size: 100 })) {
        count++;
        if (p.payment_id === targetPid) targetEntry = { id: p.payment_id, created_at: p.created_at, status: p.status ?? null, amount: p.total_amount };
        if (ids.length < 50) ids.push({ id: p.payment_id, created_at: p.created_at, status: p.status ?? null });
        if (count >= 300) break;
      }
      report.listNoFilter = { count, targetEntry, firstFew: ids.slice(0, 5) };
    } catch (e) {
      report.listNoFilter = { error: e.message };
    }

    // 4) DB: is the payment already stored?
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
