import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import Head from 'next/head';

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Login - Traffic Source</title>
      </Head>
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-logo">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" d="M22 12A10 10 0 1 1 12 2m2.5.315c3.514.904 6.28 3.67 7.185 7.185" />
            </svg>
          </div>
          <h1>Traffic Source</h1>
          <p className="auth-subtitle">Sign in to your analytics dashboard</p>
          <form onSubmit={handleSubmit}>
            {error && <div className="auth-error">{error}</div>}
            <div className="form-group">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Your password"
                required
              />
            </div>
            <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
