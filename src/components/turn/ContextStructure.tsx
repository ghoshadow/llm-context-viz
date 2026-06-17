import { useMemo } from 'react';
import { COLORS, LABELS, EST, SEMANTIC, OVERFLOW, OK_STATE } from '../../styles/theme';
import { fmt, fmtK } from '../../utils/format';

const WINDOW = 200000;

export interface ContextStructureProps {
  comp: Record<string, number>;
  cumTotal: number;
  maxInput: number;
  hoveredCategory: string | null;
  onHoverCategory: (key: string | null) => void;
}

export default function ContextStructure({
  comp,
  cumTotal,
  maxInput,
  hoveredCategory,
  onHoverCategory,
}: ContextStructureProps) {
  const order = Object.keys(comp)
    .filter((k) => (comp[k] ?? 0) > 0)
    .sort((a, b) => (comp[b] ?? 0) - (comp[a] ?? 0));

  const compSum = Object.values(comp).reduce((a, b) => a + b, 0) || 1;
  const scale = cumTotal / compSum;
  const barSegs = useMemo(() => {
    return order.map((k) => ({
      key: k,
      color: COLORS[k] ?? 'oklch(0.5 0 0)',
      pct: (((comp[k] ?? 0) * scale) / cumTotal) * 100,
      op: hoveredCategory && hoveredCategory !== k ? 0.28 : 1,
      title: `${LABELS[k]} — ${fmt(comp[k] ?? 0)} tok`,
    }));
  }, [order, comp, cumTotal, hoveredCategory]);

  const legendRows = useMemo(() => {
    return order.map((k) => ({
      key: k,
      label: LABELS[k] ?? k,
      color: COLORS[k] ?? 'oklch(0.5 0 0)',
      tokensFmt: fmt(comp[k] ?? 0),
      pctFmt: (((comp[k] ?? 0) / cumTotal) * 100).toFixed(2) + '%',
      estBadge: EST.has(k),
      op: hoveredCategory && hoveredCategory !== k ? 0.28 : 1,
    }));
  }, [order, comp, cumTotal, hoveredCategory]);

  const over = cumTotal > WINDOW;
  const overflowNote = over
    ? `累计拼装内容已超过 ${fmtK(WINDOW)} 上下文窗口 —— 实际请求依靠缓存与压缩才能容纳，峰值输入仅 ${fmt(maxInput)} tok。`
    : `本轮峰值输入 ${fmt(maxInput)} tok，占 ${fmtK(WINDOW)} 窗口的 ${((maxInput / WINDOW) * 100).toFixed(2)}%。`;

  const overflowColor = over ? OVERFLOW.text : OK_STATE.text;
  const overflowBg = over ? OVERFLOW.bg : OK_STATE.bg;
  const overflowBorder = over ? OVERFLOW.border : OK_STATE.border;
  const overflowIcon = over ? '⚠' : '✓';

  return (
    <div
      style={{
        border: `1px solid ${SEMANTIC.borderColor}`,
        borderRadius: 16,
        padding: '20px 22px',
        background: SEMANTIC.cardBg,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 14,
          flexWrap: 'wrap',
          gap: 6,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
          本轮上下文拼装结构
        </h2>
        <span
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11,
            color: SEMANTIC.textMuted,
          }}
        >
          总计 {fmt(cumTotal)} · 宽度 = 占比
        </span>
      </div>

      {/* Stacked bar */}
      <div
        onMouseLeave={() => onHoverCategory(null)}
        style={{
          display: 'flex',
          width: '100%',
          height: 54,
          borderRadius: 11,
          overflow: 'hidden',
          border: `1px solid ${SEMANTIC.borderBarBg}`,
          background: 'oklch(0.19 0.01 265)',
        }}
      >
        {barSegs.map((seg) => (
          <div
            key={seg.key}
            onMouseEnter={() => onHoverCategory(seg.key)}
            title={seg.title}
            style={{
              width: `${seg.pct}%`,
              background: seg.color,
              opacity: seg.op,
              transition: 'opacity .16s ease',
              cursor: 'default',
              borderRight: `1px solid ${SEMANTIC.barSeparator}`,
            }}
          />
        ))}
        {/* Free space — unused portion of window with diagonal stripe pattern */}
        {(() => {
          const usedPct = barSegs.reduce((s, seg) => s + seg.pct, 0);
          const freePct = Math.max(0, 100 - usedPct);
          if (freePct > 0.1) {
            return <div style={{ width: `${freePct}%`, background: SEMANTIC.freeStripes }} />;
          }
          return null;
        })()}
      </div>

      {/* Legend rows */}
      <div
        onMouseLeave={() => onHoverCategory(null)}
        style={{
          marginTop: 14,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '2px 26px',
        }}
      >
        {legendRows.map((l) => (
          <div
            key={l.key}
            onMouseEnter={() => onHoverCategory(l.key)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              padding: '7px 0',
              borderBottom: `1px solid ${SEMANTIC.borderSubtle4}`,
              opacity: l.op,
              transition: 'opacity .16s ease',
              cursor: 'default',
            }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 3,
                background: l.color,
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: 12.5, flex: 1, color: SEMANTIC.textPrimary7 }}>
              {l.label}
            </span>
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10,
                color: SEMANTIC.textMuted3,
              }}
            >
              {l.estBadge}
            </span>
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 12,
                fontWeight: 600,
                color: SEMANTIC.textPrimary5,
                width: 56,
                textAlign: 'right',
              }}
            >
              {l.tokensFmt}
            </span>
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 11.5,
                color: SEMANTIC.textDesc,
                width: 46,
                textAlign: 'right',
              }}
            >
              {l.pctFmt}
            </span>
          </div>
        ))}
      </div>

      {/* Overflow note */}
      <div
        style={{
          marginTop: 13,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 12,
          color: overflowColor,
          background: overflowBg,
          border: `1px solid ${overflowBorder}`,
          borderRadius: 9,
          padding: '9px 12px',
          lineHeight: 1.5,
        }}
      >
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>
          {overflowIcon}
        </span>
        <span>{overflowNote}</span>
      </div>
    </div>
  );
}
