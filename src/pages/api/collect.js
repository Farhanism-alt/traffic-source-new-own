import { getRow, run } from '@/lib/db';
const UAParser = require('ua-parser-js');

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '4kb',
    },
  },
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).end();
  }

  try {
    const data = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    if (!data.site_id || !data.visitor_id || !data.session_id || !data.type) {
      return res.status(400).end();
    }

    // Heartbeat: only refresh last_activity, no new records
    if (data.type === 'heartbeat') {
      const site = await getRow('SELECT id FROM sites WHERE id = ?', [data.site_id]);
      if (!site) return res.status(404).end();
      await run('UPDATE sessions SET last_activity = NOW() WHERE id = ? AND site_id = ?', [
        data.session_id,
        data.site_id,
      ]);
      return res.status(200).end();
    }

    const site = await getRow('SELECT id FROM sites WHERE id = ?', [data.site_id]);
    if (!site) {
      return res.status(404).end();
    }

    const ua = new UAParser(req.headers['user-agent']);
    const browser = ua.getBrowser();
    const os = ua.getOS();
    const device = ua.getDevice();

    // Use Vercel geo headers first, then Cloudflare
    let country =
      req.headers['x-vercel-ip-country'] || req.headers['cf-ipcountry'] || null;
    let city = req.headers['x-vercel-ip-city']
      ? decodeURIComponent(req.headers['x-vercel-ip-city'])
      : req.headers['cf-ipcity'] || null;
    let continent =
      req.headers['x-vercel-ip-continent'] || req.headers['cf-ipcontinent'] || null;

    let referrerDomain = null;
    if (data.referrer) {
      try {
        referrerDomain = new URL(data.referrer).hostname;
      } catch {
        // invalid referrer URL
      }
    }

    const deviceType =
      device.type ||
      (data.screen_width < 768
        ? 'mobile'
        : data.screen_width < 1024
          ? 'tablet'
          : 'desktop');

    const existingSession = await getRow(
      'SELECT id, page_count FROM sessions WHERE id = ?',
      [data.session_id]
    );

    if (!existingSession) {
      await run(
        `INSERT INTO sessions (
          id, site_id, visitor_id, entry_page, exit_page,
          referrer, referrer_domain, utm_source, utm_medium, utm_campaign,
          utm_term, utm_content, country, city, continent,
          browser, browser_version, os, os_version, device_type,
          screen_width, screen_height
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          data.session_id,
          data.site_id,
          data.visitor_id,
          data.pathname,
          data.pathname,
          data.referrer || null,
          referrerDomain,
          data.utm_source || null,
          data.utm_medium || null,
          data.utm_campaign || null,
          data.utm_term || null,
          data.utm_content || null,
          country,
          city,
          continent,
          browser.name || null,
          browser.version || null,
          os.name || null,
          os.version || null,
          deviceType,
          data.screen_width || null,
          data.screen_height || null,
        ]
      );
    } else {
      await run(
        `UPDATE sessions SET
          exit_page = ?,
          last_activity = NOW(),
          page_count = page_count + 1,
          is_bounce = false,
          duration = EXTRACT(EPOCH FROM NOW() - started_at)::INTEGER
        WHERE id = ?`,
        [data.pathname, data.session_id]
      );
    }

    // Affiliate tracking
    if (data.ref) {
      const affiliate = await getRow(
        'SELECT id FROM affiliates WHERE site_id = ? AND slug = ?',
        [data.site_id, data.ref]
      );
      if (affiliate) {
        const alreadyTracked = await getRow(
          'SELECT id FROM affiliate_visits WHERE affiliate_id = ? AND visitor_id = ? AND session_id = ?',
          [affiliate.id, data.visitor_id, data.session_id]
        );
        if (!alreadyTracked) {
          await run(
            `INSERT INTO affiliate_visits (affiliate_id, site_id, visitor_id, session_id, landing_page)
             VALUES (?, ?, ?, ?, ?)`,
            [affiliate.id, data.site_id, data.visitor_id, data.session_id, data.pathname]
          );
        }
      }
    }

    if (data.type === 'pageview') {
      let querystring = null;
      try {
        querystring = new URL(data.url).search || null;
      } catch {
        // invalid URL
      }

      await run(
        `INSERT INTO page_views (site_id, session_id, visitor_id, pathname, hostname, querystring, referrer)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          data.site_id,
          data.session_id,
          data.visitor_id,
          data.pathname,
          data.hostname || null,
          querystring,
          data.referrer || null,
        ]
      );

      const today = new Date().toISOString().slice(0, 10);
      await run(
        `INSERT INTO daily_stats (site_id, date, page_views, sessions, visitors)
         VALUES (?, ?, 1, 0, 0)
         ON CONFLICT (site_id, date) DO UPDATE SET page_views = daily_stats.page_views + 1`,
        [data.site_id, today]
      );

      if (!existingSession) {
        const visitorToday = await getRow(
          `SELECT 1 FROM sessions
           WHERE site_id = ? AND visitor_id = ? AND DATE(started_at) = ? AND id != ?
           LIMIT 1`,
          [data.site_id, data.visitor_id, today, data.session_id]
        );

        const visitorDelta = visitorToday ? 0 : 1;
        await run(
          `UPDATE daily_stats SET
            sessions = sessions + 1,
            visitors = visitors + ?
           WHERE site_id = ? AND date = ?`,
          [visitorDelta, data.site_id, today]
        );
      }
    }

    res.status(200).end();
  } catch (err) {
    console.error('Collection error:', err);
    res.status(500).end();
  }
}
