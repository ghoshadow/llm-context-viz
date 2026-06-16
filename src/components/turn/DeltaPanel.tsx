import { type CSSProperties } from 'react';
import { COLORS, DELTA_LABELS, SEMANTIC } from '../../styles/theme';
import { fmt } from '../../utils/format';
import SectionPanel from '../shared/SectionPanel';

export interface DeltaPanelProps {
  /** Per-category token deltas for this turn (category key -> token count). Null means no data yet. */
  deltas: Record<string, number> | null;
  /** Cumulative total context tokens for percentage calculation. */
  totalCum: number;
}

const s = {
  desc: {
    margin: 0,
    marginBottom: 14,
    fontSize: 11.5,
    lineHeight: 1.5,
    color: SEMANTIC.textDesc4,
  } as CSSProperties,

  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 11,
  } as CSSProperties,

  row: {} as CSSProperties,

  rowHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 5,
  } as CSSProperties,

  swatch: (color: string): CSSProperties => ({
    width: 9,
    height: 9,
    borderRadius: 2,
    background: color,
    flexShrink: 0,
  }),

  label: {
    fontSize: 12.5,
    flex: 1,
    color: SEMANTIC.textPrimary7,
  } as CSSProperties,

  plusTokens: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    fontWeight: 600,
    color: SEMANTIC.textPrimary5,
  } as CSSProperties,

  barTrack: {
    height: 6,
    borderRadius: 4,
    background: SEMANTIC.barBg,
    overflow: 'hidden',
  } as CSSProperties,

  barFill: (color: string, pct: number): CSSProperties => ({
    height: '100%',
    width: `${pct}%`,
    borderRadius: 4,
    background: color,
  }),

  empty: (opacity: number): CSSProperties => ({
    marginTop: 14,
    fontSize: 12,
    color: SEMANTIC.textDesc3,
    opacity,
  }),
};

export default function DeltaPanel({ deltas, totalCum }: DeltaPanelProps) {
  // Collect non-zero delta rows, sorted descending by token count.
  const rows: Array<{ key: string; label: string; color: string; tokens: number }> = [];
  if (deltas) {
    for (const key of Object.keys(deltas)) {
      const tokens = deltas[key];
      if (tokens && tokens > 0 && DELTA_LABELS[key]) {
        rows.push({ key, label: DELTA_LABELS[key]!, color: COLORS[key]!, tokens });
      }
    }
    rows.sort((a, b) => b.tokens - a.tokens);
  }

  const hasData = rows.length > 0;
  const dmax = Math.max(1, ...rows.map(r => r.tokens));

  return (
    <SectionPanel title="本轮新增内容">
      <p style={s.desc}>这一轮向上下文追加了什么</p>

      {hasData ? (
        <div style={s.list}>
          {rows.map(r => (
            <div key={r.key} style={s.row}>
              <div style={s.rowHeader}>
                <span style={s.swatch(r.color)} />
                <span style={s.label}>{r.label}</span>
                <span style={s.plusTokens}>+{fmt(r.tokens)}</span>
              </div>
              <div style={s.barTrack}>
                <div style={s.barFill(r.color, Math.max(3, (r.tokens / dmax) * 100))} />
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div style={s.empty(hasData ? 0 : 1)}>本轮未产生明显增量。</div>
    </SectionPanel>
  );
}
