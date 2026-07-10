import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import DashboardLayout from '@/components/layout/DashboardLayout';
import ConversionJourneyTable from '@/components/ui/ConversionJourneyTable';
import FlowView from '@/components/ui/FlowView';
import { useDateRange } from '@/contexts/DateRangeContext';

export default function Conversions() {
  const router = useRouter();
  const { siteId } = router.query;
  const { getParams } = useDateRange();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [activeTab, setActiveTab] = useState('journey');

  const fetchData = useCallback(async () => {
    if (!siteId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        ...getParams(),
        page: String(page),
        limit: '25',
        ...(search ? { search } : {}),
      });
      const res = await fetch(`/api/analytics/${siteId}/conversions?${params}`);
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, [siteId, page, search, JSON.stringify(getParams())]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Debounced search
  const [searchInput, setSearchInput] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const exportCSV = useCallback(async () => {
    if (!siteId || exporting) return;
    setExporting(true);
    try {
      const params = new URLSearchParams({ ...getParams(), limit: '2000' });
      const res = await fetch(`/api/analytics/${siteId}/conversions?${params}`);
      if (!res.ok) return;
      const json = await res.json();
      const conversions = json.conversions || [];

      const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const fmt = (seconds) => {
        if (seconds == null) return '';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
      };

      const rows = [];
      rows.push([
        'Email',
        'Amount',
        'Currency',
        'Source',
        'UTM Medium',
        'UTM Campaign',
        'Country',
        'City',
        'Browser',
        'OS',
        'Device',
        'Entry Page',
        'Exit Page',
        'Pages Visited',
        'Session Duration',
        'Time to Convert (first visit to payment)',
        'Completed At',
        'Journey (pages in order)',
      ]);

      for (const c of conversions) {
        const amount = c.currency === 'eur'
          ? `€${((c.amount || 0) / 100).toFixed(2)}`
          : `$${((c.amount || 0) / 100).toFixed(2)}`;
        const source = c.utm_source || c.referrer_domain || 'Direct';
        const journeyStr = (c.journey || []).map(j => j.pathname).join(' > ');
        rows.push([
          c.stripe_customer_email || '',
          amount,
          (c.currency || '').toUpperCase(),
          source,
          c.utm_medium || '',
          c.utm_campaign || '',
          c.country || '',
          c.city || '',
          c.browser || '',
          c.os || '',
          c.device_type || '',
          c.entry_page || '',
          c.exit_page || '',
          c.page_count || 0,
          fmt(c.session_duration),
          fmt(c.timeToComplete),
          c.created_at ? new Date(c.created_at).toLocaleString() : '',
          journeyStr,
        ]);
      }

      const csv = rows.map(r => r.map(v => esc(v)).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const domain = data?.site?.domain || data?.site?.name || siteId;
      const date = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `${domain}-conversions-${date}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }, [siteId, exporting, getParams, data]);

  return (
    <>
      <Head>
        <title>Conversions - SAC MAC</title>
      </Head>
      <DashboardLayout siteId={siteId} siteName={data?.site?.name} siteDomain={data?.site?.domain}>
        <div className="page-nav">
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => router.push(`/analytics/${siteId}`)}
          >
            &larr; Dashboard
          </button>
        </div>

        <div className="panel" style={{ marginBottom: 20 }}>
          <div className="panel-header">
            <div className="panel-tabs">
              <button
                className={`panel-tab ${activeTab === 'journey' ? 'active' : ''}`}
                onClick={() => setActiveTab('journey')}
              >
                Journey for payment
              </button>
              <button
                className={`panel-tab ${activeTab === 'funnel' ? 'active' : ''}`}
                onClick={() => setActiveTab('funnel')}
              >
                Funnel
              </button>
            </div>

            {activeTab === 'journey' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div className="search-input-wrap">
                  <input
                    type="text"
                    placeholder="Search"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    className="search-input"
                  />
                </div>
                <button
                  onClick={exportCSV}
                  disabled={exporting}
                  title="Export all conversions as CSV"
                  style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 10px', fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', cursor: exporting ? 'not-allowed' : 'pointer', opacity: exporting ? 0.6 : 1, display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                  {exporting ? 'Exporting…' : 'Export CSV'}
                </button>
              </div>
            )}
          </div>

          <div className="panel-body" style={{ padding: 0 }}>
            {activeTab === 'journey' ? (
              loading ? (
                <div className="loading-inline"><div className="loading-spinner" /></div>
              ) : (
                <ConversionJourneyTable
                  conversions={data?.conversions || []}
                  siteId={siteId}
                />
              )
            ) : (
              <FlowView siteId={siteId} />
            )}
          </div>

          {activeTab === 'journey' && data?.pagination && data.pagination.totalPages > 1 && (
            <div className="pagination">
              <button
                className="btn btn-secondary btn-sm"
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
              >
                Previous
              </button>
              <span className="pagination-info">
                Page {data.pagination.page} of {data.pagination.totalPages}
              </span>
              <button
                className="btn btn-secondary btn-sm"
                disabled={page >= data.pagination.totalPages}
                onClick={() => setPage(p => p + 1)}
              >
                Next
              </button>
            </div>
          )}
        </div>
      </DashboardLayout>
    </>
  );
}
