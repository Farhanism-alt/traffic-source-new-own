import { useState, useEffect } from 'react';
import VisitorAvatar from './VisitorAvatar';
import CountryFlag from './CountryFlag';
import TechIcon from './TechIcon';
import ChannelIcon from './ChannelIcon';
import { getCountryName } from '@/lib/formatters';

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '0s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatTimestamp(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return (
    d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }) +
    ' at ' +
    d.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
  );
}

function formatTimeOnly(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatDateHeader(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function PersonFootprintDrawer({ siteId, email, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeView, setActiveView] = useState('timeline'); // 'timeline' | 'sessions'

  useEffect(() => {
    if (!email) {
      setData(null);
      return;
    }
    setLoading(true);
    fetch(`/api/analytics/${siteId}/people/${encodeURIComponent(email)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d))
      .finally(() => setLoading(false));
  }, [email, siteId]);

  useEffect(() => {
    if (!email) return;
    const handleEsc = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEsc);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleEsc);
      document.body.style.overflow = '';
    };
  }, [email, onClose]);

  const copyEmail = () => {
    if (!email) return;
    navigator.clipboard.writeText(email);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!email) return null;

  const person = data?.person;
  const timeline = data?.timeline || [];
  const sessions = data?.sessions || [];

  // Group timeline entries by Date
  const groupedTimeline = [];
  let currentDate = null;
  let currentGroup = [];

  for (const item of timeline) {
    const itemDate = new Date(item.timestamp).toISOString().slice(0, 10);
    if (itemDate !== currentDate) {
      if (currentGroup.length > 0) {
        groupedTimeline.push({ date: currentDate, items: currentGroup });
      }
      currentDate = itemDate;
      currentGroup = [item];
    } else {
      currentGroup.push(item);
    }
  }
  if (currentGroup.length > 0) {
    groupedTimeline.push({ date: currentDate, items: currentGroup });
  }

  return (
    <>
      <div className={`drawer-overlay ${email ? 'open' : ''}`} onClick={onClose} />
      <div className={`drawer ${email ? 'open' : ''}`} style={{ maxWidth: 640 }}>
        {/* Header */}
        <div className="drawer-header" style={{ paddingBottom: 16 }}>
          <div className="drawer-header-left" style={{ gap: 14 }}>
            <VisitorAvatar visitorId={person?.visitorId || email} size={44} />
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="drawer-title" style={{ fontSize: 16, fontWeight: 600 }}>
                  {email}
                </span>
                <button
                  onClick={copyEmail}
                  title="Copy Email"
                  style={{
                    background: 'none',
                    border: 'none',
                    color: copied ? '#22c55e' : 'var(--text-muted)',
                    cursor: 'pointer',
                    fontSize: 12,
                    padding: '2px 4px',
                  }}
                >
                  {copied ? '✓ Copied' : 'Copy'}
                </button>
              </div>
              <div className="drawer-subtitle" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                {person?.country && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <CountryFlag code={person.country} />
                    {person.city ? `${person.city}, ` : ''}{getCountryName(person.country)}
                  </span>
                )}
                {person?.deviceType && (
                  <>
                    <span>•</span>
                    <span style={{ textTransform: 'capitalize' }}>{person.deviceType}</span>
                  </>
                )}
                {person?.browser && (
                  <>
                    <span>•</span>
                    <span>{person.browser}</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <button className="drawer-close" onClick={onClose}>
            &times;
          </button>
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
            <div className="loading-spinner" />
          </div>
        ) : !data ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
            No trace data found for this user.
          </div>
        ) : (
          <div className="drawer-body" style={{ padding: '0 24px 32px' }}>
            {/* Quick Metrics Bar */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: 10,
                margin: '16px 0 20px',
                padding: '12px 14px',
                background: 'var(--bg-card, #161618)',
                border: '1px solid var(--border-color, #27272a)',
                borderRadius: 8,
              }}
            >
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  First Seen
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>
                  {person?.firstSeen ? new Date(person.firstSeen).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Sessions
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>
                  {person?.totalSessions || 0}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Pageviews
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>
                  {person?.totalPageViews || 0}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Acquisition
                </div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    marginTop: 2,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={person?.acquisitionSource}
                >
                  <ChannelIcon channel={person?.acquisitionSource} size={14} />
                  <span>{person?.acquisitionSource || 'Direct'}</span>
                </div>
              </div>
            </div>

            {/* Campaign info if present */}
            {person?.acquisitionCampaign && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  background: 'rgba(99,102,241,0.08)',
                  border: '1px solid rgba(99,102,241,0.2)',
                  borderRadius: 6,
                  marginBottom: 16,
                  fontSize: 12,
                }}
              >
                <span style={{ color: '#6366f1', fontWeight: 600 }}>Campaign:</span>
                <span style={{ color: 'var(--text-primary)' }}>{person.acquisitionCampaign}</span>
              </div>
            )}

            {/* View Selector */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                Activity Footprint
              </div>
              <div style={{ display: 'flex', gap: 4, background: 'var(--bg-secondary, #1e1e20)', padding: 2, borderRadius: 6 }}>
                <button
                  onClick={() => setActiveView('timeline')}
                  style={{
                    background: activeView === 'timeline' ? 'var(--bg-card, #27272a)' : 'none',
                    color: activeView === 'timeline' ? '#fff' : 'var(--text-muted)',
                    border: 'none',
                    borderRadius: 4,
                    padding: '4px 10px',
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  Chronology
                </button>
                <button
                  onClick={() => setActiveView('sessions')}
                  style={{
                    background: activeView === 'sessions' ? 'var(--bg-card, #27272a)' : 'none',
                    color: activeView === 'sessions' ? '#fff' : 'var(--text-muted)',
                    border: 'none',
                    borderRadius: 4,
                    padding: '4px 10px',
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  By Session ({sessions.length})
                </button>
              </div>
            </div>

            {/* Chronological Timeline View */}
            {activeView === 'timeline' && (
              <div className="footprint-timeline" style={{ position: 'relative', paddingLeft: 20 }}>
                {/* Vertical connecting spine */}
                <div
                  style={{
                    position: 'absolute',
                    left: 7,
                    top: 10,
                    bottom: 10,
                    width: 2,
                    background: 'var(--border-color, #27272a)',
                  }}
                />

                {groupedTimeline.map((group) => (
                  <div key={group.date} style={{ marginBottom: 24 }}>
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: 0.8,
                        color: 'var(--text-muted)',
                        marginBottom: 10,
                        marginLeft: -20,
                        padding: '2px 8px',
                        background: 'var(--bg-card, #161618)',
                        display: 'inline-block',
                        borderRadius: 4,
                        border: '1px solid var(--border-color, #27272a)',
                      }}
                    >
                      {formatDateHeader(group.date)}
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {group.items.map((item, idx) => {
                        const host = item.hostname || '';
                        const isApp = host.includes('app.') || host.includes('share.');
                        const isMainWebsite = host === 'sendnow.live' || host.startsWith('www.');
                        return (
                          <div
                            key={idx}
                            style={{
                              position: 'relative',
                              display: 'flex',
                              alignItems: 'flex-start',
                              gap: 12,
                            }}
                          >
                            {/* Dot on spine */}
                            <div
                              style={{
                                position: 'absolute',
                                left: -17,
                                top: 5,
                                width: 8,
                                height: 8,
                                borderRadius: '50%',
                                background:
                                  item.type === 'conversion'
                                    ? '#22c55e'
                                    : item.type === 'identify'
                                    ? '#6366f1'
                                    : item.type === 'event'
                                    ? '#f59e0b'
                                    : item.type === 'session_start'
                                    ? '#3b82f6'
                                    : 'var(--text-muted)',
                                border: '2px solid var(--bg-primary, #0c0c0d)',
                              }}
                            />

                            <div
                              style={{
                                flex: 1,
                                background: 'var(--bg-card, #161618)',
                                border: '1px solid var(--border-color, #27272a)',
                                borderRadius: 6,
                                padding: '9px 12px',
                                fontSize: 13,
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
                                  {item.type === 'pageview' && (
                                    <span style={{ color: 'var(--text-primary)', fontFamily: 'monospace', fontSize: 12 }}>
                                      {item.title}
                                    </span>
                                  )}
                                  {item.type === 'session_start' && (
                                    <span style={{ color: '#3b82f6' }}>
                                      Session Started {item.data?.utm_source ? `via ${item.data.utm_source}` : ''}
                                    </span>
                                  )}
                                  {item.type === 'event' && (
                                    <span style={{ color: '#f59e0b', fontWeight: 600 }}>{item.title}</span>
                                  )}
                                  {item.type === 'identify' && (
                                    <span style={{ color: '#6366f1', fontWeight: 600 }}>{item.title}</span>
                                  )}
                                  {item.type === 'conversion' && (
                                    <span style={{ color: '#22c55e', fontWeight: 600 }}>{item.title}</span>
                                  )}
                                </div>
                                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                  {formatTimeOnly(item.timestamp)}
                                </span>
                              </div>

                              {/* Domain & context tag */}
                              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 5, fontSize: 11, color: 'var(--text-muted)' }}>
                                {host && (
                                  <span
                                    style={{
                                      padding: '2px 7px',
                                      borderRadius: 4,
                                      fontSize: 11,
                                      fontWeight: 500,
                                      background: isApp
                                        ? 'rgba(99,102,241,0.14)'
                                        : isMainWebsite
                                        ? 'rgba(16,185,129,0.14)'
                                        : 'rgba(255,255,255,0.06)',
                                      color: isApp
                                        ? '#a5b4fc'
                                        : isMainWebsite
                                        ? '#6ee7b7'
                                        : 'inherit',
                                      border: isApp
                                        ? '1px solid rgba(99,102,241,0.3)'
                                        : isMainWebsite
                                        ? '1px solid rgba(16,185,129,0.3)'
                                        : '1px solid var(--border-color, #27272a)',
                                    }}
                                  >
                                    {isMainWebsite ? `🌐 ${host} (Website)` : isApp ? `⚡ ${host} (App)` : host}
                                  </span>
                                )}
                                {item.data?.referrer && item.data.referrer !== '' && (
                                  <span>ref: {item.data.referrer}</span>
                                )}
                                {item.data?.properties && Object.keys(item.data.properties).length > 0 && (
                                  <span style={{ color: '#fbbf24' }}>{JSON.stringify(item.data.properties)}</span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Session Grouped View */}
            {activeView === 'sessions' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {sessions.map((sess, sIdx) => (
                  <div
                    key={sess.id || sIdx}
                    style={{
                      background: 'var(--bg-card, #161618)',
                      border: '1px solid var(--border-color, #27272a)',
                      borderRadius: 8,
                      padding: 14,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>Session #{sessions.length - sIdx}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          • {formatTimestamp(sess.started_at)}
                        </span>
                      </div>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {formatDuration(sess.duration)}
                      </span>
                    </div>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12, fontSize: 11 }}>
                      <span className="badge badge-secondary" style={{ padding: '2px 6px' }}>
                        Source: {sess.utm_source || sess.referrer_domain || 'Direct'}
                      </span>
                      {sess.utm_campaign && (
                        <span className="badge badge-secondary" style={{ padding: '2px 6px' }}>
                          Campaign: {sess.utm_campaign}
                        </span>
                      )}
                      <span className="badge badge-secondary" style={{ padding: '2px 6px' }}>
                        {sess.page_count || sess.pageViews?.length || 1} pages
                      </span>
                    </div>

                    {/* Sequential page views in session */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {sess.pageViews?.map((pv, pvIdx) => (
                        <div
                          key={pv.id || pvIdx}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            background: 'var(--bg-primary, #0c0c0d)',
                            padding: '6px 10px',
                            borderRadius: 4,
                            fontSize: 12,
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>#{pvIdx + 1}</span>
                            <span style={{ fontFamily: 'monospace', color: 'var(--text-primary)' }}>{pv.pathname}</span>
                            {pv.hostname && (
                              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>({pv.hostname})</span>
                            )}
                          </div>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            {formatTimeOnly(pv.timestamp)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
