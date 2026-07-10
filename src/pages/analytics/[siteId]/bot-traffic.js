import { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useDateRange } from '@/contexts/DateRangeContext';

const CATEGORY_LABELS = { all: 'All', answers: 'AI Answers', indexing: 'Indexing', training: 'Training', other: 'Other' };

const PROVIDER_DOMAINS = {
  OpenAI: 'openai.com', Anthropic: 'anthropic.com', Google: 'google.com',
  Microsoft: 'microsoft.com', Perplexity: 'perplexity.ai', Meta: 'meta.com',
  xAI: 'x.ai', Mistral: 'mistral.ai', ByteDance: 'bytedance.com',
  Amazon: 'amazon.com', DuckDuckGo: 'duckduckgo.com', Apple: 'apple.com',
  Yandex: 'yandex.com', Baidu: 'baidu.com', Alibaba: 'alibaba.com',
  'Moonshot AI': 'moonshot.cn', Cohere: 'cohere.com', 'Common Crawl': 'commoncrawl.org',
  Huawei: 'huawei.com', Semrush: 'semrush.com', Ahrefs: 'ahrefs.com',
  Majestic: 'majestic.com', Sogou: 'sogou.com', Webhose: 'webz.io',
  Diffbot: 'diffbot.com', 'Internet Archive': 'archive.org',
};

function ProviderDot({ provider }) {
  const domain = PROVIDER_DOMAINS[provider];
  const initials = (provider || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const [failed, setFailed] = useState(false);
  return (
    <div className="bt-provider-dot">
      {domain && !failed ? (
        <img
          src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
          alt=""
          width={20}
          height={20}
          onError={() => setFailed(true)}
        />
      ) : (
        <span>{initials}</span>
      )}
    </div>
  );
}

function CategoryBadge({ category }) {
  const map = {
    answers:  { bg: 'rgba(99,102,241,0.15)',  text: '#818cf8' },
    indexing: { bg: 'rgba(16,163,127,0.15)', text: '#34d399' },
    training: { bg: 'rgba(245,158,11,0.15)', text: '#fbbf24' },
    other:    { bg: 'rgba(107,114,128,0.15)',text: '#9ca3af' },
  };
  const s = map[category] || map.other;
  return (
    <span className="bt-cat-badge" style={{ background: s.bg, color: s.text }}>
      {CATEGORY_LABELS[category] || category}
    </span>
  );
}

function fmtTime(ts) {
  if (!ts) return '—';
  const diff = (Date.now() - new Date(ts)) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function BotTraffic() {
  const router = useRouter();
  const { siteId } = router.query;
  const { period, customRange } = useDateRange();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState('all');
  const [activeTab, setActiveTab] = useState('dashboard');

  const fetchData = useCallback(async () => {
    if (!siteId) return;
    setLoading(true);
    try {
      const params = customRange
        ? `from=${customRange.from}&to=${customRange.to}`
        : `period=${period || '30d'}`;
      const res = await fetch(`/api/analytics/${siteId}/bot-traffic?${params}&category=${activeCategory}`);
      if (res.ok) setData(await res.json());
    } catch {}
    setLoading(false);
  }, [siteId, period, customRange, activeCategory]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://your-app-url.com';
  const site = data?.site;
  const stats = data?.stats || {};

  const snippet = `// middleware.js
import { NextResponse } from 'next/server';

const BOTS = [
  'ChatGPT-User', 'Claude-User', 'Perplexity-User', 'Googlebot', 'Bingbot',
  'GPTBot', 'ClaudeBot', 'Bytespider', 'PerplexityBot', 'DuckAssistBot',
  'DuckDuckBot', 'xAI-SearchBot', 'Google-Agent', 'MistralAI-User', 'Copilot',
  'Amzn-User', 'meta-externalfetcher', 'Kimi-User', 'Qwen-User', 'YandexBot',
  'Baiduspider', 'Applebot', 'CCBot', 'cohere-ai', 'facebookexternalhit',
  'Grok', 'GrokBot', 'meta-externalads', 'FacebookBot', 'AhrefsBot',
];

export function middleware(request) {
  const ua = request.headers.get('user-agent') || '';
  if (BOTS.some(b => ua.includes(b))) {
    fetch('${origin}/api/bot-track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        siteId: '${siteId || 'YOUR_SITE_ID'}',
        pathname: new URL(request.url).pathname,
        userAgent: ua,
      }),
    }).catch(() => {});
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};`;

  return (
    <>
      <Head>
        <title>Bot Traffic – {site?.name || 'SAC MAC'}</title>
      </Head>
      <DashboardLayout siteId={siteId} siteName={site?.name} siteDomain={site?.domain}>

        <div className="bt-header">
          <div className="bt-header-info">
            <h2 className="bt-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              Bot Traffic
            </h2>
            <p className="bt-subtitle">AI assistants, search engines &amp; training crawlers visiting your site</p>
          </div>
          <button
            className={`bt-tab-btn ${activeTab === 'setup' ? 'active' : ''}`}
            onClick={() => setActiveTab(t => t === 'setup' ? 'dashboard' : 'setup')}
          >
            {activeTab === 'setup' ? '← Dashboard' : '⚙ Setup'}
          </button>
        </div>

        {activeTab === 'setup' ? (
          <SetupPanel snippet={snippet} />
        ) : (
          <>
            {/* Stats strip */}
            <div className="bt-stats-strip">
              {[
                { label: 'Total Requests', value: stats.total, color: 'var(--text-heading)' },
                { label: 'AI Answers', value: stats.answers, color: '#818cf8' },
                { label: 'Indexing', value: stats.indexing, color: '#34d399' },
                { label: 'Training', value: stats.training, color: '#fbbf24' },
                { label: 'Other', value: stats.other, color: '#9ca3af' },
                { label: '404 Signals', value: stats.notFound, color: '#ef4444' },
              ].map(s => (
                <div key={s.label} className="bt-stat-card">
                  <div className="bt-stat-value" style={{ color: s.color }}>{(s.value || 0).toLocaleString()}</div>
                  <div className="bt-stat-label">{s.label}</div>
                </div>
              ))}
            </div>

            {/* Category filter */}
            <div className="bt-filter-row">
              {Object.entries(CATEGORY_LABELS).map(([cat, label]) => (
                <button
                  key={cat}
                  className={`bt-filter-btn ${activeCategory === cat ? 'active' : ''}`}
                  onClick={() => setActiveCategory(cat)}
                >
                  {label}
                  {cat !== 'all' && !!stats[cat] && (
                    <span className="bt-filter-count">{stats[cat]}</span>
                  )}
                </button>
              ))}
            </div>

            {loading ? (
              <div className="loading-inline"><div className="loading-spinner" /></div>
            ) : !stats.total ? (
              <EmptyState onSetup={() => setActiveTab('setup')} />
            ) : (
              <>
                {/* Provider cards */}
                {(data?.providers || []).length > 0 && (
                  <div className="panel" style={{ marginBottom: 20 }}>
                    <div className="panel-header">
                      <div className="panel-tabs"><button className="panel-tab active">Crawlers Detected</button></div>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{(data?.providers || []).length} providers</span>
                    </div>
                    <div className="panel-body">
                      <div className="bt-providers-grid">
                        {(data?.providers || []).map(p => (
                          <div key={p.provider} className="bt-provider-card">
                            <ProviderDot provider={p.provider} />
                            <div className="bt-provider-info">
                              <div className="bt-provider-name">{p.provider}</div>
                              <div className="bt-provider-tags">
                                {[...new Set(p.crawlers.map(c => c.category))].map(cat => (
                                  <CategoryBadge key={cat} category={cat} />
                                ))}
                              </div>
                              <div className="bt-provider-tokens">
                                {p.crawlers.slice(0, 3).map(c => (
                                  <span key={c.token} className="bt-token-chip">{c.token}</span>
                                ))}
                                {p.crawlers.length > 3 && (
                                  <span className="bt-token-chip">+{p.crawlers.length - 3} more</span>
                                )}
                              </div>
                            </div>
                            <div className="bt-provider-count">
                              <div className="bt-provider-count-num">{p.count.toLocaleString()}</div>
                              <div className="bt-provider-count-label">requests</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Top pages + 404 signals */}
                <div className="grid-2" style={{ marginBottom: 20 }}>
                  <div className="panel">
                    <div className="panel-header">
                      <div className="panel-tabs"><button className="panel-tab active">Top Pages Crawled</button></div>
                    </div>
                    <div className="panel-body" style={{ padding: 0 }}>
                      {!(data?.topPages?.length) ? (
                        <div style={{ padding: '20px 16px', fontSize: 13, color: 'var(--text-muted)' }}>No pages recorded yet.</div>
                      ) : (
                        <table className="journey-table">
                          <thead><tr><th>Page</th><th>Requests</th></tr></thead>
                          <tbody>
                            {(data.topPages).map((p, i) => (
                              <tr key={i}>
                                <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{p.pathname}</td>
                                <td style={{ fontWeight: 600 }}>{Number(p.count).toLocaleString()}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>

                  <div className="panel">
                    <div className="panel-header">
                      <div className="panel-tabs"><button className="panel-tab active">404 Signals</button></div>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Pages bots expected to exist</span>
                    </div>
                    <div className="panel-body" style={{ padding: 0 }}>
                      {!(data?.notFoundPages?.length) ? (
                        <div style={{ padding: '20px 16px', fontSize: 13, color: 'var(--text-muted)' }}>No 404s detected from bots.</div>
                      ) : (
                        <table className="journey-table">
                          <thead><tr><th>Missing Page</th><th>Requests</th></tr></thead>
                          <tbody>
                            {(data.notFoundPages).map((p, i) => (
                              <tr key={i}>
                                <td style={{ fontFamily: 'monospace', fontSize: 12, color: '#ef4444' }}>{p.pathname}</td>
                                <td style={{ fontWeight: 600, color: '#ef4444' }}>{Number(p.count).toLocaleString()}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                </div>

                {/* Recent activity */}
                <div className="panel" style={{ marginBottom: 20 }}>
                  <div className="panel-header">
                    <div className="panel-tabs"><button className="panel-tab active">Recent Bot Activity</button></div>
                  </div>
                  <div className="panel-body" style={{ padding: 0 }}>
                    <table className="journey-table">
                      <thead>
                        <tr>
                          <th>Provider</th>
                          <th>Type</th>
                          <th>Bot</th>
                          <th>Page</th>
                          <th>Status</th>
                          <th>When</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(data?.recentVisits || []).map((v, i) => (
                          <tr key={i}>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <ProviderDot provider={v.provider || 'Unknown'} />
                                <span style={{ fontWeight: 600, fontSize: 13 }}>{v.provider || 'Unknown'}</span>
                              </div>
                            </td>
                            <td><CategoryBadge category={v.category} /></td>
                            <td style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)' }}>{v.crawler_token}</td>
                            <td style={{ fontFamily: 'monospace', fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.pathname}</td>
                            <td>
                              <span style={{ fontSize: 12, fontWeight: 600, color: v.status_code === 404 ? '#ef4444' : v.status_code ? '#22c55e' : 'var(--text-muted)' }}>
                                {v.status_code || '—'}
                              </span>
                            </td>
                            <td style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{fmtTime(v.created_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </DashboardLayout>
    </>
  );
}

function EmptyState({ onSetup }) {
  return (
    <div className="bt-empty">
      <div className="bt-empty-icon">🤖</div>
      <h3 className="bt-empty-title">No bot traffic recorded yet</h3>
      <p className="bt-empty-desc">
        Add server-side tracking to your site to see AI assistants, search engines, and training crawlers.
        Bot traffic runs server-side — bots skip browser JavaScript.
      </p>
      <button className="btn btn-primary" onClick={onSetup}>Set up bot tracking →</button>
    </div>
  );
}

function SetupPanel({ snippet }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(snippet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  return (
    <div className="panel" style={{ marginBottom: 20 }}>
      <div className="panel-header">
        <div className="panel-tabs"><button className="panel-tab active">Setup Instructions</button></div>
      </div>
      <div className="panel-body">
        <div className="bt-setup">
          <p className="bt-setup-intro">
            Paste this snippet into your website&rsquo;s <code>middleware.js</code> (or <code>middleware.ts</code>) file.
            It detects known bot user agents and sends a non-blocking event to SAC MAC.
            Your site response time is unaffected — the tracking call runs in the background.
          </p>

          <div className="bt-setup-steps">
            <div className="bt-setup-step">
              <div className="bt-setup-step-num">1</div>
              <div>Create or open <code>middleware.js</code> in the root of your Next.js project (same level as <code>package.json</code>).</div>
            </div>
            <div className="bt-setup-step">
              <div className="bt-setup-step-num">2</div>
              <div>Paste the code below. Your Site ID is already filled in.</div>
            </div>
            <div className="bt-setup-step">
              <div className="bt-setup-step-num">3</div>
              <div>Deploy. Bot visits will appear on this page within minutes of the first crawl.</div>
            </div>
          </div>

          <div className="bt-code-wrap">
            <div className="bt-code-header">
              <span>middleware.js</span>
              <button className="bt-copy-btn" onClick={copy}>{copied ? '✓ Copied!' : 'Copy'}</button>
            </div>
            <pre className="bt-code-block">{snippet}</pre>
          </div>

          <div className="bt-setup-note">
            <strong>What gets tracked:</strong> Only requests from known AI assistants, search engines, and training crawlers.
            Normal human visitors are never sent to <code>/api/bot-track</code>.
            Passing <code>statusCode</code> from your response (when available) enables 404 signal detection.
          </div>
        </div>
      </div>
    </div>
  );
}
