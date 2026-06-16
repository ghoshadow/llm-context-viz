import { SEMANTIC } from '../../styles/theme';

export interface StatCardProps {
  label: string;
  value: string;
  accent?: boolean;
  color?: string;
}

const base: React.CSSProperties = {
  border: `1px solid ${SEMANTIC.borderColor}`,
  borderRadius: 10,
  padding: '11px 15px',
  background: 'oklch(0.20 0.01 265 / 0.6)',
  display: 'flex',
  flexDirection: 'column',
  gap: 5,
};

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'oklch(0.58 0.012 265)',
  fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
};

const valueStyle: React.CSSProperties = {
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: 13.5,
  fontWeight: 500,
  lineHeight: 1,
};

export default function StatCard({ label, value, accent, color }: StatCardProps) {
  const accentColor = color ?? SEMANTIC.textAccent;

  const cardStyle: React.CSSProperties = accent
    ? {
        ...base,
        borderColor: accent ? color : 'oklch(0.45 0.10 60)',
        background: `oklch(0.74 0.13 60 / 0.12)`,
      }
    : { ...base };

  const valueColor = accent ? accentColor : 'oklch(0.90 0.01 265)';

  return (
    <div style={cardStyle}>
      <span style={labelStyle}>{label}</span>
      <span style={{ ...valueStyle, color: valueColor }}>{value}</span>
    </div>
  );
}
