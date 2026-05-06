import { getRow, getRows, run } from './db';
import { encrypt, decrypt } from './crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const SCOPES = 'https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/userinfo.email';

// ───── settings (client id/secret stored encrypted in app_settings) ─────

export async function getGscCredentials() {
  const rows = await getRows(
    "SELECT key, value FROM app_settings WHERE key IN ('gsc_client_id','gsc_client_secret')"
  );
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    clientId: decrypt(map.gsc_client_id),
    clientSecret: decrypt(map.gsc_client_secret),
  };
}

export async function saveGscCredentials({ clientId, clientSecret }) {
  await run(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
    ['gsc_client_id', encrypt(clientId)]
  );
  await run(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
    ['gsc_client_secret', encrypt(clientSecret)]
  );
}

export async function clearGscCredentials() {
  await run("DELETE FROM app_settings WHERE key IN ('gsc_client_id','gsc_client_secret')");
}

export async function isGscConfigured() {
  const { clientId, clientSecret } = await getGscCredentials();
  return !!(clientId && clientSecret);
}

// ───── redirect URI auto-detection ─────

export function getRedirectUri(req) {
  const proto = (req.headers['x-forwarded-proto'] || (req.socket?.encrypted ? 'https' : 'http')).split(',')[0].trim();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000').split(',')[0].trim();
  return `${proto}://${host}/api/auth/google/callback`;
}

// ───── OAuth flow ─────

export function buildAuthUrl({ clientId, redirectUri, state }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForTokens({ code, redirectUri }) {
  const { clientId, clientSecret } = await getGscCredentials();
  if (!clientId || !clientSecret) throw new Error('GSC not configured');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${await res.text()}`);
  return res.json();
}

export async function refreshAccessToken(refreshToken) {
  const { clientId, clientSecret } = await getGscCredentials();
  if (!clientId || !clientSecret) throw new Error('GSC not configured');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Refresh failed: ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

export async function fetchUserEmail(accessToken) {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.email || null;
}

// ───── Search Console API ─────

export async function listGscProperties(accessToken) {
  const res = await fetch('https://searchconsole.googleapis.com/webmasters/v3/sites', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`List sites failed: ${await res.text()}`);
  const data = await res.json();
  return (data.siteEntry || []).filter((s) => s.permissionLevel !== 'siteUnverifiedUser');
}

export async function querySearchAnalytics({ accessToken, property, startDate, endDate, dimensions = ['query', 'page'], rowLimit = 25000, dimensionFilterGroups }) {
  const url = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`;
  const body = { startDate, endDate, dimensions, rowLimit, dataState: 'final' };
  if (dimensionFilterGroups) body.dimensionFilterGroups = dimensionFilterGroups;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Search Analytics failed: ${await res.text()}`);
  const data = await res.json();
  return data.rows || [];
}

// ───── user-level Google connection ─────

export async function getUserConnection(userId) {
  return getRow('SELECT * FROM gsc_connections WHERE user_id = ?', [userId]);
}

export async function saveUserConnection({ userId, refreshToken, googleEmail }) {
  await run(
    `INSERT INTO gsc_connections (user_id, refresh_token, google_email, connected_at)
     VALUES (?, ?, ?, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       refresh_token = EXCLUDED.refresh_token,
       google_email = EXCLUDED.google_email,
       connected_at = EXCLUDED.connected_at,
       last_error = NULL`,
    [userId, encrypt(refreshToken), googleEmail]
  );
}

export async function deleteUserConnection(userId) {
  // Cascade: unlink all of user's sites and wipe their GSC data
  const siteRows = await getRows('SELECT id FROM sites WHERE user_id = ?', [userId]);
  const siteIds = siteRows.map((r) => r.id);
  for (const sid of siteIds) {
    await run('DELETE FROM gsc_site_links WHERE site_id = ?', [sid]);
    await run('DELETE FROM gsc_daily WHERE site_id = ?', [sid]);
    await run('DELETE FROM gsc_trends WHERE site_id = ?', [sid]);
  }
  await run('DELETE FROM gsc_connections WHERE user_id = ?', [userId]);
}

export function getDecryptedRefreshToken(conn) {
  return conn?.refresh_token ? decrypt(conn.refresh_token) : null;
}

// ───── per-site property link ─────

export async function getSiteLink(siteId) {
  return getRow('SELECT * FROM gsc_site_links WHERE site_id = ?', [siteId]);
}

export async function linkSiteProperty(siteId, property) {
  await run(
    `INSERT INTO gsc_site_links (site_id, gsc_property, status, linked_at)
     VALUES (?, ?, 'active', NOW())
     ON CONFLICT (site_id) DO UPDATE SET gsc_property = EXCLUDED.gsc_property, status = 'active', last_error = NULL`,
    [siteId, property]
  );
}

export async function unlinkSite(siteId) {
  await run('DELETE FROM gsc_site_links WHERE site_id = ?', [siteId]);
  await run('DELETE FROM gsc_daily WHERE site_id = ?', [siteId]);
  await run('DELETE FROM gsc_trends WHERE site_id = ?', [siteId]);
}
