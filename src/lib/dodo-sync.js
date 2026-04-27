import { DodoPayments } from 'dodopayments';
import { getDb } from './db';

export async function syncDodoPayments() {
  const db = getDb();

  const sites = db
    .prepare('SELECT id, dodo_api_key FROM sites WHERE dodo_api_key IS NOT NULL')
    .all();

  if (sites.length === 0) return { sites: 0, conversions: 0, refunds: 0 };

  let totalProcessed = 0;
  let totalRefunds = 0;

  for (const site of sites) {
    const dodo = new DodoPayments({ bearerToken: site.dodo_api_key });
    const since = new Date(Date.now() - 86400 * 1000).toISOString();

    try {
      for await (const payment of dodo.payments.list({
        created_at_gte: since,
        status: 'succeeded',
        page_size: 100,
      })) {
        const paymentId = payment.payment_id;

        // Dedup: skip already-processed payments
        const existing = db
          .prepare('SELECT id FROM conversions WHERE payment_intent_id = ? AND site_id = ?')
          .get(paymentId, site.id);
        if (existing) continue;

        // Extract visitor/session IDs from metadata
        const visitorId = payment.metadata?.ts_visitor_id || null;
        let sessionId = payment.metadata?.ts_session_id || null;

        // Attribution via session lookup
        let utmSource = null, utmMedium = null, utmCampaign = null, referrerDomain = null;

        if (sessionId) {
          const origSession = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
          if (origSession) {
            utmSource = origSession.utm_source;
            utmMedium = origSession.utm_medium;
            utmCampaign = origSession.utm_campaign;
            referrerDomain = origSession.referrer_domain;
          }
        }

        if (!utmSource && visitorId) {
          const recentSession = db
            .prepare('SELECT * FROM sessions WHERE visitor_id = ? ORDER BY started_at DESC LIMIT 1')
            .get(visitorId);
          if (recentSession) {
            if (!sessionId) sessionId = recentSession.id;
            utmSource = recentSession.utm_source;
            utmMedium = recentSession.utm_medium;
            utmCampaign = recentSession.utm_campaign;
            referrerDomain = recentSession.referrer_domain;
          }
        }

        // Affiliate attribution
        let affiliateId = null;
        if (visitorId) {
          const affiliateVisit = db
            .prepare('SELECT affiliate_id FROM affiliate_visits WHERE visitor_id = ? AND site_id = ? ORDER BY landed_at DESC LIMIT 1')
            .get(visitorId, site.id);
          if (affiliateVisit) affiliateId = affiliateVisit.affiliate_id;
        }

        db.prepare(
          `INSERT OR IGNORE INTO conversions (
            site_id, session_id, visitor_id, payment_intent_id,
            stripe_customer_email, amount, currency, status, payment_provider,
            utm_source, utm_medium, utm_campaign, referrer_domain, affiliate_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', 'dodo', ?, ?, ?, ?, ?)`
        ).run(
          site.id,
          sessionId,
          visitorId,
          paymentId,
          payment.customer?.email || null,
          payment.total_amount || 0,
          (payment.currency || 'usd').toLowerCase(),
          utmSource,
          utmMedium,
          utmCampaign,
          referrerDomain,
          affiliateId
        );

        totalProcessed++;
      }

      // Check for refunds by looking at payments with refund_status
      for await (const payment of dodo.payments.list({
        created_at_gte: since,
        page_size: 100,
      })) {
        if (!payment.refund_status) continue;
        const updated = db
          .prepare(
            "UPDATE conversions SET status = 'refunded' WHERE payment_intent_id = ? AND site_id = ? AND status = 'completed' AND payment_provider = 'dodo'"
          )
          .run(payment.payment_id, site.id);
        if (updated.changes > 0) totalRefunds++;
      }
    } catch (err) {
      console.error(`Dodo sync error for site ${site.id}:`, err.message);
    }
  }

  return { sites: sites.length, conversions: totalProcessed, refunds: totalRefunds };
}
