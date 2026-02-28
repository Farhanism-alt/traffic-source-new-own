import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import DashboardLayout from '@/components/layout/DashboardLayout';

export default function Sites() {
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showSnippet, setShowSnippet] = useState(null);
  const [snippetData, setSnippetData] = useState(null);
  const [showStripeSettings, setShowStripeSettings] = useState(null);
  const [stripeSecretKey, setStripeSecretKey] = useState('');
  const [stripeWebhookSecret, setStripeWebhookSecret] = useState('');
  const [stripeSaving, setStripeSaving] = useState(false);
  const [stripeMessage, setStripeMessage] = useState('');
  const [stripeError, setStripeError] = useState('');
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();

  const fetchSites = useCallback(async () => {
    try {
      const res = await fetch('/api/sites');
      if (res.ok) {
        const data = await res.json();
        setSites(data.sites);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSites();
  }, [fetchSites]);

  const handleCreate = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const res = await fetch('/api/sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, domain }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setShowModal(false);
      setName('');
      setDomain('');
      fetchSites();
      loadSnippet(data.site.id);
    } catch (err) {
      setError(err.message);
    }
  };

  const loadSnippet = async (siteId) => {
    const res = await fetch(`/api/sites/${siteId}/snippet`);
    if (res.ok) {
      const data = await res.json();
      setSnippetData(data);
      setShowSnippet(siteId);
    }
  };

  const loadStripeSettings = async (e, siteId) => {
    e.stopPropagation();
    const res = await fetch(`/api/sites/${siteId}`);
    if (res.ok) {
      const data = await res.json();
      setStripeSecretKey(data.site.stripe_secret_key || '');
      setStripeWebhookSecret(data.site.stripe_webhook_secret || '');
      setStripeMessage('');
      setStripeError('');
      setShowStripeSettings(siteId);
    }
  };

  const handleSaveStripe = async (e) => {
    e.preventDefault();
    setStripeSaving(true);
    setStripeMessage('');
    setStripeError('');
    try {
      const body = {};
      if (stripeSecretKey && !stripeSecretKey.startsWith('••••')) {
        body.stripe_secret_key = stripeSecretKey;
      }
      if (stripeWebhookSecret && !stripeWebhookSecret.startsWith('••••')) {
        body.stripe_webhook_secret = stripeWebhookSecret;
      }
      if (Object.keys(body).length === 0) {
        setStripeMessage('No changes to save');
        return;
      }
      const res = await fetch(`/api/sites/${showStripeSettings}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setStripeSecretKey(data.site.stripe_secret_key || '');
      setStripeWebhookSecret(data.site.stripe_webhook_secret || '');
      setStripeMessage('Stripe keys saved');
    } catch (err) {
      setStripeError(err.message);
    } finally {
      setStripeSaving(false);
    }
  };

  const handleDelete = async (e, siteId) => {
    e.stopPropagation();
    if (!confirm('Delete this site and all its data?')) return;
    await fetch(`/api/sites/${siteId}`, { method: 'DELETE' });
    fetchSites();
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <>
      <Head>
        <title>Sites - Traffic Source</title>
      </Head>
      <DashboardLayout>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 className="page-title" style={{ marginBottom: 0 }}>Your Sites</h2>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            Add Site
          </button>
        </div>

        {loading ? (
          <div className="loading-inline"><div className="loading-spinner" /></div>
        ) : sites.length === 0 ? (
          <div className="empty-state">
            <h3>No sites yet</h3>
            <p>Add your first site to start tracking analytics.</p>
            <button className="btn btn-primary" onClick={() => setShowModal(true)}>
              Add Site
            </button>
          </div>
        ) : (
          <div className="sites-grid">
            {sites.map((site) => (
              <div
                key={site.id}
                className="site-card"
                onClick={() => router.push(`/analytics/${site.id}`)}
              >
                <div className="site-card-header">
                  <div>
                    <div className="site-card-name">{site.name}</div>
                    <div className="site-card-domain">{site.domain}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        loadSnippet(site.id);
                      }}
                    >
                      Snippet
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={(e) => loadStripeSettings(e, site.id)}
                    >
                      Stripe
                    </button>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={(e) => handleDelete(e, site.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <div className="site-card-stats">
                  {site.views_7d || 0} views (last 7 days)
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Add Site Modal */}
        {showModal && (
          <div className="modal-overlay" onClick={() => setShowModal(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>Add Site</h2>
                <button onClick={() => setShowModal(false)}>x</button>
              </div>
              <form onSubmit={handleCreate}>
                <div className="modal-body">
                  {error && <div className="auth-error">{error}</div>}
                  <div className="form-group">
                    <label>Site Name</label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="My Website"
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Domain</label>
                    <input
                      type="text"
                      value={domain}
                      onChange={(e) => setDomain(e.target.value)}
                      placeholder="example.com"
                      required
                    />
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary">
                    Add Site
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Snippet Modal */}
        {showSnippet && snippetData && (
          <div className="modal-overlay" onClick={() => setShowSnippet(null)}>
            <div className="modal" style={{ maxWidth: 600 }} onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>Tracking Code - {snippetData.site.name}</h2>
                <button onClick={() => setShowSnippet(null)}>x</button>
              </div>
              <div className="modal-body">
                <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  Add this snippet to your website&apos;s HTML, before the closing &lt;/head&gt; tag:
                </p>
                <div className="snippet-block">
                  <button
                    className="copy-btn"
                    onClick={() => copyToClipboard(snippetData.trackingSnippet)}
                  >
                    Copy
                  </button>
                  {snippetData.trackingSnippet}
                </div>

                <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 16 }}>
                  For Stripe conversion tracking, add this to your checkout flow:
                </p>
                <div className="snippet-block">
                  <button
                    className="copy-btn"
                    onClick={() => copyToClipboard(snippetData.stripeSnippet)}
                  >
                    Copy
                  </button>
                  {snippetData.stripeSnippet}
                </div>

                <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 16 }}>
                  Stripe Webhook URL:
                </p>
                <div className="snippet-block">
                  <button
                    className="copy-btn"
                    onClick={() => copyToClipboard(snippetData.webhookUrl)}
                  >
                    Copy
                  </button>
                  {snippetData.webhookUrl}
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setShowSnippet(null)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
        {/* Stripe Settings Modal */}
        {showStripeSettings && (
          <div className="modal-overlay" onClick={() => setShowStripeSettings(null)}>
            <div className="modal" style={{ maxWidth: 500 }} onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>Stripe Settings</h2>
                <button onClick={() => setShowStripeSettings(null)}>x</button>
              </div>
              <form onSubmit={handleSaveStripe}>
                <div className="modal-body">
                  {stripeMessage && (
                    <div style={{ background: 'var(--success-light)', color: 'var(--success)', padding: '10px 14px', borderRadius: 'var(--radius)', fontSize: 13, marginBottom: 12 }}>
                      {stripeMessage}
                    </div>
                  )}
                  {stripeError && <div className="auth-error">{stripeError}</div>}
                  <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
                    Enter your Stripe API keys for this site. You can find these in your Stripe Dashboard under Developers &gt; API keys.
                  </p>
                  <div className="form-group">
                    <label>Stripe Secret Key</label>
                    <input
                      type="password"
                      value={stripeSecretKey}
                      onChange={(e) => setStripeSecretKey(e.target.value)}
                      placeholder="sk_live_..."
                    />
                  </div>
                  <div className="form-group">
                    <label>Webhook Secret</label>
                    <input
                      type="password"
                      value={stripeWebhookSecret}
                      onChange={(e) => setStripeWebhookSecret(e.target.value)}
                      placeholder="whsec_..."
                    />
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
                    Listen for <code>checkout.session.completed</code> and <code>charge.refunded</code> events.
                  </p>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setShowStripeSettings(null)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={stripeSaving}>
                    {stripeSaving ? 'Saving...' : 'Save Keys'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </DashboardLayout>
    </>
  );
}
