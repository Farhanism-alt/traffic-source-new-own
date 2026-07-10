import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import DashboardLayout from '@/components/layout/DashboardLayout';
import MetricStrip from '@/components/ui/MetricStrip';
import TimeSeriesChart from '@/components/charts/TimeSeriesChart';
import { useDateRange } from '@/contexts/DateRangeContext';

export default function AffiliateDetail() {
  const router = useRouter();
  const { siteId, affiliateId } = router.query;
  const { getParams } = useDateRange();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [shareToken, setShareToken] = useState(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [shareLoading, setShareLoading] = useState(false);

  const fetchData = useCallback(async () => {
    if (!siteId || !affiliateId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams(getParams());
      const res = await fetch(`/api/analytics/${siteId}/affiliates/${affiliateId}?${params}`);
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, [siteId, affiliateId, JSON.stringify(getParams())]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const copyLink = () => {
    if (!data) return;
    const domain = data.site?.domain || 'yoursite.com';
    navigator.clipboard.writeText(`https://${domain}?ref=${data.affiliate.slug}`);
  };

  // Fetch existing share token
  useEffect(() => {
    if (!siteId || !affiliateId) return;
    fetch(`/api/analytics/${siteId}/affiliates/${affiliateId}/share`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d) setShareToken(d.share_token); });
  }, [siteId, affiliateId]);

  const generateShareLink = async () => {
    setShareLoading(true);
    try {
      const res = await fetch(`/api/analytics/${siteId}/affiliates/${affiliateId}/share`, { method: 'POST' });
      if (res.ok) {
        const d = await res.json();
        setShareToken(d.share_token);
      }
    } finally {
      setShareLoading(false);
    }
  };

  const revokeShareLink = async () => {
    setShareLoading(true);
    try {
      const res = await fetch(`/api/analytics/${siteId}/affiliates/${affiliateId}/share`, { method: 'DELETE' });
      if (res.ok) {
        setShareToken(null);
        setShareCopied(false);
      }
    } finally {
      setShareLoading(false);
    }
  };

  const copyShareLink = () => {
    const url = `${window.location.origin}/shared/affiliate/${shareToken}`;
    navigator.clipboard.writeText(url);
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 2000);
  };

  if (loading || !data) {
    return (
      <>
        <Head><title>Affiliate - SAC MAC</title></Head>
        <DashboardLayout siteId={siteId}>
          <div className="loading-inline"><div className="loading-spinner" /></div>
        </DashboardLayout>
      </>
    );
  }

  const { affiliate, stats } = data;

  return (
    <>
      <Head>
        <title>{affiliate.name} - Affiliates - SAC MAC</title>
      </Head>
      <DashboardLayout siteId={siteId} siteName={data.site?.name} siteDomain={data.site?.domain}>
        <div className="page-nav" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => router.push(`/analytics/${siteId}/affiliates`)}
          >
            &larr; Affiliates
          </button>
          <h2 className="page-title" style={{ margin: 0 }}>{affiliate.name}</h2>
          <code style={{ fontSize: 12, color: 'var(--text-muted)' }}>ref={affiliate.slug}</code>
        </div>

        {/* Metrics */}
        <MetricStrip metrics={[
          { label: 'Visits', value: stats.visits },
          { label: 'Unique Visitors', value: stats.uniqueVisitors },
          { label: 'Conversions', value: stats.conversions },
          { label: 'Revenue', value: stats.revenue, format: 'currency' },
          { label: 'Conversion Rate', value: stats.conversionRate, format: 'percent' },
          ...(affiliate.commission_rate > 0
            ? [{ label: `Commission (${(affiliate.commission_rate * 100).toFixed(0)}%)`, value: stats.commission, format: 'currency' }]
            : []),
        ]} />

        {/* Referral Link */}
        <div className="panel" style={{ marginBottom: 20 }}>
          <div className="panel-header">
            <div className="panel-tabs">
              <button className="panel-tab active">Referral Link</button>
            </div>
          </div>
          <div className="panel-body" style={{ padding: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
            <code style={{ flex: 1, fontSize: 13, padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              https://{data.site?.domain}?ref={affiliate.slug}
            </code>
            <button className="btn btn-primary btn-sm" onClick={copyLink}>Copy</button>
          </div>
        </div>

        {/* Share Dashboard */}
        <div className="panel" style={{ marginBottom: 20 }}>
          <div className="panel-header">
            <div className="panel-tabs">
              <button className="panel-tab active">Partner Dashboard Link</button>
            </div>
          </div>
          <div className="panel-body" style={{ padding: 20 }}>
            {shareToken ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
                  Share this link with your affiliate partner so they can view their performance.
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <code style={{ flex: 1, fontSize: 13, padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {typeof window !== 'undefined' ? `${window.location.origin}/shared/affiliate/${shareToken}` : ''}
                  </code>
                  <button className="btn btn-primary btn-sm" onClick={copyShareLink}>
                    {shareCopied ? 'Copied!' : 'Copy'}
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={revokeShareLink}
                    disabled={shareLoading}
                    style={{ color: 'var(--error)' }}
                  >
                    Revoke
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
                  Generate a public link so your partner can see their clicks, conversions, and commission.
                </p>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={generateShareLink}
                  disabled={shareLoading}
                  style={{ flexShrink: 0 }}
                >
                  {shareLoading ? 'Generating...' : 'Generate Link'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Visits Chart */}
        {data.visitTimeSeries?.length > 0 && (
          <div className="panel" style={{ marginBottom: 20 }}>
            <div className="panel-header">
              <div className="panel-tabs">
                <button className="panel-tab active">Visits Over Time</button>
              </div>
            </div>
            <div className="panel-body chart-container">
              <TimeSeriesChart
                data={data.visitTimeSeries}
                dataKey="visits"
                label="Visits"
              />
            </div>
          </div>
        )}

        {/* Top Landing Pages */}
        {data.landingPages?.length > 0 && (
          <div className="panel" style={{ marginBottom: 20 }}>
            <div className="panel-header">
              <div className="panel-tabs">
                <button className="panel-tab active">Top Landing Pages</button>
              </div>
            </div>
            <div className="panel-body" style={{ padding: 0 }}>
              <table className="journey-table">
                <thead>
                  <tr>
                    <th>Page</th>
                    <th>Visits</th>
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
          </div>
        )}

        {/* Recent Conversions */}
        {data.conversions?.length > 0 && (
          <div className="panel" style={{ marginBottom: 20 }}>
            <div className="panel-header">
              <div className="panel-tabs">
                <button className="panel-tab active">Conversions</button>
              </div>
            </div>
            <div className="panel-body" style={{ padding: 0 }}>
              <table className="journey-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Email</th>
                    <th>Amount</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {data.conversions.map((c) => (
                    <tr key={c.id}>
                      <td>{new Date(c.created_at).toLocaleDateString()}</td>
                      <td>{c.stripe_customer_email || c.visitor_id?.slice(0, 8)}</td>
                      <td style={{ fontWeight: 600 }}>${(c.amount / 100).toFixed(2)}</td>
                      <td>{c.utm_source || c.referrer_domain || 'Direct'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </DashboardLayout>
    </>
  );
}
