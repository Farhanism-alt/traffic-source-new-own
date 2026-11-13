import Link from 'next/link';

// Switch between all identified people and the logins list.
export default function PeopleTabs({ siteId, active }) {
  const tab = (href, key, label) => (
    <Link
      href={href}
      prefetch={false}
      style={{
        padding: '6px 14px',
        fontSize: 13,
        fontWeight: 600,
        borderRadius: 6,
        color: active === key ? 'var(--text-heading, #fff)' : 'var(--text-muted)',
        background: active === key ? 'var(--bg-card-hover, rgba(255,255,255,0.08))' : 'transparent',
      }}
    >
      {label}
    </Link>
  );
  return (
    <div style={{ display: 'inline-flex', gap: 4, padding: 3, border: '1px solid var(--border)', borderRadius: 8, marginBottom: 16 }}>
      {tab(`/analytics/${siteId}/people`, 'people', 'All people')}
      {tab(`/analytics/${siteId}/people/logins`, 'logins', 'Logins')}
    </div>
  );
}
