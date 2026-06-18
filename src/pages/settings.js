import { useState, useEffect } from 'react';
import Head from 'next/head';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useAuth } from '@/contexts/AuthContext';
import { useGoogleLogin } from '@react-oauth/google';

export default function Settings() {
  const { user } = useAuth();
  const [tab, setTab] = useState('billing');
  const [name, setName] = useState(user?.name || '');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleUpdateProfile = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setMessage('Profile updated');
  };

  return (
    <>
      <Head>
        <title>Settings - Traffic Source</title>
      </Head>
      <DashboardLayout>
        <h2 className="page-title">Account Settings</h2>
        <div style={{ maxWidth: 720 }}>
          <div className="panel" style={{ marginBottom: 24 }}>
            <div className="panel-header">
              <div className="panel-tabs">
                <button className={`panel-tab ${tab === 'billing' ? 'active' : ''}`} onClick={() => setTab('billing')}>Billing</button>
                <button className={`panel-tab ${tab === 'profile' ? 'active' : ''}`} onClick={() => setTab('profile')}>Profile</button>
                <button className={`panel-tab ${tab === 'integrations' ? 'active' : ''}`} onClick={() => setTab('integrations')}>Integrations</button>
                <button className={`panel-tab ${tab === 'backups' ? 'active' : ''}`} onClick={() => setTab('backups')}>Backups</button>
              </div>
            </div>
            <div className="panel-body" style={{ padding: 20 }}>
              {tab === 'billing' && <BillingSettings />}
              {tab === 'profile' && (
                <form onSubmit={handleUpdateProfile} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {message && (
                    <div style={{ background: 'var(--success-light)', color: 'var(--success)', padding: '10px 14px', borderRadius: 'var(--radius)', fontSize: 13 }}>
                      {message}
                    </div>
                  )}
                  {error && <div className="auth-error">{error}</div>}
                  <div className="form-group">
                    <label>Email</label>
                    <input type="email" value={user?.email || ''} disabled style={{ opacity: 0.6 }} />
                  </div>
                  <div className="form-group">
                    <label>Name</label>
                    <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                  <button type="submit" className="btn btn-primary" style={{ alignSelf: 'flex-start' }}>
                    Save Changes
                  </button>
                </form>
              )}
              {tab === 'integrations' && <GscIntegration />}
              {tab === 'backups' && <BackupSettings />}
            </div>
          </div>
        </div>
      </DashboardLayout>
    </>
  );
}

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

function GscIntegration() {
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const r = await fetch('/api/settings/integrations/gsc/token');
      if (r.ok) {
        const d = await r.json();
        setConnected(!!d.connected);
        setEmail(d.email || '');
      }
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const login = useGoogleLogin({
    scope: 'https://www.googleapis.com/auth/webmasters.readonly',
    onSuccess: async (tokenResponse) => {
      setSaving(true);
      setErr('');
      try {
        const r = await fetch('/api/settings/integrations/gsc/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            access_token: tokenResponse.access_token,
            expires_in: tokenResponse.expires_in || 3600,
          }),
        });
        const d = await r.json();
        if (r.ok) {
          setConnected(true);
          setEmail(d.email || '');
          setMsg('Google Search Console connected!');
        } else {
          setErr(d.error || 'Failed to save token');
        }
      } catch {
        setErr('Connection failed. Please try again.');
      }
      setSaving(false);
    },
    onError: () => setErr('Google sign-in was cancelled or failed. Please try again.'),
  });

  const disconnect = async () => {
    if (!confirm('Disconnect Google Search Console? Keyword data syncing will stop.')) return;
    await fetch('/api/settings/integrations/gsc/token', { method: 'DELETE' });
    setConnected(false);
    setEmail('');
    setMsg('Disconnected from Google Search Console.');
  };

  if (loading) return <div className="loading-inline"><div className="loading-spinner" /></div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h3 style={{ margin: 0, fontSize: 16 }}>Google Search Console</h3>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
          Connect your Google account to sync keyword and search performance data from Search Console.
        </p>
      </div>

      {msg && (
        <div style={{ background: 'var(--success-light)', color: 'var(--success)', padding: '10px 14px', borderRadius: 'var(--radius)', fontSize: 13 }}>
          {msg}
        </div>
      )}
      {err && <div className="auth-error">{err}</div>}

      {!connected ? (
        <button
          type="button"
          onClick={() => login()}
          disabled={saving}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 10,
            padding: '10px 20px', borderRadius: 8,
            border: '1px solid var(--border)', background: 'var(--bg)',
            cursor: saving ? 'not-allowed' : 'pointer',
            fontSize: 14, fontWeight: 500, color: 'var(--text)',
            alignSelf: 'flex-start', opacity: saving ? 0.7 : 1,
          }}
        >
          <GoogleLogo />
          {saving ? 'Connecting...' : 'Connect with Google'}
        </button>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'var(--success-light)', borderRadius: 'var(--radius)' }}>
          <span style={{ color: 'var(--success)', fontWeight: 600, fontSize: 13 }}>Connected</span>
          {email && <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{email}</span>}
          <button type="button" className="btn btn-secondary btn-sm" style={{ marginLeft: 'auto' }} onClick={disconnect}>
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

const PROVIDERS = [
  { value: 'aws', label: 'AWS S3', endpoint: 'https://s3.{region}.amazonaws.com', region: 'us-east-1' },
  { value: 'digitalocean', label: 'DigitalOcean Spaces', endpoint: 'https://{region}.digitaloceanspaces.com', region: 'nyc3' },
  { value: 'cloudflare', label: 'Cloudflare R2', endpoint: 'https://{account_id}.r2.cloudflarestorage.com', region: 'auto' },
  { value: 'backblaze', label: 'Backblaze B2', endpoint: 'https://s3.{region}.backblazeb2.com', region: 'us-west-004' },
  { value: 'wasabi', label: 'Wasabi', endpoint: 'https://s3.{region}.wasabisys.com', region: 'us-east-1' },
  { value: 'minio', label: 'MinIO (Self-hosted)', endpoint: 'http://localhost:9000', region: 'us-east-1' },
  { value: 'custom', label: 'Custom S3-compatible', endpoint: '', region: '' },
];

function BackupSettings() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState('aws');
  const [endpoint, setEndpoint] = useState('');
  const [region, setRegion] = useState('us-east-1');
  const [bucket, setBucket] = useState('');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [prefix, setPrefix] = useState('');
  const [schedule, setSchedule] = useState('daily');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [history, setHistory] = useState([]);
  const [remoteBackups, setRemoteBackups] = useState([]);
  const [loadingRemote, setLoadingRemote] = useState(false);
  const [restoring, setRestoring] = useState(null);
  const [showRestore, setShowRestore] = useState(false);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const [r1, r2] = await Promise.all([
        fetch('/api/settings/backup/config'),
        fetch('/api/settings/backup/history'),
      ]);
      if (r1.ok) {
        const data = await r1.json();
        setConfig(data.config);
        if (data.config.provider) setProvider(data.config.provider);
        if (data.config.endpoint) setEndpoint(data.config.endpoint);
        if (data.config.region) setRegion(data.config.region);
        if (data.config.bucket) setBucket(data.config.bucket);
        if (data.config.prefix) setPrefix(data.config.prefix);
        if (data.config.schedule) setSchedule(data.config.schedule);
      }
      if (r2.ok) {
        const data = await r2.json();
        setHistory(data.history || []);
      }
    } catch {}
    setLoading(false);
  };

  useEffect(() => { loadConfig(); }, []);

  const handleProviderChange = (val) => {
    setProvider(val);
    const p = PROVIDERS.find(pr => pr.value === val);
    if (p) {
      setEndpoint(p.endpoint);
      setRegion(p.region);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setErr('');
    setMsg('');
    try {
      const r = await fetch('/api/settings/backup/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint, region, bucket, access_key_id: accessKeyId, secret_access_key: secretAccessKey }),
      });
      const data = await r.json();
      if (r.ok) {
        setMsg('Connection successful!');
      } else {
        setErr(data.error || 'Connection failed');
      }
    } catch (e) {
      setErr('Connection failed: ' + e.message);
    }
    setTesting(false);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setErr('');
    setMsg('');
    try {
      const r = await fetch('/api/settings/backup/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint, region, bucket, access_key_id: accessKeyId, secret_access_key: secretAccessKey, prefix, provider, schedule }),
      });
      if (r.ok) {
        setMsg('Backup configuration saved.');
        setAccessKeyId('');
        setSecretAccessKey('');
        loadConfig();
      } else {
        const data = await r.json();
        setErr(data.error || 'Failed to save');
      }
    } catch (e) {
      setErr(e.message);
    }
    setSaving(false);
  };

  const handleBackupNow = async () => {
    setBackingUp(true);
    setErr('');
    setMsg('');
    try {
      const r = await fetch('/api/settings/backup/run', { method: 'POST' });
      const data = await r.json();
      if (r.ok) {
        setMsg(`Backup completed: ${data.filename} (${formatBytes(data.sizeBytes)})`);
        loadConfig();
      } else {
        setErr(data.error || 'Backup failed');
      }
    } catch (e) {
      setErr('Backup failed: ' + e.message);
    }
    setBackingUp(false);
  };

  const handleRemove = async () => {
    if (!confirm('Remove backup configuration?')) return;
    await fetch('/api/settings/backup/config', { method: 'DELETE' });
    setConfig(null);
    setEndpoint('');
    setRegion('us-east-1');
    setBucket('');
    setAccessKeyId('');
    setSecretAccessKey('');
    setPrefix('');
    setProvider('aws');
    setMsg('Backup configuration removed.');
  };

  const handleLoadRemoteBackups = async () => {
    setLoadingRemote(true);
    setErr('');
    setShowRestore(true);
    try {
      const r = await fetch('/api/settings/backup/restore');
      const data = await r.json();
      if (r.ok) {
        setRemoteBackups(data.backups || []);
      } else {
        setErr(data.error || 'Failed to list backups');
      }
    } catch (e) {
      setErr('Failed to list backups: ' + e.message);
    }
    setLoadingRemote(false);
  };

  const handleRestore = async (key, filename) => {
    if (!confirm(`Restore database from "${filename}"?\n\nThis will replace your current database. A safety backup will be created automatically before restoring.`)) return;
    setRestoring(key);
    setErr('');
    setMsg('');
    try {
      const r = await fetch('/api/settings/backup/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      const data = await r.json();
      if (r.ok) {
        setMsg(`Database restored from "${data.restored}". Safety backup saved as "${data.safetyBackup}". Reloading...`);
        setTimeout(() => window.location.reload(), 2000);
      } else {
        setErr(data.error || 'Restore failed');
      }
    } catch (e) {
      setErr('Restore failed: ' + e.message);
    }
    setRestoring(null);
  };

  if (loading) return <div className="loading-inline"><div className="loading-spinner" /></div>;

  const isConfigured = config && config.endpoint && config.bucket;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h3 style={{ margin: 0, fontSize: 16 }}>Database Backup</h3>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
          Back up your SQLite database to any S3-compatible storage — AWS S3, DigitalOcean Spaces, Cloudflare R2, Backblaze B2, and more.
        </p>
      </div>

      {msg && <div style={{ background: 'var(--success-light)', color: 'var(--success)', padding: '10px 14px', borderRadius: 'var(--radius)', fontSize: 13 }}>{msg}</div>}
      {err && <div className="auth-error">{err}</div>}

      {isConfigured && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, background: 'var(--success-light)', borderRadius: 'var(--radius)', fontSize: 13 }}>
          <span style={{ color: 'var(--success)', fontWeight: 600 }}>Configured</span>
          <span style={{ color: 'var(--text-muted)' }}>{config.bucket} &middot; {config.provider || 'custom'}</span>
          <button type="button" className="btn btn-secondary btn-sm" style={{ marginLeft: 'auto' }} onClick={handleRemove}>Remove</button>
        </div>
      )}

      <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="form-group">
          <label>Provider</label>
          <select value={provider} onChange={(e) => handleProviderChange(e.target.value)} style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg)', color: 'var(--text)', fontSize: 13 }}>
            {PROVIDERS.map(p => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label>Endpoint URL</label>
          <input type="text" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://s3.us-east-1.amazonaws.com" />
          {provider !== 'custom' && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              Replace placeholder values (e.g. {'{region}'}, {'{account_id}'}) with your actual values.
            </span>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="form-group">
            <label>Region</label>
            <input type="text" value={region} onChange={(e) => setRegion(e.target.value)} placeholder="us-east-1" />
          </div>
          <div className="form-group">
            <label>Bucket Name</label>
            <input type="text" value={bucket} onChange={(e) => setBucket(e.target.value)} placeholder="my-backups" />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="form-group">
            <label>Access Key ID</label>
            <input type="text" value={accessKeyId} onChange={(e) => setAccessKeyId(e.target.value)} placeholder={isConfigured ? config.access_key_id : 'AKIA...'} />
          </div>
          <div className="form-group">
            <label>Secret Access Key</label>
            <input type="password" value={secretAccessKey} onChange={(e) => setSecretAccessKey(e.target.value)} placeholder={isConfigured ? '****' : 'Your secret key'} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="form-group">
            <label>Path Prefix <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span></label>
            <input type="text" value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="backups/trafficsource" />
          </div>
          <div className="form-group">
            <label>Auto Backup Schedule</label>
            <select value={schedule} onChange={(e) => setSchedule(e.target.value)} style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg)', color: 'var(--text)', fontSize: 13 }}>
              <option value="12h">Every 12 hours</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button type="submit" className="btn btn-primary" disabled={saving || !endpoint || !bucket || !accessKeyId || !secretAccessKey}>
            {saving ? 'Saving...' : isConfigured ? 'Update Configuration' : 'Save Configuration'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={handleTestConnection} disabled={testing || !endpoint || !bucket || !accessKeyId || !secretAccessKey}>
            {testing ? 'Testing...' : 'Test Connection'}
          </button>
        </div>
      </form>

      {isConfigured && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Manual Backup</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>Create a snapshot and upload it now.</div>
            </div>
            <button type="button" className="btn btn-primary" onClick={handleBackupNow} disabled={backingUp}>
              {backingUp ? 'Backing up...' : 'Backup Now'}
            </button>
          </div>

          <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 12px', background: 'var(--bg)', borderRadius: 6, border: '1px solid var(--border)' }}>
            Auto backups run on the schedule you selected above. No external cron needed.
          </div>
        </div>
      )}

      {isConfigured && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Restore Database</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>Rollback to a previous backup. A safety backup is created automatically before restoring.</div>
            </div>
            <button type="button" className="btn btn-secondary" onClick={handleLoadRemoteBackups} disabled={loadingRemote}>
              {loadingRemote ? 'Loading...' : showRestore ? 'Refresh List' : 'Show Backups'}
            </button>
          </div>

          {showRestore && (
            <>
              {remoteBackups.length === 0 && !loadingRemote && (
                <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: 12, textAlign: 'center' }}>No backups found in storage.</div>
              )}
              {remoteBackups.length > 0 && (
                <table className="journey-table">
                  <thead>
                    <tr>
                      <th>Filename</th>
                      <th>Size</th>
                      <th>Date</th>
                      <th style={{ textAlign: 'right' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {remoteBackups.map((b) => (
                      <tr key={b.key}>
                        <td><span style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}>{b.filename}</span></td>
                        <td>{formatBytes(b.size)}</td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{new Date(b.lastModified).toLocaleString()}</td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleRestore(b.key, b.filename)}
                            disabled={restoring !== null}
                            style={{ fontSize: 11 }}
                          >
                            {restoring === b.key ? 'Restoring...' : 'Restore'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      )}

      {history.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Backup History</div>
          <table className="journey-table">
            <thead>
              <tr>
                <th>Filename</th>
                <th>Size</th>
                <th>Status</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td><span style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}>{h.filename || '—'}</span></td>
                  <td>{h.size_bytes ? formatBytes(h.size_bytes) : '—'}</td>
                  <td>
                    <span style={{
                      fontSize: 11,
                      fontWeight: 600,
                      padding: '2px 8px',
                      borderRadius: 4,
                      background: h.status === 'completed' ? 'var(--success-light)' : h.status === 'failed' ? 'rgba(239,68,68,0.1)' : 'rgba(234,179,8,0.1)',
                      color: h.status === 'completed' ? 'var(--success)' : h.status === 'failed' ? '#ef4444' : '#eab308',
                    }}>
                      {h.status}
                    </span>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{h.completed_at || h.started_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const PLAN_FEATURES = {
  free: ['1 site', 'Basic analytics', 'Traffic sources', 'Pages & countries', 'Real-time visitors'],
  pro: ['Unlimited sites', 'Everything in Free', 'Custom events & funnels', 'Date comparison', 'Chart annotations', 'New vs returning visitors', 'Outbound link tracking', 'Priority support'],
  business: ['Everything in Pro', 'Team members', 'White-label reports', 'API access', 'Dedicated support'],
};

function BillingSettings() {
  const [billing, setBilling] = useState(null);
  const [licenseKey, setLicenseKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = async () => {
    const r = await fetch('/api/billing');
    if (r.ok) setBilling(await r.json());
  };

  useEffect(() => { load(); }, []);

  const activate = async (e) => {
    e.preventDefault();
    if (!licenseKey.trim()) return;
    setSaving(true); setErr(''); setMsg('');
    const r = await fetch('/api/billing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseKey }),
    });
    const d = await r.json();
    if (r.ok) {
      setMsg(`${d.planName} plan activated successfully!`);
      setLicenseKey('');
      setBilling(d);
    } else {
      setErr(d.error || 'Activation failed');
    }
    setSaving(false);
  };

  const deactivate = async () => {
    if (!confirm('Downgrade to Free plan?')) return;
    setSaving(true);
    const r = await fetch('/api/billing', { method: 'DELETE' });
    if (r.ok) {
      setBilling(await r.json());
      setMsg('Downgraded to Free plan.');
    }
    setSaving(false);
  };

  if (!billing) return <div className="loading-inline"><div className="loading-spinner" /></div>;

  const isPaid = billing.plan !== 'free';
  const features = PLAN_FEATURES[billing.plan] || PLAN_FEATURES.free;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <h3 style={{ margin: 0, fontSize: 16 }}>Subscription Plan</h3>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
          Enter your license key to activate your plan.
        </p>
      </div>

      {msg && <div style={{ background: 'var(--success-light)', color: 'var(--success)', padding: '10px 14px', borderRadius: 'var(--radius)', fontSize: 13 }}>{msg}</div>}
      {err && <div className="auth-error">{err}</div>}

      <div style={{
        display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px',
        background: isPaid ? 'rgba(59,130,246,0.05)' : 'var(--bg)',
        border: `1px solid ${isPaid ? '#3b82f6' : 'var(--border)'}`,
        borderRadius: 'var(--radius)',
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{
              fontSize: 13, fontWeight: 700, padding: '2px 10px', borderRadius: 20,
              background: isPaid ? '#3b82f6' : 'var(--bg-elevated)',
              color: isPaid ? '#fff' : 'var(--text-muted)',
            }}>
              {billing.planName}
            </span>
            {isPaid && billing.price > 0 && (
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>${billing.price}/month</span>
            )}
          </div>
          {billing.activatedAt && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Activated {new Date(billing.activatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
            </div>
          )}
        </div>
        {isPaid && (
          <button className="btn btn-secondary btn-sm" onClick={deactivate} disabled={saving}>
            Downgrade
          </button>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {isPaid ? 'Your plan includes' : 'Free plan includes'}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {features.map((f) => (
            <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <span style={{ color: '#3b82f6', fontWeight: 700, fontSize: 15 }}>✓</span>
              {f}
            </div>
          ))}
        </div>
      </div>

      <form onSubmit={activate} style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
          {isPaid ? 'Update license key' : 'Activate your license'}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Enter the license key from your purchase email (starts with <code style={{ fontSize: 12 }}>PRO-</code> or <code style={{ fontSize: 12 }}>BIZ-</code>).
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            value={licenseKey}
            onChange={(e) => setLicenseKey(e.target.value)}
            placeholder="PRO-XXXX-XXXX-XXXX"
            style={{ flex: 1, padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg)', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--font-mono)' }}
          />
          <button type="submit" className="btn btn-primary" disabled={saving || !licenseKey.trim()}>
            {saving ? 'Activating…' : 'Activate'}
          </button>
        </div>
      </form>
    </div>
  );
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
