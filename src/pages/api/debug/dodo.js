import { withAuth } from '@/lib/withAuth';
import { getRows } from '@/lib/db';
import { DodoPayments } from 'dodopayments';

export default withAuth(async function handler(req, res) {
  const sites = await getRows(
    'SELECT id, dodo_api_key FROM sites WHERE dodo_api_key IS NOT NULL'
  );
  if (sites.length === 0) return res.json({ error: 'No site with Dodo key' });

  const dodo = new DodoPayments({ bearerToken: sites[0].dodo_api_key });
  const payments = [];
  let count = 0;
  for await (const p of dodo.payments.list({ status: 'succeeded', page_size: 5 })) {
    payments.push(p);
    if (++count >= 3) break;
  }
  return res.json({ raw_payments: payments });
});
