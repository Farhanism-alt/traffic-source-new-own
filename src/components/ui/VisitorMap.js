import { useEffect, useRef, useMemo, useCallback, useState } from 'react';
import Globe from 'react-globe.gl';
import { useTheme } from '@/contexts/ThemeContext';

const COUNTRY_COORDS = {
  US: [39.8, -98.5], CA: [56.1, -106.3], MX: [23.6, -102.5], BR: [-14.2, -51.9],
  AR: [-38.4, -63.6], GB: [55.4, -3.4], DE: [51.2, 10.4], FR: [46.2, 2.2],
  ES: [40.5, -3.7], IT: [41.9, 12.6], NL: [52.1, 5.3], BE: [50.5, 4.5],
  CH: [46.8, 8.2], AT: [47.5, 14.6], PT: [39.4, -8.2], SE: [60.1, 18.6],
  NO: [60.5, 8.5], DK: [56.3, 9.5], FI: [61.9, 25.7], PL: [51.9, 19.1],
  CZ: [49.8, 15.5], RO: [45.9, 24.9], HU: [47.2, 19.5], BG: [42.7, 25.5],
  GR: [39.1, 21.8], TR: [38.9, 35.2], RU: [61.5, 105.3], UA: [48.4, 31.2],
  IN: [20.6, 78.9], CN: [35.9, 104.2], JP: [36.2, 138.3], KR: [35.9, 127.8],
  AU: [-25.3, 133.8], NZ: [-40.9, 174.9], ZA: [-30.6, 22.9], NG: [9.1, 8.7],
  EG: [26.8, 30.8], KE: [-0.0, 37.9], ID: [-0.8, 113.9], TH: [15.9, 100.9],
  VN: [14.1, 108.3], PH: [12.9, 121.8], MY: [4.2, 101.9], SG: [1.4, 103.8],
  PK: [30.4, 69.3], BD: [23.7, 90.4], SA: [23.9, 45.1], AE: [23.4, 53.8],
  IL: [31.0, 34.9], CL: [-35.7, -71.5], CO: [4.6, -74.3], PE: [-9.2, -75.0],
  IE: [53.1, -8.2], HK: [22.4, 114.1], TW: [23.7, 120.9], LK: [7.9, 80.8],
};

function seededJitter(seed, index, range) {
  let h = 0;
  const s = String(seed) + String(index);
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return ((h % 10000) / 10000 - 0.5) * range * 2;
}

export default function VisitorMap({ countries = [], activeUsers = [], selectedUser, onUserClick }) {
  const globeRef = useRef();
  const containerRef = useRef();
  const { theme } = useTheme();
  const [size, setSize] = useState({ width: 0, height: 0 });

  // Measure container
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width: Math.round(width), height: Math.round(height) });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Globe controls
  useEffect(() => {
    if (!globeRef.current) return;
    const ctrl = globeRef.current.controls();
    ctrl.autoRotate = true;
    ctrl.autoRotateSpeed = 0.4;
    ctrl.enableZoom = false;
    ctrl.enablePan = false;
  }, [size]);

  const globeImageUrl = theme === 'dark'
    ? '//unpkg.com/three-globe/example/img/earth-dark.jpg'
    : '//unpkg.com/three-globe/example/img/earth-blue-marble.jpg';

  const bgColor = theme === 'dark' ? 'rgba(27,27,28,1)' : 'rgba(245,245,245,1)';

  const maxCount = Math.max(...countries.map(c => c.count), 1);

  const pointsData = useMemo(() => countries
    .filter(c => COUNTRY_COORDS[c.name])
    .map(c => ({
      lat: COUNTRY_COORDS[c.name][0],
      lng: COUNTRY_COORDS[c.name][1],
      radius: Math.max(0.25, (c.count / maxCount) * 1.6),
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [countries, maxCount]
  );

  const htmlData = useMemo(() =>
    activeUsers
      .filter(u => COUNTRY_COORDS[u.country])
      .map((u, i) => ({
        ...u,
        lat: COUNTRY_COORDS[u.country][0] + seededJitter(u.visitor_id, i, 4),
        lng: COUNTRY_COORDS[u.country][1] + seededJitter(u.visitor_id, i + 1, 4),
        isSelected: selectedUser?.visitor_id === u.visitor_id,
      })),
    [activeUsers, selectedUser]
  );

  const getHtmlElement = useCallback((u) => {
    const border = u.isSelected ? '#f59e0b' : '#22c55e';
    const seed = u.visitor_id || 'unknown';
    const src = `https://api.dicebear.com/9.x/micah/svg?seed=${encodeURIComponent(seed)}&size=32&backgroundType=gradientLinear&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf`;
    const el = document.createElement('div');
    el.style.cssText = `width:32px;height:32px;border-radius:50%;overflow:hidden;border:2.5px solid ${border};box-shadow:0 2px 8px rgba(0,0,0,0.3);background:#fff;cursor:pointer;`;
    el.innerHTML = `<img src="${src}" width="32" height="32" style="display:block;" />`;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (onUserClick) onUserClick(u.isSelected ? null : u);
    });
    return el;
  }, [onUserClick]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
      {size.width > 0 && (
        <Globe
          ref={globeRef}
          width={size.width}
          height={size.height}
          globeImageUrl={globeImageUrl}
          backgroundColor={bgColor}
          atmosphereColor="#3b82f6"
          atmosphereAltitude={0.12}
          showGraticules={false}
          pointsData={pointsData}
          pointLat="lat"
          pointLng="lng"
          pointRadius="radius"
          pointColor={() => '#3b82f6'}
          pointAltitude={0.015}
          pointResolution={12}
          htmlElementsData={htmlData}
          htmlLat="lat"
          htmlLng="lng"
          htmlElement={getHtmlElement}
          onGlobeClick={() => { if (onUserClick) onUserClick(null); }}
        />
      )}
    </div>
  );
}
