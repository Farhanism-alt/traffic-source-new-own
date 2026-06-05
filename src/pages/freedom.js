import { useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

export default function Freedom() {
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e) {
    e.preventDefault();
    setError(false);
    setLoading(true);
    try {
      const res = await fetch('/api/freedom-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, password }),
      });
      if (res.ok) {
        router.replace('/');
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Head>
        <title>‎</title>
      </Head>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', background: '#0a0a0a',
      }}>
        <form onSubmit={handleSubmit} style={{
          display: 'flex', flexDirection: 'column', gap: 12, width: 260,
        }}>
          <input
            type="text"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={id}
            onChange={e => setId(e.target.value)}
            style={{
              background: '#111', border: `1px solid ${error ? '#c0392b' : '#222'}`,
              borderRadius: 6, color: '#e0e0e0', fontSize: 14,
              outline: 'none', padding: '10px 12px',
            }}
          />
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            style={{
              background: '#111', border: `1px solid ${error ? '#c0392b' : '#222'}`,
              borderRadius: 6, color: '#e0e0e0', fontSize: 14,
              outline: 'none', padding: '10px 12px',
            }}
          />
          <button
            type="submit"
            disabled={loading || !id || !password}
            style={{
              alignSelf: 'flex-end', background: 'none', border: 'none',
              color: loading ? '#444' : '#666', cursor: loading ? 'default' : 'pointer',
              fontSize: 20, lineHeight: 1, padding: '4px 2px',
              transition: 'color 0.15s',
            }}
            onMouseEnter={e => { if (!loading) e.currentTarget.style.color = '#aaa'; }}
            onMouseLeave={e => { e.currentTarget.style.color = loading ? '#444' : '#666'; }}
          >
            →
          </button>
        </form>
      </div>
    </>
  );
}
