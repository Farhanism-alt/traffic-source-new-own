import { getDb } from './db';

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
  const db = getDb();

  const sites = db
    .prepare('SELECT id, lemonsqueezy_api_key FROM sites WHERE lemonsqueezy_api_key IS NOT NULL')
    .all();

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

          // Dedup: skip already-processed orders
          const existing = db
            .prepare('SELECT id FROM conversions WHERE payment_intent_id = ? AND site_id = ?')
            .get(orderId, site.id);
          if (existing) continue;

          // Extract visitor/session IDs from custom_data
          const customData = attrs.custom_data || {};
          const visitorId = customData.ts_visitor_id || null;
          let sessionId = customData.ts_session_id || null;

          // Attribution
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

          // LemonSqueezy amounts are in cents (total is integer, e.g. 1999 = $19.99)
          const amount = attrs.total || 0;
          const currency = (attrs.currency || 'usd').toLowerCase();

          db.prepare(
            `INSERT OR IGNORE INTO conversions (
              site_id, session_id, visitor_id, payment_intent_id,
              stripe_customer_email, amount, currency, status, payment_provider,
              utm_source, utm_medium, utm_campaign, referrer_domain, affiliate_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', 'lemonsqueezy', ?, ?, ?, ?, ?)`
          ).run(
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
            affiliateId
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
          const updated = db
            .prepare(
              "UPDATE conversions SET status = 'refunded' WHERE payment_intent_id = ? AND site_id = ? AND status = 'completed' AND payment_provider = 'lemonsqueezy'"
            )
            .run(orderId, site.id);
          if (updated.changes > 0) totalRefunds++;
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
