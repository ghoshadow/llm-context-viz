import type { CSSProperties } from 'react';
import { SEMANTIC } from '../../styles/theme';

export interface LegendRowProps {
  /** oklch color string for the swatch. */
  color: string;
  /** Category display label. */
  label: string;
  /** Whether tokens are estimated (shows "估算" badge). */
  estimated?: boolean;
  /** Formatted token count string, e.g. "12,345" */
  tokensFmt: string;
  /** Formatted percentage string, e.g. "42.9%" */
  pctFmt: string;
  /** Overall row opacity (used for hover dim effect). */
  opacity?: number;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

const s = {
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 9,
    padding: '7px 0',
    borderBottom: `1px solid ${SEMANTIC.borderSubtle3}`,
    cursor: 'default',
    transition: 'opacity .16s ease',
  } as CSSProperties,

  swatch: {
    width: 10,
    height: 10,
    borderRadius: 3,
    flexShrink: 0,
  } as CSSProperties,

  label: {
    fontSize: 12.5,
    flex: 1,
    color: SEMANTIC.textPrimary4,
  } as CSSProperties,

  badge: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10,
    color: SEMANTIC.textMuted3,
  } as CSSProperties,

  tokens: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    fontWeight: 600,
    color: SEMANTIC.textPrimary5,
    width: 56,
    textAlign: 'right' as const,
  } as CSSProperties,

  pct: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11.5,
    color: SEMANTIC.textMuted2,
    width: 46,
    textAlign: 'right' as const,
  } as CSSProperties,
};

export default function LegendRow({
  color,
  label,
  estimated = false,
  tokensFmt,
  pctFmt,
  opacity = 1,
  onMouseEnter,
  onMouseLeave,
}: LegendRowProps) {
  return (
    <div
      style={{ ...s.row, opacity }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <span style={{ ...s.swatch, background: color }} />
      <span style={s.label}>{label}</span>
      {estimated && <span style={s.badge}>估算</span>}
      <span style={s.tokens}>{tokensFmt}</span>
      <span style={s.pct}>{pctFmt}</span>
    </div>
  );
}
