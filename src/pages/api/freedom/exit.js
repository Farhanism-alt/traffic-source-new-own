import { serialize } from 'cookie';

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const opts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  };
  res.setHeader('Set-Cookie', [
    serialize('ts_freedom', '', opts),
    serialize('ts_freedom_active', '', opts),
  ]);
  res.status(200).json({ ok: true });
}
