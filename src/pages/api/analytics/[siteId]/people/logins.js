import { withAuth } from '@/lib/withAuth';
import { parseDateRange, verifySiteOwnership, getLinkedSiteIds } from '@/lib/analytics';
import { queryLogins } from '@/lib/logins';
import { SOURCE_TYPES } from '@/lib/sources';

// Logged-in users: one row per email.
// ?search= &source=<name or AI|Search|Social|Referral|Direct> &paid=paid|unpaid
// &date_mode=active|first (logged in during the range | first login in the range)
// &login_only=1 (only explicit login events, not everyone identified by email) &sort= &order= &page= &limit= &format=csv

const SORTS = {
  last_login: (r) => new Date(r.lastLogin || 0).getTime(),
  first_login: (r) => new Date(r.firstLogin || 0).getTime(),
  last_active: (r) => new Date(r.lastActive || 0).getTime(),
  logins: (r) => r.logins,
  spent: (r) => r.spentCents,
  email: (r) => r.email,
};

function csvCell(v) {
  if (v == null) return '';
  const s = v instanceof Date ? v.toISOString() : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const iso = (d) => (d ? new Date(d).toISOString() : '');

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { siteId } = req.query;
  const site = await verifySiteOwnership(siteId, req.user.userId);
  if (!site) return res.status(404).json({ error: 'Site not found' });

  const range = parseDateRange(req.query);
  const from = range.from;
  const to = range.to + ' 23:59:59';
  const ids = (await getLinkedSiteIds(siteId)).map(String);

  let all;
  try {
    all = await queryLogins(ids, { from, to, includeIdentified: req.query.login_only !== '1' });
  } catch (err) {
    if (err.code === '42P01') all = []; // events / identities tables not created yet
    else throw err;
  }

  // Date range: logged in during it, or first logged in during it
  const fromMs = new Date(from).getTime();
  const toMs = new Date(to).getTime();
  const dateMode = req.query.date_mode === 'first' ? 'first' : 'active';
  let rows = all.filter((r) => {
    if (dateMode === 'first') {
      const t = new Date(r.firstLogin).getTime();
      return t >= fromMs && t <= toMs;
    }
    return r.activeInRange;
  });

  // Source options are counted before the source filter is applied
  const sourceCounts = new Map();
  for (const r of rows) {
    const k = `${r.source}|${r.sourceType}`;
    sourceCounts.set(k, (sourceCounts.get(k) || 0) + 1);
  }
  const sources = [...sourceCounts.entries()]
    .map(([k, count]) => { const [name, type] = k.split('|'); return { name, type, count }; })
    .sort((a, b) => b.count - a.count);

  const source = String(req.query.source || '');
  if (source) {
    rows = SOURCE_TYPES.includes(source)
      ? rows.filter((r) => r.sourceType === source)
      : rows.filter((r) => r.source === source);
  }
  if (req.query.paid === 'paid') rows = rows.filter((r) => r.payments > 0);
  if (req.query.paid === 'unpaid') rows = rows.filter((r) => r.payments === 0);
  if (req.query.paid === 'refunded') rows = rows.filter((r) => r.refunds > 0);
  const search = String(req.query.search || '').trim().toLowerCase();
  if (search) {
    rows = rows.filter((r) => [r.email, r.city, r.country, r.source, r.utmCampaign, r.referrer]
      .some((v) => v && String(v).toLowerCase().includes(search)));
  }

  const key = SORTS[req.query.sort] || SORTS.last_login;
  const dir = req.query.order === 'asc' ? 1 : -1;
  rows.sort((a, b) => {
    const x = key(a);
    const y = key(b);
    return (x < y ? -1 : x > y ? 1 : 0) * dir || a.email.localeCompare(b.email);
  });

  const totals = {
    people: rows.length,
    paid: rows.filter((r) => r.payments > 0).length,
    revenue: rows.reduce((m, r) => {
      if (r.spentCents) m[r.currency || 'USD'] = (m[r.currency || 'USD'] || 0) + r.spentCents;
      return m;
    }, {}),
  };

  if (req.query.format === 'csv') {
    const header = ['Email', 'First login (UTC)', 'Recent login (UTC)', 'Logins', 'Logins in range', 'Login method',
      'Came from', 'Source type', 'Referrer', 'UTM medium', 'UTM campaign', 'Landing page', 'First seen (UTC)',
      'Last active (UTC)', 'City', 'Country', 'Device', 'Paid', 'Payments', 'Total spent', 'Currency', 'Last payment (UTC)', 'Refunded payments', 'Refunded amount'];
    const lines = [header.map(csvCell).join(',')];
    for (const r of rows) {
      lines.push([
        r.email, iso(r.firstLogin), iso(r.lastLogin), r.logins, r.loginsInRange, r.provider,
        r.source, r.sourceType, r.referrer, r.utmMedium, r.utmCampaign, r.entryPage, iso(r.firstSeen),
        iso(r.lastActive), r.city, r.country, r.device, r.payments > 0 ? 'Yes' : 'No', r.payments,
        r.spentCents ? (r.spentCents / 100).toFixed(2) : '0.00', r.currency, iso(r.lastPaid),
        r.refunds, r.refundedCents ? `${(r.refundedCents / 100).toFixed(2)} ${r.refundCurrency || ''}`.trim() : '',
      ].map(csvCell).join(','));
    }
    const slug = String(site.domain || site.name || `site-${siteId}`).replace(/[^a-z0-9.-]+/gi, '-');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="logins-${slug}-${from}-to-${range.to}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send('﻿' + lines.join('\r\n'));
  }

  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  res.setHeader('Cache-Control', 'private, max-age=15');
  res.status(200).json({
    site: { id: site.id, name: site.name, domain: site.domain },
    logins: rows.slice((page - 1) * limit, page * limit),
    sources,
    totals,
    totalLoginUsers: all.length,
    pagination: { page, limit, total: rows.length, totalPages: Math.max(1, Math.ceil(rows.length / limit)) },
  });
});
