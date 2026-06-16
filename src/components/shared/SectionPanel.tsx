import type { CSSProperties } from 'react';
import { SEMANTIC } from '../../styles/theme';

export interface SectionPanelProps {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  style?: CSSProperties;
}

const s = {
  panel: {
    border: `1px solid ${SEMANTIC.borderColor}`,
    borderRadius: 16,
    background: SEMANTIC.cardBg,
    padding: '20px 22px',
  } as CSSProperties,

  titleBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 14,
    flexWrap: 'wrap',
    gap: 8,
  } as CSSProperties,

  title: {
    margin: 0,
    fontSize: 15,
    fontWeight: 600,
    letterSpacing: '-0.01em',
    color: SEMANTIC.textPrimary,
  } as CSSProperties,

  subtitle: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: SEMANTIC.textMuted,
    whiteSpace: 'pre-wrap',
  } as CSSProperties,
};

export default function SectionPanel({
  title,
  subtitle,
  children,
  style,
}: SectionPanelProps) {
  const hasHeader = title !== undefined || subtitle !== undefined;

  return (
    <div style={{ ...s.panel, ...style }}>
      {hasHeader && (
        <div style={s.titleBar}>
          {title !== undefined && <h2 style={s.title}>{title}</h2>}
          {subtitle !== undefined && (
            <span style={s.subtitle}>{subtitle}</span>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
