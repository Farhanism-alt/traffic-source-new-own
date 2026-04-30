export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const cronSecret = req.headers['x-cron-secret'];
  if (process.env.CRON_SECRET && cronSecret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const results = {};
  // Stripe
  try {
    const { syncStripePayments } = await import('@/lib/stripe-sync');
    results.stripe = await syncStripePayments();
  } catch (err) { results.stripe = { error: err.message }; }
  // Dodo
  try {
    const { syncDodoPayments } = await import('@/lib/dodo-sync');
    results.dodo = await syncDodoPayments();
  } catch (err) { results.dodo = { error: err.message }; }
  // LemonSqueezy
  try {
    const { syncLemonSqueezyPayments } = await import('@/lib/lemonsqueezy-sync');
    results.lemonSqueezy = await syncLemonSqueezyPayments();
  } catch (err) { results.lemonSqueezy = { error: err.message }; }

  return res.status(200).json({ ok: true, results });
}
