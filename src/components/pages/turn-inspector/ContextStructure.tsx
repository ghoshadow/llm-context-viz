import { useMemo } from 'react';
import { COLORS, LABELS, SEMANTIC, OVERFLOW, OK_STATE } from '../../../styles/theme';
import { fmt, fmtK } from '../../../utils/format';
import { CHARS_PER_TOKEN } from '../../../pipeline/utils';

interface ContextStructureProps {
  comp: Record<string, number>;
  cumTotal: number;
  maxInput: number;
  contextLimit: number;
  hoveredComp: string | null;
  onCompEnter: (key: string) => void;
  onCompLeave: () => void;
}

export function ContextStructure({
  comp,
  cumTotal,
  maxInput,
  contextLimit: ctxLimit,
  hoveredComp,
  onCompEnter,
  onCompLeave,
}: ContextStructureProps) {
  const order = useMemo(() => {
    return Object.keys(comp)
      .filter((k) => comp[k]! > 0)
      .sort((a, b) => comp[b]! - comp[a]!);
  }, [comp]);

  // Raw character counts (comp values are tokens = chars/CHARS_PER_TOKEN)
  const compSum = Object.values(comp).reduce((a, b) => a! + b!, 0) || 1;
  const charTotal = Math.round(compSum * CHARS_PER_TOKEN);

  const barSegs = order.map((k) => ({
    key: k,
    color: COLORS[k] ?? 'oklch(0.5 0 0)',
    pct: (comp[k]! / compSum) * 100,
    op: hoveredComp && hoveredComp !== k ? 0.28 : 1,
    title: `${LABELS[k] ?? k} — ${fmt(Math.round(comp[k]! * CHARS_PER_TOKEN))} chars`,
  }));

  const charValues = order.map(k => Math.round(comp[k]! * CHARS_PER_TOKEN));
  const charDrift = charTotal - charValues.reduce((a, b) => a + b, 0);
  if (charDrift !== 0 && charValues.length > 0) {
    let maxIdx = 0;
    for (let i = 1; i < charValues.length; i++) {
      if (charValues[i]! > charValues[maxIdx]!) maxIdx = i;
    }
    charValues[maxIdx]! += charDrift;
  }
  const legendRows = order.map((k, i) => ({
    key: k,
    label: LABELS[k] ?? k,
    color: COLORS[k] ?? 'oklch(0.5 0 0)',
    tokensFmt: fmt(charValues[i]!) + ' chars',
    pctFmt: ((comp[k]! / compSum) * 100).toFixed(2) + '%',
    op: hoveredComp && hoveredComp !== k ? 0.28 : 1,
  }));

  const ctxPct = ctxLimit > 0 ? ((maxInput / ctxLimit) * 100).toFixed(2) : '0.00';
  const over = cumTotal > ctxLimit;
  const overflowNote = over
    ? `累计拼装内容已超过 ${fmtK(ctxLimit)} 上下文窗口 —— 实际请求依靠缓存与压缩才能容纳，峰值输入仅 ${fmt(maxInput)} tok。`
    : `本轮峰值输入 ${fmt(maxInput)} tok，占 ${fmtK(ctxLimit)} 窗口的 ${ctxPct}%。`;

  return (
    <div
      className="panel"
      style={{ padding: '20px 22px' }}
    >
      <div className="section-header">
        <h2>本轮上下文拼装结构</h2>
        <span className="helper-text" style={{ fontSize: 11, color: SEMANTIC.textMuted }}>
          总计 {fmt(charTotal)} chars · 宽度 = 占比
        </span>
      </div>

      {/* Stacked bar */}
      <div
        onMouseLeave={onCompLeave}
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
            onMouseEnter={() => onCompEnter(seg.key)}
            title={seg.title}
            style={{
              width: `${seg.pct}%`,
              background: seg.color,
              opacity: seg.op,
              transition: 'opacity .16s ease',
              cursor: 'default',
              borderRight: `1px solid oklch(0.16 0.008 265 / 0.45)`,
            }}
          />
        ))}
      </div>

      {/* Legend rows in 2-column grid */}
      <div
        onMouseLeave={onCompLeave}
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
            onMouseEnter={() => onCompEnter(l.key)}
            className="legend-row"
            style={{ opacity: l.op, transition: 'opacity .16s ease' }}
          >
            <span className="legend-dot" style={{ background: l.color }} />
            <span className="legend-label">{l.label}</span>
            <span className="legend-tokens" style={{ width: 85, textAlign: 'right', whiteSpace: 'nowrap' }}>
              {l.tokensFmt}
            </span>
            <span className="legend-pct" style={{ width: 65, textAlign: 'right' }}>
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
          color: over ? OVERFLOW.text : OK_STATE.text,
          background: over ? OVERFLOW.bg : OK_STATE.bg,
          border: `1px solid ${over ? OVERFLOW.border : OK_STATE.border}`,
          borderRadius: 9,
          padding: '9px 12px',
          lineHeight: 1.5,
        }}
      >
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>
          {over ? '⚠' : '✓'}
        </span>
        <span>{overflowNote}</span>
      </div>
    </div>
  );
}
