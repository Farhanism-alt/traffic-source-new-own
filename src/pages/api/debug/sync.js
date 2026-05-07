import { withAuth } from '@/lib/withAuth';
import { getRows } from '@/lib/db';

export default withAuth(async function handler(req, res) {
  const conversions = await getRows(
    `SELECT payment_intent_id, amount, currency, status, payment_provider, created_at
     FROM conversions ORDER BY created_at DESC LIMIT 20`
  );

  const total = conversions.reduce((s, c) => s + Number(c.amount), 0);

  const syncResults = {};
  try {
    const { syncDodoPayments } = await import('@/lib/dodo-sync');
    syncResults.dodo = await syncDodoPayments();
  } catch (err) {
    syncResults.dodo = { error: err.message };
  }

  return res.status(200).json({
    stored_conversions: conversions.length,
    stored_total_raw: total,
    stored_total_if_cents: (total / 100).toFixed(2),
    conversions,
    sync: syncResults,
  });
});
