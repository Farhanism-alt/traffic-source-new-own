import { withAuth } from '@/lib/withAuth';
import { getDb } from '@/lib/db';

export default withAuth(function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  const db = getDb();

  const site = db
    .prepare('SELECT * FROM sites WHERE id = ? AND user_id = ?')
    .get(id, req.user.userId);

  if (!site) return res.status(404).json({ error: 'Site not found' });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  const trackingSnippet = `<!-- Traffic Source Analytics -->
<script defer src="${appUrl}/t.js" data-site="${site.id}"></script>`;

  const stripeSnippet = `<!-- Stripe Conversion Tracking -->
<script>
// Add this to your checkout button handler:
function getTrackingRef() {
  if (window.__ts) {
    return window.__ts.vid + '|' + window.__ts.sid() + '|${site.id}';
  }
  return '';
}
// Pass the return value as client_reference_id when creating a Stripe Checkout Session
</script>`;

  const webhookUrl = `${appUrl}/api/stripe/webhook/${site.id}`;

  res.status(200).json({
    site,
    trackingSnippet,
    stripeSnippet,
    webhookUrl,
  });
});
