import { withAuth } from '@/lib/withAuth';
import { getRow } from '@/lib/db';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  const site = await getRow('SELECT * FROM sites WHERE id = ? AND user_id = ?', [
    id,
    req.user.userId,
  ]);

  if (!site) return res.status(404).json({ error: 'Site not found' });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  const trackingSnippet = `<!-- Traffic Source Analytics -->
<script defer src="${appUrl}/t.js" data-site="${site.id}"></script>`;

  const stripeSnippet = `// In your checkout API route, pass the tracking cookies as metadata:
const session = await stripe.checkout.sessions.create({
  line_items: [{ price: 'price_xxx', quantity: 1 }],
  mode: 'payment',
  metadata: {
    ts_visitor_id: req.cookies._ts_vid || '',
    ts_session_id: req.cookies._ts_sid || '',
  },
  success_url: 'https://${site.domain}/success',
  cancel_url: 'https://${site.domain}/cancel',
});`;

  const dodoSnippet = `// In your checkout API route, pass the tracking data as metadata:
const payment = await dodo.payments.create({
  billing: { country: 'US' },
  customer: { create_new_customer: false, email: customerEmail },
  product_cart: [{ product_id: 'prod_xxx', quantity: 1 }],
  metadata: {
    ts_visitor_id: req.cookies._ts_vid || '',
    ts_session_id: req.cookies._ts_sid || '',
  },
  return_url: 'https://${site.domain}/success',
});`;

  const lemonSqueezySnippet = `// Build your Lemon Squeezy checkout URL with tracking data:
const checkoutUrl = new URL('https://your-store.lemonsqueezy.com/checkout/buy/variant_xxx');
checkoutUrl.searchParams.set('checkout[custom][ts_visitor_id]', getCookie('_ts_vid') || '');
checkoutUrl.searchParams.set('checkout[custom][ts_session_id]', getCookie('_ts_sid') || '');
// Then redirect the user to checkoutUrl.toString()

// Helper to read a cookie value:
function getCookie(name) {
  return document.cookie.split('; ').find(r => r.startsWith(name + '='))?.split('=')[1] || '';
}`;

  res.status(200).json({
    site,
    trackingSnippet,
    stripeSnippet,
    dodoSnippet,
    lemonSqueezySnippet,
  });
});
