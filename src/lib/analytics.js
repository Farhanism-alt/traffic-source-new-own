import { getRow } from './db';

export function parseDateRange(query) {
  const { from, to, period } = query;
  if (from && to) {
    return { from, to };
  }
  const now = new Date();
  const periods = {
    '24h': 1,
    '7d': 7,
    '30d': 30,
    '90d': 90,
    '12m': 365,
  };
  const days = periods[period] || 30;
  const fromDate = new Date(now);
  fromDate.setDate(fromDate.getDate() - days);
  return {
    from: fromDate.toISOString().slice(0, 10),
    to: now.toISOString().slice(0, 10),
  };
}

export async function verifySiteOwnership(siteId, userId) {
  return getRow('SELECT * FROM sites WHERE id = ? AND user_id = ?', [siteId, userId]);
}
