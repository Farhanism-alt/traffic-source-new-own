export default function AppLogoMark({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style={{ flexShrink: 0 }}>
      <rect x="1" y="1" width="30" height="30" rx="8" fill="currentColor" opacity="0.12" />
      <rect x="1.5" y="1.5" width="29" height="29" rx="7.5" fill="none" stroke="currentColor" strokeWidth="1.3" opacity="0.45" />
      <text x="16" y="21.5" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontWeight="800" fontSize="13" letterSpacing="-0.5" fill="currentColor">SM</text>
    </svg>
  );
}
