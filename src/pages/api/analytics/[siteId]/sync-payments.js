import { withAuth } from '@/lib/withAuth';
import { verifySiteOwnership } from '@/lib/analytics';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { siteId } = req.query;
  const site = await verifySiteOwnership(siteId, req.user.userId);
  if (!site) return res.status(404).json({ error: 'Site not found' });

  const results = { dodo: null, stripe: null, lemonsqueezy: null };

  try {
    const { syncDodoPayments } = await import('@/lib/dodo-sync');
    results.dodo = await syncDodoPayments();
  } catch (e) {
    results.dodo = { error: e.message };
  }

  try {
    const { syncStripePayments } = await import('@/lib/stripe-sync');
    results.stripe = await syncStripePayments();
  } catch (e) {
    results.stripe = { error: e.message };
  }

  try {
    const { syncLemonSqueezyPayments } = await import('@/lib/lemonsqueezy-sync');
    results.lemonsqueezy = await syncLemonSqueezyPayments();
  } catch (e) {
    results.lemonsqueezy = { error: e.message };
  }

  const totalNew = (results.dodo?.conversions || 0) + (results.stripe?.conversions || 0) + (results.lemonsqueezy?.conversions || 0);

  return res.json({ synced: true, newConversions: totalNew, results });
});
