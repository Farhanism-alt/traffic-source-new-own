import Flag from 'react-flagpack';
import 'react-flagpack/dist/style.css';

const CODE_MAP = {
  GB: 'GB-UKM',
};

export default function CountryFlag({ code, size = 'm' }) {
  if (!code || code === 'UNKNOWN' || !/^[a-z]{2}$/i.test(code)) {
    return <span style={{ fontSize: size === 's' ? 14 : 18, lineHeight: 1 }}>🌐</span>;
  }

  const upper = code.toUpperCase();
  const flagCode = CODE_MAP[upper] || upper;

  return (
    <Flag
      code={flagCode}
      size={size}
      hasBorder={false}
      hasBorderRadius
      gradient="real-linear"
    />
  );
}
