import { parse } from 'cookie';
import { getAuthUser, verifyToken } from './auth';

function getFreedomUser(req) {
  const cookies = parse(req.headers.cookie || '');
  if (cookies['ts_freedom_active'] !== '1') return null;
  const token = cookies['ts_freedom'];
  if (!token) return null;
  try {
    return verifyToken(token);
  } catch {
    return null;
  }
}

export function withAuth(handler) {
  return async (req, res) => {
    const user = getFreedomUser(req) || getAuthUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    req.user = user;
    return handler(req, res);
  };
}
