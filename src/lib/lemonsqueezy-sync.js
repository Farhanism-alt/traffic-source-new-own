import { getRow, getRows, run } from './db';
import { lookupVisitorByEmail } from './visitor-identity';

const LS_API_BASE = 'https://api.lemonsqueezy.com/v1';

async function lsGet(path, apiKey) {
  const res = await fetch(`${LS_API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/vnd.api+json',
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LemonSqueezy API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

export async function syncLemonSqueezyPayments() {
  const sites = await getRows(
    'SELECT id, lemonsqueezy_api_key FROM sites WHERE lemonsqueezy_api_key IS NOT NULL'
  );

  if (sites.length === 0) return { sites: 0, conversions: 0, refunds: 0 };

  let totalProcessed = 0;
  let totalRefunds = 0;

  for (const site of sites) {
    try {
      // Fetch paid orders from the last 24 hours, paginating through all results
      let pageUrl = '/orders?filter[status]=paid&page[size]=100&sort=-created_at';
      const since = new Date(Date.now() - 86400 * 1000);

      while (pageUrl) {
        const json = await lsGet(pageUrl, site.lemonsqueezy_api_key);
        const orders = json.data || [];

        let reachedCutoff = false;

        for (const order of orders) {
          const attrs = order.attributes;
          const createdAt = new Date(attrs.created_at);

          if (createdAt < since) {
            reachedCutoff = true;
            break;
          }

          const orderId = String(order.id);

          // Dedup: skip only if already fully attributed
          const existing = await getRow(
            'SELECT id, visitor_id FROM conversions WHERE payment_intent_id = ? AND site_id = ?',
            [orderId, site.id]
          );
          if (existing?.visitor_id) continue;

          // Extract visitor/session IDs from custom_data
          const customData = attrs.custom_data || {};
          let visitorId = customData.ts_visitor_id || null;
          let sessionId = customData.ts_session_id || null;

          // Fallback: match by customer email via visitor_identities
          const customerEmail = attrs.user_email || null;
          if (!visitorId && customerEmail) {
            visitorId = await lookupVisitorByEmail(site.id, customerEmail);
          }

          // Fallback: temporal proximity — find the visitor most recently active before this payment.
          // Uses billing country to reduce false positives on busier sites.
          if (!visitorId) {
            const paymentAt = attrs.created_at || new Date().toISOString();
            const billingCountry = attrs.billing_address?.country || null;
            const proxSession = await getRow(
              `SELECT visitor_id FROM sessions
               WHERE site_id = ?
                 AND COALESCE(last_activity, started_at) <= ?::timestamptz
                 AND COALESCE(last_activity, started_at) >= ?::timestamptz - INTERVAL '2 hours'
                 AND (? IS NULL OR country = ?)
               ORDER BY COALESCE(last_activity, started_at) DESC
               LIMIT 1`,
              [site.id, paymentAt, paymentAt, billingCountry, billingCountry]
            );
            if (proxSession?.visitor_id) visitorId = proxSession.visitor_id;
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

          // Attribution
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
              'SELECT * FROM sessions WHERE visitor_id = ? AND site_id = ? ORDER BY started_at DESC LIMIT 1',
              [visitorId, site.id]
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

          // LemonSqueezy amounts are in cents (total is integer, e.g. 1999 = $19.99)
          const amount = attrs.total || 0;
          const currency = (attrs.currency || 'usd').toLowerCase();

          await run(
            `INSERT INTO conversions (
              site_id, session_id, visitor_id, payment_intent_id,
              stripe_customer_email, amount, currency, status, payment_provider,
              utm_source, utm_medium, utm_campaign, referrer_domain, affiliate_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', 'lemonsqueezy', ?, ?, ?, ?, ?)
            ON CONFLICT DO NOTHING`,
            [
              site.id,
              sessionId,
              visitorId,
              orderId,
              attrs.user_email || null,
              amount,
              currency,
              utmSource,
              utmMedium,
              utmCampaign,
              referrerDomain,
              affiliateId,
            ]
          );

          totalProcessed++;
        }

        // Stop paginating if we've gone past the 24h window or no more pages
        if (reachedCutoff || !json.links?.next) break;

        // Extract relative path from next URL
        try {
          pageUrl = new URL(json.links.next).pathname + new URL(json.links.next).search;
        } catch {
          break;
        }
      }

      // Check for refunds (orders with status 'refunded')
      let refundUrl = '/orders?filter[status]=refunded&page[size]=100&sort=-created_at';
      const refundSince = new Date(Date.now() - 86400 * 1000);

      while (refundUrl) {
        const json = await lsGet(refundUrl, site.lemonsqueezy_api_key);
        const orders = json.data || [];
        let reachedCutoff = false;

        for (const order of orders) {
          const attrs = order.attributes;
          if (new Date(attrs.updated_at) < refundSince) {
            reachedCutoff = true;
            break;
          }

          const orderId = String(order.id);
          const updated = await run(
            "UPDATE conversions SET status = 'refunded' WHERE payment_intent_id = ? AND site_id = ? AND status = 'completed' AND payment_provider = 'lemonsqueezy'",
            [orderId, site.id]
          );
          if (updated.rowCount > 0) totalRefunds++;
        }

        if (reachedCutoff || !json.links?.next) break;
        try {
          refundUrl = new URL(json.links.next).pathname + new URL(json.links.next).search;
        } catch {
          break;
        }
      }
    } catch (err) {
      console.error(`LemonSqueezy sync error for site ${site.id}:`, err.message);
    }
  }

  return { sites: sites.length, conversions: totalProcessed, refunds: totalRefunds };
}
