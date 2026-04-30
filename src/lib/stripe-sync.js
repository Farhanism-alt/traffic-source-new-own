import Stripe from 'stripe';
import { getRow, getRows, run } from './db';

export async function syncStripePayments() {
  const sites = await getRows(
    'SELECT id, stripe_secret_key FROM sites WHERE stripe_secret_key IS NOT NULL'
  );

  if (sites.length === 0) return { sites: 0, conversions: 0, refunds: 0 };

  let totalProcessed = 0;
  let totalRefunds = 0;

  for (const site of sites) {
    const stripe = new Stripe(site.stripe_secret_key);

    // Poll completed checkout sessions from the last 24 hours
    const since = Math.floor(Date.now() / 1000) - 86400;

    try {
      const sessions = await stripe.checkout.sessions.list({
        status: 'complete',
        created: { gte: since },
        limit: 100,
      });

      for (const session of sessions.data) {
        if (!session.payment_status || session.payment_status !== 'paid') continue;

        const paymentIntentId = session.payment_intent || session.id;

        // Dedup: skip if already processed
        const existing = await getRow(
          'SELECT id FROM conversions WHERE payment_intent_id = ? AND site_id = ?',
          [paymentIntentId, site.id]
        );
        if (existing) continue;

        // Extract visitor/session IDs from metadata
        let visitorId = session.metadata?.ts_visitor_id || null;
        let sessionId = session.metadata?.ts_session_id || null;

        // Fallback: try client_reference_id (legacy format: visitorId|sessionId|siteId)
        if (!visitorId && session.client_reference_id) {
          const parts = session.client_reference_id.split('|');
          if (parts.length === 3) {
            visitorId = parts[0];
            sessionId = parts[1];
          }
        }

        // Look up session data for UTM/referrer attribution
        let utmSource = null;
        let utmMedium = null;
        let utmCampaign = null;
        let referrerDomain = null;

        if (sessionId) {
          const origSession = await getRow('SELECT * FROM sessions WHERE id = ?', [sessionId]);
          if (origSession) {
            utmSource = origSession.utm_source;
            utmMedium = origSession.utm_medium;
            utmCampaign = origSession.utm_campaign;
            referrerDomain = origSession.referrer_domain;
          }
        }

        // Fallback: find most recent session by visitor_id
        if (!utmSource && visitorId) {
          const recentSession = await getRow(
            'SELECT * FROM sessions WHERE visitor_id = ? ORDER BY started_at DESC LIMIT 1',
            [visitorId]
          );
          if (recentSession) {
            if (!sessionId) sessionId = recentSession.id;
            utmSource = recentSession.utm_source;
            utmMedium = recentSession.utm_medium;
            utmCampaign = recentSession.utm_campaign;
            referrerDomain = recentSession.referrer_domain;
          }
        }

        const amount = session.amount_total || 0;
        const currency = session.currency || 'usd';

        // Look up affiliate attribution for this visitor
        let affiliateId = null;
        if (visitorId) {
          const affiliateVisit = await getRow(
            'SELECT affiliate_id FROM affiliate_visits WHERE visitor_id = ? AND site_id = ? ORDER BY landed_at DESC LIMIT 1',
            [visitorId, site.id]
          );
          if (affiliateVisit) affiliateId = affiliateVisit.affiliate_id;
        }

        await run(
          `INSERT INTO conversions (
            site_id, session_id, visitor_id, stripe_event_id,
            stripe_customer_id, stripe_customer_email, payment_intent_id,
            amount, currency, status,
            utm_source, utm_medium, utm_campaign, referrer_domain, affiliate_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT DO NOTHING`,
          [
            site.id,
            sessionId,
            visitorId,
            session.id,
            session.customer || null,
            session.customer_email || session.customer_details?.email || null,
            paymentIntentId,
            amount,
            currency,
            'completed',
            utmSource,
            utmMedium,
            utmCampaign,
            referrerDomain,
            affiliateId,
          ]
        );

        totalProcessed++;
      }

      // Poll for refunds
      const charges = await stripe.charges.list({
        created: { gte: since },
        limit: 100,
      });

      for (const charge of charges.data) {
        if (!charge.refunded) continue;
        const updated = await run(
          "UPDATE conversions SET status = 'refunded' WHERE payment_intent_id = ? AND site_id = ? AND status = 'completed'",
          [charge.payment_intent, site.id]
        );
        if (updated.rowCount > 0) totalRefunds++;
      }
    } catch (stripeErr) {
      console.error(`Stripe sync error for site ${site.id}:`, stripeErr.message);
    }
  }

  return { sites: sites.length, conversions: totalProcessed, refunds: totalRefunds };
}
