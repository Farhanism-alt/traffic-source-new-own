import { DodoPayments } from 'dodopayments';
import { getRow, getRows, run } from './db';
import { lookupVisitorByEmail } from './visitor-identity';

export async function syncDodoPayments() {
  const sites = await getRows(
    'SELECT id, dodo_api_key FROM sites WHERE dodo_api_key IS NOT NULL'
  );

  if (sites.length === 0) return { sites: 0, conversions: 0, refunds: 0 };

  let totalProcessed = 0;
  let totalRefunds = 0;

  for (const site of sites) {
    const dodo = new DodoPayments({ bearerToken: site.dodo_api_key });

    try {
      for await (const payment of dodo.payments.list({
        status: 'succeeded',
        page_size: 100,
      })) {
        const paymentId = payment.payment_id;

        // Dedup: skip only if already fully attributed
        const existing = await getRow(
          'SELECT id, visitor_id FROM conversions WHERE payment_intent_id = ? AND site_id = ?',
          [paymentId, site.id]
        );
        if (existing?.visitor_id) continue;

        // Extract visitor/session IDs from metadata
        let visitorId = payment.metadata?.ts_visitor_id || null;
        let sessionId = payment.metadata?.ts_session_id || null;

        // Fallback: match by customer email via visitor_identities
        const customerEmail = payment.customer?.email || null;
        if (!visitorId && customerEmail) {
          visitorId = await lookupVisitorByEmail(site.id, customerEmail);
        }

        // Existing conversion with no visitor_id: update attribution in place and move on
        if (existing) {
          if (visitorId) {
            const recentSession = await getRow(
              'SELECT * FROM sessions WHERE visitor_id = ? AND site_id = ? ORDER BY started_at DESC LIMIT 1',
              [visitorId, site.id]
            );
            await run(
              `UPDATE conversions SET visitor_id = ?, session_id = ?, utm_source = ?, utm_medium = ?, utm_campaign = ?, referrer_domain = ? WHERE id = ? AND visitor_id IS NULL`,
              [visitorId, recentSession?.id || null, recentSession?.utm_source || null, recentSession?.utm_medium || null, recentSession?.utm_campaign || null, recentSession?.referrer_domain || null, existing.id]
            );
          }
          continue;
        }

        // Attribution via session lookup
        let utmSource = null, utmMedium = null, utmCampaign = null, referrerDomain = null;

        if (sessionId) {
          const origSession = await getRow('SELECT * FROM sessions WHERE id = ?', [sessionId]);
          if (origSession) {
            utmSource = origSession.utm_source;
            utmMedium = origSession.utm_medium;
            utmCampaign = origSession.utm_campaign;
            referrerDomain = origSession.referrer_domain;
          }
        }

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

        // Affiliate attribution
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
            site_id, session_id, visitor_id, payment_intent_id,
            stripe_customer_email, amount, currency, status, payment_provider,
            utm_source, utm_medium, utm_campaign, referrer_domain, affiliate_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', 'dodo', ?, ?, ?, ?, ?)
          ON CONFLICT DO NOTHING`,
          [
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
            affiliateId,
          ]
        );

        totalProcessed++;
      }

      // Check for refunds by looking at payments with refund_status
      for await (const payment of dodo.payments.list({
        page_size: 100,
      })) {
        if (!payment.refund_status) continue;
        const updated = await run(
          "UPDATE conversions SET status = 'refunded' WHERE payment_intent_id = ? AND site_id = ? AND status = 'completed' AND payment_provider = 'dodo'",
          [payment.payment_id, site.id]
        );
        if (updated.rowCount > 0) totalRefunds++;
      }
    } catch (err) {
      console.error(`Dodo sync error for site ${site.id}:`, err.message);
    }
  }

  return { sites: sites.length, conversions: totalProcessed, refunds: totalRefunds };
}
