import Link from 'next/link';
import { useRouter } from 'next/router';
import ProtectedRoute from '../ProtectedRoute';
import { useAuth } from '@/contexts/AuthContext';
import { useDateRange } from '@/contexts/DateRangeContext';

const periods = [
  { value: '24h', label: '1D' },
  { value: '7d', label: '7D' },
  { value: '30d', label: '1M' },
  { value: '90d', label: '3M' },
  { value: '12m', label: '1Y' },
];

export default function DashboardLayout({ children, siteId, siteName }) {
  const { period, setPeriod, setCustomRange } = useDateRange();
  const { logout } = useAuth();
  const router = useRouter();
  const path = router.asPath;

  return (
    <ProtectedRoute>
      <div className="app-layout">
        <header className="app-header">
          <div className="app-header-left">
            <Link href="/sites" className="app-logo">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" d="M22 12A10 10 0 1 1 12 2m2.5.315c3.514.904 6.28 3.67 7.185 7.185" />
              </svg>
              Traffic Source
            </Link>
            <nav className="app-nav">
              <Link href="/sites" className={`app-nav-link ${path === '/sites' ? 'active' : ''}`}>
                Sites
              </Link>
              {siteId && (
                <>
                  <Link
                    href={`/analytics/${siteId}`}
                    className={`app-nav-link ${path === `/analytics/${siteId}` ? 'active' : ''}`}
                  >
                    Analytics
                  </Link>
                  <Link
                    href={`/analytics/${siteId}/conversions`}
                    className={`app-nav-link ${path.includes('/conversions') ? 'active' : ''}`}
                  >
                    Conversions
                  </Link>
                  <Link
                    href={`/analytics/${siteId}/settings`}
                    className={`app-nav-link ${path.includes('/settings') && path.includes('/analytics/') ? 'active' : ''}`}
                  >
                    Settings
                  </Link>
                </>
              )}
            </nav>
          </div>
          <div className="app-header-right">
            <div className="date-picker">
              {periods.map((p) => (
                <button
                  key={p.value}
                  className={period === p.value ? 'active' : ''}
                  onClick={() => { setCustomRange(null); setPeriod(p.value); }}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <button className="btn-ghost" onClick={logout}>Sign out</button>
          </div>
        </header>

        <main className="app-content">
          {children}
        </main>
      </div>
    </ProtectedRoute>
  );
}
