import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import TimeSeriesChart from '@/components/charts/TimeSeriesChart';

const PERIODS = [
  { label: '7d', value: '7d' },
  { label: '30d', value: '30d' },
  { label: '90d', value: '90d' },
];

export default function SharedAffiliateDashboard() {
  const router = useRouter();
  const { token } = router.query;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [period, setPeriod] = useState('30d');

  const fetchData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/shared/affiliate/${token}?period=${period}`);
      if (!res.ok) {
        setError(res.status === 404 ? 'This link is no longer valid.' : 'Something went wrong.');
        setData(null);
      } else {
        setData(await res.json());
        setError(null);
      }
    } catch {
      setError('Failed to load data.');
    } finally {
      setLoading(false);
    }
  }, [token, period]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="shared-page">
        <div className="shared-container">
          <div className="loading-inline"><div className="loading-spinner" /></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="shared-page">
        <Head><title>Shared Dashboard</title></Head>
        <div className="shared-container">
          <div className="shared-error">{error}</div>
        </div>
      </div>
    );
  }

  const { affiliate, site, stats } = data;

  return (
    <div className="shared-page">
      <Head>
        <title>{affiliate.name} - {site.name} - Partner Dashboard</title>
      </Head>
      <div className="shared-container">
        <div className="shared-header">
          <div>
            <h1 className="shared-title">{affiliate.name}</h1>
            <p className="shared-subtitle">Partner dashboard for {site.name}</p>
          </div>
          <div className="shared-period-tabs">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                className={`shared-period-tab ${period === p.value ? 'active' : ''}`}
                onClick={() => setPeriod(p.value)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Metrics */}
        <div className="shared-metrics">
          <div className="shared-metric">
            <span className="shared-metric-value">{stats.visits.toLocaleString()}</span>
            <span className="shared-metric-label">Clicks</span>
          </div>
          <div className="shared-metric">
            <span className="shared-metric-value">{stats.uniqueVisitors.toLocaleString()}</span>
            <span className="shared-metric-label">Unique Visitors</span>
          </div>
          <div className="shared-metric">
            <span className="shared-metric-value">{stats.conversions.toLocaleString()}</span>
            <span className="shared-metric-label">Conversions</span>
          </div>
          <div className="shared-metric">
            <span className="shared-metric-value">${(stats.revenue / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
            <span className="shared-metric-label">Revenue</span>
          </div>
          <div className="shared-metric">
            <span className="shared-metric-value">{stats.conversionRate}%</span>
            <span className="shared-metric-label">Conversion Rate</span>
          </div>
          {affiliate.commission_rate > 0 && (
            <div className="shared-metric shared-metric--highlight">
              <span className="shared-metric-value">${(stats.commission / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
              <span className="shared-metric-label">Commission ({(affiliate.commission_rate * 100).toFixed(0)}%)</span>
            </div>
          )}
        </div>

        {/* Visits Chart */}
        {data.visitTimeSeries?.length > 0 && (
          <div className="shared-panel">
            <h3 className="shared-panel-title">Clicks Over Time</h3>
            <div className="chart-container">
              <TimeSeriesChart
                data={data.visitTimeSeries}
                dataKey="visits"
                label="Clicks"
              />
            </div>
          </div>
        )}

        {/* Top Landing Pages */}
        {data.landingPages?.length > 0 && (
          <div className="shared-panel">
            <h3 className="shared-panel-title">Top Landing Pages</h3>
            <table className="journey-table">
              <thead>
                <tr>
                  <th>Page</th>
                  <th>Clicks</th>
                </tr>
              </thead>
              <tbody>
                {data.landingPages.map((p, i) => (
                  <tr key={i}>
                    <td>{p.name}</td>
                    <td>{p.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="shared-footer">
          Powered by SAC MAC
        </div>
      </div>
    </div>
  );
}
