import { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import { getCountryName } from '@/lib/formatters';
import CountryFlag from './CountryFlag';
import TechIcon from './TechIcon';

const VisitorMap = dynamic(() => import('./VisitorMap'), { ssr: false });

function formatDuration(seconds) {
  if (!seconds || seconds < 0) return '0s';
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function VisitorCard({ user, onClose }) {
  const sessionSeconds = user.started_at
    ? Math.round((Date.now() - new Date(user.started_at).getTime()) / 1000)
    : null;
  return (
    <div className="visitor-card" onClick={(e) => e.stopPropagation()}>
      <button className="visitor-card-close" onClick={onClose}>×</button>
      <div className="visitor-card-avatar">
        <img src={`https://api.dicebear.com/9.x/micah/svg?seed=${encodeURIComponent(user.visitor_id || 'x')}&size=48&backgroundType=gradientLinear&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf`} width={48} height={48} alt="" style={{ borderRadius: '50%', display: 'block' }} />
      </div>
      <div className="visitor-card-rows">
        <div className="visitor-card-row">
          <span className="visitor-card-label">Location</span>
          <span className="visitor-card-value">
            {user.country && <CountryFlag code={user.country} size="s" />}
            {user.city ? `${user.city}, ` : ''}{user.country ? getCountryName(user.country) : 'Unknown'}
          </span>
        </div>
        <div className="visitor-card-row">
          <span className="visitor-card-label">Current page</span>
          <span className="visitor-card-value visitor-card-page">{user.current_page || '/'}</span>
        </div>
        <div className="visitor-card-row">
          <span className="visitor-card-label">Source</span>
          <span className="visitor-card-value">{user.source || 'Direct'}</span>
        </div>
        <div className="visitor-card-row">
          <span className="visitor-card-label">Device</span>
          <span className="visitor-card-value" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <TechIcon type="browser" name={user.browser} />
            {user.browser || '—'}{user.os ? ` · ${user.os}` : ''}{user.device_type ? ` · ${user.device_type}` : ''}
          </span>
        </div>
        {sessionSeconds !== null && (
          <div className="visitor-card-row">
            <span className="visitor-card-label">Session time</span>
            <span className="visitor-card-value">{formatDuration(sessionSeconds)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function RealtimeUsers({ countries = [] }) {
  const [data, setData] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const router = useRouter();
  const { siteId } = router.query;
  const intervalRef = useRef(null);

  useEffect(() => {
    if (!siteId) return;
    const fetchRealtime = async () => {
      try {
        const res = await fetch(`/api/analytics/${siteId}/realtime`);
        if (res.ok) {
          const next = await res.json();
          setData(next);
          setSelectedUser(prev => prev ? next.users.find(u => u.visitor_id === prev.visitor_id) || null : null);
        }
      } catch {}
    };
    fetchRealtime();
    intervalRef.current = setInterval(fetchRealtime, 30000);
    return () => clearInterval(intervalRef.current);
  }, [siteId]);

  if (!data) return null;

  return (
    <div className="realtime-widget">
      <button className="realtime-widget-toggle" onClick={() => { setExpanded(!expanded); setSelectedUser(null); }}>
        <span className="realtime-dot" />
        <span className="realtime-widget-count">{data.count}</span>
        <span className="realtime-widget-label">{data.count === 1 ? 'visitor' : 'visitors'} online</span>
        <span className={`realtime-widget-chevron ${expanded ? 'open' : ''}`}>&#x25B2;</span>
      </button>
      {expanded && (
        <div className="realtime-map-container">
          {data.users.length === 0 ? (
            <div style={{ padding: '24px', textAlign: 'center', opacity: 0.5, fontSize: 13 }}>No active visitors right now</div>
          ) : (
            <div style={{ position: 'relative', height: 300 }}>
              <VisitorMap countries={countries} activeUsers={data.users} selectedUser={selectedUser} onUserClick={setSelectedUser} />
              {selectedUser && (
                <div className="visitor-card-overlay">
                  <VisitorCard user={selectedUser} onClose={() => setSelectedUser(null)} />
                </div>
              )}
            </div>
          )}
          {data.users.length > 0 && (
            <div className="realtime-widget-list">
              {data.users.slice(0, 8).map((user) => (
                <div className={`realtime-widget-row${selectedUser?.visitor_id === user.visitor_id ? ' selected' : ''}`} key={user.visitor_id} onClick={() => setSelectedUser(prev => prev?.visitor_id === user.visitor_id ? null : user)} style={{ cursor: 'pointer' }}>
                  <div className="realtime-row-top">
                    <CountryFlag code={user.country} size="s" />
                    <span className="realtime-country">{user.city || (user.country ? getCountryName(user.country) : 'Unknown')}</span>
                    <span className="realtime-page">{user.current_page || '/'}</span>
                  </div>
                  <div className="realtime-row-bottom">
                    <span className="realtime-source">{user.source || 'Direct'}</span>
                    <TechIcon type="browser" name={user.browser} />
                  </div>
                </div>
              ))}
              {data.users.length > 8 && <div className="realtime-widget-more">+{data.users.length - 8} more</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
