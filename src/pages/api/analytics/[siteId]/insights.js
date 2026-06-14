import { withAuth } from '@/lib/withAuth';
import { verifySiteOwnership, parseDateRange } from '@/lib/analytics';
import { run, getRow, getRows } from '@/lib/db';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { siteId } = req.query;
  const site = await verifySiteOwnership(siteId, req.user.userId);
  if (!site) return res.status(404).json({ error: 'Site not found' });

  const { period = '7D' } = req.body || {};

  // Create table if not exists
  await run(`
    CREATE TABLE IF NOT EXISTS ai_insights (
      id SERIAL PRIMARY KEY,
      site_id INTEGER NOT NULL,
      period VARCHAR(20) NOT NULL,
      insights JSONB NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await run(`
    CREATE INDEX IF NOT EXISTS idx_ai_insights_site ON ai_insights(site_id, created_at DESC)
  `);

  // Parse date range from period (lowercase for parseDateRange)
  const periodLower = period.toLowerCase().replace('d', 'd').replace('m', 'm');
  const { from, to } = parseDateRange({ period: periodLower });

  // Collect analytics data in parallel
  const [topSources, topPages, topCountries, convTotals, revenueBySource, stats, timeSeries] = await Promise.all([
    getRows(
      `SELECT COALESCE(utm_source, referrer_domain, 'Direct') as source, COUNT(*) as sessions, ROUND(AVG((COALESCE(is_bounce, page_count<=1))::int)*100,1) as bounce_rate FROM sessions WHERE site_id=? AND started_at BETWEEN ? AND ? GROUP BY source ORDER BY sessions DESC LIMIT 10`,
      [siteId, from, to]
    ),
    getRows(
      `SELECT pathname as page, COUNT(*) as views FROM page_views WHERE site_id=? AND timestamp BETWEEN ? AND ? GROUP BY pathname ORDER BY views DESC LIMIT 10`,
      [siteId, from, to]
    ),
    getRows(
      `SELECT country, COUNT(*) as sessions FROM sessions WHERE site_id=? AND started_at BETWEEN ? AND ? AND country IS NOT NULL GROUP BY country ORDER BY sessions DESC LIMIT 10`,
      [siteId, from, to]
    ),
    getRow(
      `SELECT COUNT(*) as conversions, COALESCE(SUM(amount),0) as revenue, COALESCE(AVG(amount),0) as avg_value FROM conversions WHERE site_id=? AND status='completed' AND created_at BETWEEN ? AND ?`,
      [siteId, from, to]
    ),
    getRows(
      `SELECT COALESCE(utm_source, referrer_domain, 'Direct') as source, COUNT(*) as conversions, SUM(amount) as revenue FROM conversions WHERE site_id=? AND status='completed' AND created_at BETWEEN ? AND ? GROUP BY source ORDER BY revenue DESC LIMIT 10`,
      [siteId, from, to]
    ),
    getRow(
      `SELECT COUNT(DISTINCT visitor_id) as visitors, COUNT(*) as sessions, COALESCE(AVG(COALESCE(duration,0)),0) as avg_duration, ROUND(AVG((COALESCE(is_bounce,page_count<=1))::int)*100,1) as bounce_rate FROM sessions WHERE site_id=? AND started_at BETWEEN ? AND ?`,
      [siteId, from, to]
    ),
    getRows(
      `SELECT DATE(started_at) as date, COUNT(DISTINCT visitor_id) as visitors FROM sessions WHERE site_id=? AND started_at BETWEEN ? AND ? GROUP BY date ORDER BY date`,
      [siteId, from, to]
    ),
  ]);

  // Build user message
  const sourcesText = (topSources || []).map(s => `  ${s.source} | ${s.sessions} | ${s.bounce_rate}%`).join('\n') || '  (no data)';
  const pagesText = (topPages || []).map(p => `  ${p.page} | ${p.views}`).join('\n') || '  (no data)';
  const countriesText = (topCountries || []).map(c => `  ${c.country} | ${c.sessions}`).join('\n') || '  (no data)';
  const convBySourceText = (revenueBySource || []).map(s => `  ${s.source} | ${s.conversions} | ${s.revenue}`).join('\n') || '  (no data)';
  const timeSeriesLast7 = (timeSeries || []).slice(-7).map(d => `  ${d.date}: ${d.visitors} visitors`).join('\n') || '  (no data)';

  const st = stats || {};
  const ct = convTotals || {};

  const userMessage = `Site: ${site.domain}
Period: ${period} (${from} to ${to})

TRAFFIC STATS:
- Visitors: ${st.visitors || 0}, Sessions: ${st.sessions || 0}
- Bounce rate: ${st.bounce_rate || 0}%, Avg session: ${Math.round(st.avg_duration || 0)}s

TOP SOURCES (source | sessions | bounce%):
${sourcesText}

TOP PAGES (page | views):
${pagesText}

TOP COUNTRIES (country | sessions):
${countriesText}

CONVERSIONS:
- Total: ${ct.conversions || 0}, Revenue: $${((ct.revenue || 0) / 100).toFixed(2)} (amounts in cents)
- Avg value: $${((ct.avg_value || 0) / 100).toFixed(2)}

REVENUE BY SOURCE (source | conversions | revenue cents):
${convBySourceText}

DAILY VISITORS (last 7 entries):
${timeSeriesLast7}`;

  const systemPrompt = `You are an honest analytics expert helping a SaaS founder understand their website performance.
Analyze the data and return ONLY valid JSON with no extra text.
Be direct, simple English, no corporate fluff. Short bullets. Specific numbers from the data.

Return this exact JSON structure:
{
  "overall_health": <0-100 integer>,
  "period_summary": "<1 honest sentence about the period overall>",
  "insights": [
    {
      "id": "traffic_quality",
      "title": "Traffic Quality",
      "emoji": "📊",
      "score": <0-100>,
      "score_label": "<Good|Fair|Needs Work>",
      "summary": "<1-2 honest sentences with specific numbers>",
      "bullets": ["<specific finding>", "<specific finding>", "<specific finding>"],
      "tips": [
        {
          "tip": "<specific actionable tip>",
          "ai_prompt": "<a ready-to-use prompt the founder can copy and paste to an AI to implement this tip for their product>"
        }
      ]
    }
  ]
}

The insights array must have EXACTLY 6 items with IDs in this order:
traffic_quality, conversion_leak, untapped_geo, revenue_attribution, trend_anomaly, page_impact

Each insight must have 3 bullets and 2 tips. Each tip must have an ai_prompt that is a detailed, ready-to-copy prompt.`;

  // Call DeepSeek V3
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'DEEPSEEK_API_KEY not configured' });

  const dsRes = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.7,
      max_tokens: 4000,
    }),
  });

  if (!dsRes.ok) {
    const errText = await dsRes.text().catch(() => '');
    return res.status(502).json({ error: `DeepSeek API error: ${dsRes.status}`, detail: errText });
  }

  const dsData = await dsRes.json();
  const rawContent = dsData.choices?.[0]?.message?.content || '';

  // Parse JSON from response (strip markdown code fences if present)
  let insightsJson;
  try {
    const cleaned = rawContent.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    insightsJson = JSON.parse(cleaned);
  } catch (e) {
    return res.status(502).json({ error: 'Failed to parse AI response as JSON', raw: rawContent.slice(0, 500) });
  }

  // Save to DB
  const saved = await getRow(
    `INSERT INTO ai_insights (site_id, period, insights) VALUES (?, ?, ?) RETURNING id`,
    [siteId, period, JSON.stringify(insightsJson)]
  );

  return res.json({ id: saved?.id, period, from, to, ...insightsJson });
});
