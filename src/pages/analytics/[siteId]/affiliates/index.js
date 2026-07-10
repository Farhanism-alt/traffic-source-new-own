import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useAnalytics } from '@/hooks/useAnalytics';

export default function Affiliates() {
  const router = useRouter();
  const { siteId } = router.query;
  const { data, loading, refetch } = useAnalytics('affiliates');

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', slug: '', commission_rate: '' });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async (e) => {
    e.preventDefault();
    setCreating(true);
    setError('');
    try {
      const res = await fetch(`/api/sites/${siteId}/affiliates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          slug: form.slug,
          commission_rate: form.commission_rate ? parseFloat(form.commission_rate) / 100 : 0,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      setForm({ name: '', slug: '', commission_rate: '' });
      setShowCreate(false);
      refetch();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (affiliateId) => {
    if (!confirm('Delete this affiliate and all its tracking data?')) return;
    await fetch(`/api/sites/${siteId}/affiliates/${affiliateId}`, { method: 'DELETE' });
    refetch();
  };

  const copyLink = (slug) => {
    const domain = data?.site?.domain || 'yoursite.com';
    navigator.clipboard.writeText(`https://${domain}?ref=${slug}`);
  };

  return (
    <>
      <Head>
        <title>Affiliates - SAC MAC</title>
      </Head>
      <DashboardLayout siteId={siteId} siteName={data?.site?.name} siteDomain={data?.site?.domain}>
        <div className="page-nav">
          <button className="btn btn-secondary btn-sm" onClick={() => router.push(`/analytics/${siteId}`)}>
            &larr; Dashboard
          </button>
        </div>

        {/* Affiliates table */}
        <div className="panel" style={{ marginBottom: 20 }}>
          <div className="panel-header">
            <div className="panel-tabs">
              <button className="panel-tab active">Affiliates</button>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(!showCreate)}>
              {showCreate ? 'Cancel' : '+ Add Affiliate'}
            </button>
          </div>

          {showCreate && (
            <div className="panel-body" style={{ padding: 20, borderBottom: '1px solid var(--border)' }}>
              {error && <div className="auth-error">{error}</div>}
              <form onSubmit={handleCreate} style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div className="form-group" style={{ flex: 1, minWidth: 150 }}>
                  <label>Name</label>
                  <input
                    type="text"
                    placeholder="John Doe"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group" style={{ flex: 1, minWidth: 150 }}>
                  <label>Slug</label>
                  <input
                    type="text"
                    placeholder="john-doe"
                    value={form.slug}
                    onChange={(e) => setForm({ ...form, slug: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group" style={{ flex: 0, minWidth: 120 }}>
                  <label>Commission %</label>
                  <input
                    type="number"
                    placeholder="20"
                    min="0"
                    max="100"
                    step="0.1"
                    value={form.commission_rate}
                    onChange={(e) => setForm({ ...form, commission_rate: e.target.value })}
                  />
                </div>
                <button type="submit" className="btn btn-primary btn-sm" disabled={creating}>
                  {creating ? 'Creating...' : 'Create'}
                </button>
              </form>
            </div>
          )}

          <div className="panel-body" style={{ padding: 0 }}>
            {loading ? (
              <div className="loading-inline"><div className="loading-spinner" /></div>
            ) : !data?.affiliates?.length ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                No affiliates yet. Create one to get started.
              </div>
            ) : (
              <table className="journey-table">
                <thead>
                  <tr>
                    <th>Affiliate</th>
                    <th>Slug</th>
                    <th>Visits</th>
                    <th>Visitors</th>
                    <th>Conversions</th>
                    <th>Revenue</th>
                    <th>Conv. Rate</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.affiliates.map((a) => {
                    const rate = a.unique_visitors > 0
                      ? ((a.conversions / a.unique_visitors) * 100).toFixed(1)
                      : '0.0';
                    return (
                      <tr
                        key={a.id}
                        style={{ cursor: 'pointer' }}
                        onClick={() => router.push(`/analytics/${siteId}/affiliates/${a.id}`)}
                      >
                        <td><span style={{ fontWeight: 600 }}>{a.name}</span></td>
                        <td><code style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{a.slug}</code></td>
                        <td>{a.visits.toLocaleString()}</td>
                        <td>{a.unique_visitors.toLocaleString()}</td>
                        <td>{a.conversions}</td>
                        <td style={{ fontWeight: 600 }}>${(a.revenue / 100).toFixed(2)}</td>
                        <td>{rate}%</td>
                        <td onClick={(e) => e.stopPropagation()} style={{ display: 'flex', gap: 4 }}>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => copyLink(a.slug)}
                            title="Copy referral link"
                          >
                            Copy Link
                          </button>
                          <button
                            className="btn btn-sm"
                            onClick={() => handleDelete(a.id)}
                            style={{ color: 'var(--danger, #e53e3e)' }}
                            title="Delete affiliate"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </DashboardLayout>
    </>
  );
}
