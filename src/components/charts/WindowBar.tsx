import { useState } from 'react';
import { SEMANTIC } from '../../styles/theme';

export interface WindowBarSegment {
  key: string;
  pct: number;
  color: string;
  title: string;
}

export interface WindowBarProps {
  segments: WindowBarSegment[];
  freePct: number;
  freeTokensFmt: string;
  contextLimitFmt: string;
  peakTokensFmt: string;
  onHover: (key: string | null) => void;
}

const s = {
  section: {
    marginTop: 30,
  } as React.CSSProperties,

  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 14,
    flexWrap: 'wrap',
    gap: 8,
  } as React.CSSProperties,

  requestLabel: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    color: SEMANTIC.textDesc,
  } as React.CSSProperties,

  stats: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12.5,
    color: SEMANTIC.textDesc2,
  } as React.CSSProperties,

  peakValue: {
    color: SEMANTIC.textPrimary2,
    fontWeight: 600,
  } as React.CSSProperties,

  windowUsed: {
    color: SEMANTIC.textAccent,
  } as React.CSSProperties,

  bar: {
    display: 'flex',
    width: '100%',
    height: 74,
    borderRadius: 12,
    overflow: 'hidden',
    border: `1px solid ${SEMANTIC.borderBarBg}`,
    background: 'oklch(0.19 0.01 265)',
    boxShadow: SEMANTIC.barInsetBoxShadow,
  } as React.CSSProperties,

  segment: {
    transition: 'opacity 0.18s ease',
    cursor: 'default',
    position: 'relative',
    borderRight: `1px solid ${SEMANTIC.barSeparator}`,
  } as React.CSSProperties,

  freeSpace: {
    background: SEMANTIC.freeStripes,
  } as React.CSSProperties,

  labelsRow: {
    display: 'flex',
    justifyContent: 'space-between',
    marginTop: 7,
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10.5,
    color: SEMANTIC.textMuted3,
  } as React.CSSProperties,
};

export default function WindowBar({
  segments,
  freePct,
  freeTokensFmt,
  contextLimitFmt,
  peakTokensFmt,
  onHover,
}: WindowBarProps) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  const handleEnter = (key: string) => {
    setHoveredKey(key);
    onHover(key);
  };

  const handleLeave = () => {
    setHoveredKey(null);
    onHover(null);
  };

  return (
    <section style={s.section}>
      <div style={s.headerRow}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
          <span style={s.requestLabel}>
            {'请求 #X · 全会话最重'}
          </span>
        </div>
        <div style={s.stats}>
          <span style={s.peakValue}>{peakTokensFmt}</span>
          {' / '}
          {contextLimitFmt}
          {' 窗口 · '}
          <span style={s.windowUsed}>{'已用 X%'}</span>
        </div>
      </div>

      <div style={s.bar} onMouseLeave={handleLeave}>
        {segments.map((seg) => {
          const isDimmed = hoveredKey !== null && hoveredKey !== seg.key;
          return (
            <div
              key={seg.key}
              title={seg.title}
              onMouseEnter={() => handleEnter(seg.key)}
              style={{
                ...s.segment,
                width: `${seg.pct}%`,
                background: seg.color,
                opacity: isDimmed ? 0.28 : 1,
              }}
            />
          );
        })}
        {freePct > 0 && (
          <div style={{ ...s.freeSpace, width: `${freePct}%` }} />
        )}
      </div>

      <div style={s.labelsRow}>
        <span>0</span>
        <span>窗口剩余 {freeTokensFmt}</span>
        <span>{contextLimitFmt}</span>
      </div>
    </section>
  );
}
