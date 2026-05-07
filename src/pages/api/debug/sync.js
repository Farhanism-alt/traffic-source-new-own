import { withAuth } from '@/lib/withAuth';

export default withAuth(async function handler(req, res) {
  const results = {};

  try {
    const { syncDodoPayments } = await import('@/lib/dodo-sync');
    results.dodo = await syncDodoPayments();
  } catch (err) {
    results.dodo = { error: err.message };
  }

  try {
    const { syncStripePayments } = await import('@/lib/stripe-sync');
    results.stripe = await syncStripePayments();
  } catch (err) {
    results.stripe = { error: err.message };
  }

  try {
    const { syncLemonSqueezyPayments } = await import('@/lib/lemonsqueezy-sync');
    results.lemonSqueezy = await syncLemonSqueezyPayments();
  } catch (err) {
    results.lemonSqueezy = { error: err.message };
  }

  return res.status(200).json(results);
});
