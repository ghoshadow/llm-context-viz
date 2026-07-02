import { useMemo } from 'react';
import {
  COLORS,
  LABELS,
  DELTA_LABELS,
  SEMANTIC,
  SELECTED_ITEM,
  UNSELECTED_ITEM,
  STEP_SELECTED,
  STEP_COLORS,
  OVERFLOW,
  OK_STATE,
} from '../../styles/theme';
import { fmt, fmtK, fmtDur } from '../../utils/format';
import { CHARS_PER_TOKEN } from '../../pipeline/utils';
import { getStructuredTextPreview } from '../shared/structuredText';
import type { TimelineSegment } from '../../types/session';
import { isTaskName, segColor } from './turnInspectorLogic';
import { TurnStepDetailPanel } from './TurnStepDetailPanel';

/** Max height for collapsed content blocks. */
const COLLAPSED_H = 180;

// ============================================================================
// Sub-components
// ============================================================================

interface TurnListItemProps {
  turnIndex: number;
  turnNum: string;
  asstReqs: number;
  maxInput: number;
  cumTotal: number;
  contextLimit: number;
  prompt: string;
  isSelected: boolean;
  compressionReset: boolean;
  onClick: () => void;
}

export function TurnListItem({
  turnNum,
  asstReqs,
  maxInput,
  cumTotal,
  contextLimit: ctxLimit,
  prompt,
  isSelected,
  compressionReset,
  onClick,
}: TurnListItemProps) {
  const loadPct = ctxLimit > 0 ? Math.max(2, (cumTotal / ctxLimit) * 100) : 100;
  const peakColor = maxInput >= 120000 ? 'oklch(0.76 0.13 60)' : SEMANTIC.textDesc2;
  const structuredPreview = getStructuredTextPreview(prompt);
  const isCommandPreview = structuredPreview?.kind === 'command';
  const isPluginPreview = structuredPreview?.kind === 'plugin-reference';
  const previewIcon = isCommandPreview ? '/' : isPluginPreview ? '@' : '!';
  const previewAccent = isCommandPreview
    ? 'oklch(0.86 0.09 165)'
    : isPluginPreview
      ? 'oklch(0.86 0.08 285)'
      : 'oklch(0.86 0.10 80)';
  const previewIconBg = isCommandPreview
    ? 'oklch(0.38 0.10 165 / 0.22)'
    : isPluginPreview
      ? 'oklch(0.50 0.10 285 / 0.18)'
      : 'oklch(0.64 0.10 80 / 0.16)';

  return (
    <button
      onClick={onClick}
      style={{
        textAlign: 'left',
        border: `1px solid ${isSelected ? SELECTED_ITEM.border : UNSELECTED_ITEM.border}`,
        borderRadius: 11,
        padding: '11px 13px',
        background: isSelected ? SELECTED_ITEM.bg : UNSELECTED_ITEM.bg,
        cursor: 'pointer',
        fontFamily: 'inherit',
        color: 'inherit',
        transition: 'background .14s ease, border-color .14s ease',
        display: 'block',
        width: '100%',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11,
            fontWeight: 600,
            color: isSelected ? SEMANTIC.textAccent3 : SEMANTIC.textMiniLabel,
            width: 26,
            flexShrink: 0,
          }}
        >
          {turnNum}
        </span>
        <span
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 10,
            color: SEMANTIC.textMiniLabel,
            border: `1px solid ${SEMANTIC.borderColor}`,
            borderRadius: 5,
            padding: '1px 5px',
          }}
        >
          {asstReqs} 请求
        </span>
        {compressionReset && (
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 9.5,
              fontWeight: 600,
              color: 'oklch(0.85 0.14 80)',
              background: 'oklch(0.85 0.14 80 / 0.12)',
              border: '1px solid oklch(0.85 0.14 80 / 0.35)',
              borderRadius: 5,
              padding: '1px 6px',
              letterSpacing: '0.02em',
            }}
          >
            压缩后
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 10.5,
            color: peakColor,
          }}
        >
          {fmtK(maxInput)}
        </span>
      </div>
      <div
        style={{
          fontSize: 12.5,
          lineHeight: 1.45,
          color: isSelected ? SEMANTIC.textPrimary : SEMANTIC.textSecondary,
          display: structuredPreview ? 'flex' : '-webkit-box',
          alignItems: structuredPreview ? 'center' : undefined,
          gap: structuredPreview ? 7 : undefined,
          minHeight: structuredPreview ? 35 : undefined,
          WebkitLineClamp: structuredPreview ? undefined : 2,
          WebkitBoxOrient: structuredPreview ? undefined : 'vertical',
          overflow: 'hidden',
        }}
      >
        {structuredPreview ? (
          <>
            <span
              style={{
                width: 20,
                height: 20,
                borderRadius: 6,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 11,
                fontWeight: 700,
                color: previewAccent,
                background: previewIconBg,
              }}
            >
              {previewIcon}
            </span>
            <span style={{ minWidth: 0 }}>
              <span
                style={{
                  display: 'block',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontFamily: "'IBM Plex Mono', monospace",
                  color: previewAccent,
                  fontWeight: 650,
                }}
              >
                {structuredPreview.label}
              </span>
              {structuredPreview.detail && (
                <span
                  style={{
                    display: 'block',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontSize: 11,
                    color: SEMANTIC.textMiniLabel,
                    marginTop: 1,
                  }}
                >
                  {structuredPreview.detail}
                </span>
              )}
            </span>
          </>
        ) : prompt}
      </div>
      <div
        style={{
          height: 3,
          borderRadius: 2,
          marginTop: 9,
          background: 'oklch(0.26 0.01 265)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${loadPct}%`,
            borderRadius: 2,
            background: isSelected ? SELECTED_ITEM.loadColor : UNSELECTED_ITEM.loadColor,
          }}
        />
      </div>
    </button>
  );
}

// ============================================================================
// Context Structure Card
// ============================================================================

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

// ============================================================================
// Execution Timeline Card
// ============================================================================

interface ExecutionTimelineProps {
  durMs: number;
  modelMs: number;
  toolMs: number;
  subMs: number;
  stepCount: number;
  segs: TimelineSegment[];
  longestName: string;
  longestMs: number;
  selectedStepIndex: number | null;
  onToggleStep: (index: number) => void;
  prompt: string;
}

export function ExecutionTimeline({
  durMs,
  modelMs,
  toolMs,
  subMs,
  stepCount,
  segs,
  longestName,
  longestMs,
  selectedStepIndex,
  onToggleStep,
  prompt,
}: ExecutionTimelineProps) {
  const execMs = toolMs + subMs;

  const modelPct = durMs ? (modelMs / durMs) * 100 : 0;
  const toolPct = durMs ? (toolMs / durMs) * 100 : 0;
  const subPct = durMs ? (subMs / durMs) * 100 : 0;

  const ganttSegs = segs.map((s, i) => ({
    key: i,
    w: durMs ? Math.max(0.15, (s.ms / durMs) * 100) : 0,
    color: segColor(s.k),
    title: `${s.n} · ${fmtDur(s.ms)}`,
    op: selectedStepIndex != null && selectedStepIndex !== i ? 0.32 : 1,
  }));

  const lmax = Math.max(1, ...segs.map((s) => s.ms));
  // Group steps by API request: a new group starts at each m-type segment
  // that follows a non-m-type segment (model → tool → model cycle)
  let reqGroup = 0;
  const groupSizes: number[] = [];
  const stepRows = segs.map((s, i) => {
    const on = i === selectedStepIndex;
    const prev = segs[i-1];
    if (i === 0 || (s.k === 'm' && prev && prev.k !== 'm')) {
      reqGroup++;
      groupSizes[reqGroup] = 0;
    }
    groupSizes[reqGroup] = (groupSizes[reqGroup] ?? 0) + 1;
    return {
      idx: String(i + 1).padStart(2, '0'),
      name: s.k === 'i' ? s.n || '⏸ 等待'
        : s.k === 'm'
        ? '模型生成 · ' + (s.det?.think ? 'thinking' : s.det?.text ? 'text' : s.det?.calls ? 'tool_use' : '?')
        : s.k === 's' ? '子Agent · ' + (s.n || s.det?.name || '?')
        : '工具 · ' + (s.n || s.det?.name || '?'),
      tag: '',
      color: segColor(s.k),
      durFmt: fmtDur(s.ms),
      barPct: Math.max(2, (s.ms / lmax) * 100),
      bg: on ? STEP_SELECTED.bg : 'transparent',
      border: on ? STEP_SELECTED.border : 'transparent',
      groupStart: i === 0 || (s.k === 'm' && prev && prev.k !== 'm'),
      groupEnd: false,
      groupId: reqGroup,
      groupPos: (groupSizes[reqGroup] ?? 0),
      groupSize: -1,
    };
  });
  // Fill groupSize and groupEnd in a single forward pass
  for (let i = 0; i < stepRows.length; i++) {
    const row = stepRows[i]!;
    const next = stepRows[i + 1];
    row.groupSize = groupSizes[row.groupId] ?? 1;
    row.groupEnd = !next || next.groupId !== row.groupId;
  }

  // Selected step detail
  const selSeg: TimelineSegment | null = selectedStepIndex != null ? (segs[selectedStepIndex] ?? null) : null;

  return (
    <div className="panel" style={{ padding: '20px 22px' }}>
      <div className="section-header">
        <h2>执行时序</h2>
        <span className="helper-text" style={{ fontSize: 11, color: SEMANTIC.textMuted }}>
          总耗时 {fmtDur(durMs)} · {stepCount} 步
        </span>
      </div>

      {/* Summary cards */}
      <div className="four-col">
        <div className="stat-card">
          <div className="stat-value" style={{ fontSize: 18 }}>{fmtDur(durMs)}</div>
          <div className="stat-label">总耗时（墙钟）</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ fontSize: 18, color: STEP_COLORS.model }}>{fmtDur(modelMs)}</div>
          <div className="stat-label">模型生成</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ fontSize: 18, color: STEP_COLORS.tool }}>{fmtDur(execMs)}</div>
          <div className="stat-label">工具/子Agent 执行</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ fontSize: 18 }}>{fmtDur(longestMs)}</div>
          <div className="stat-label">最长步骤 · {longestName}</div>
        </div>
      </div>

      {/* Model vs tool split bar */}
      <div
        style={{
          marginTop: 16,
          display: 'flex',
          height: 9,
          borderRadius: 6,
          overflow: 'hidden',
          background: 'oklch(0.22 0.01 265)',
        }}
      >
        <div style={{ width: `${modelPct}%`, background: STEP_COLORS.model }} />
        <div style={{ width: `${toolPct}%`, background: STEP_COLORS.tool }} />
        <div style={{ width: `${subPct}%`, background: STEP_COLORS.subagent }} />
      </div>
      <div
        style={{
          marginTop: 8,
          display: 'flex',
          gap: 18,
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 10.5,
          color: SEMANTIC.textDesc,
          flexWrap: 'wrap',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: STEP_COLORS.model }} />
          模型生成
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: STEP_COLORS.tool }} />
          工具执行
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: STEP_COLORS.subagent }} />
          子 Agent 等待
        </span>
      </div>

      {/* Gantt sequence */}
      <div
        style={{
          marginTop: 18,
          fontSize: 11.5,
          color: SEMANTIC.textDesc3,
          marginBottom: 8,
        }}
      >
        调用序列（按时间先后，宽度 = 耗时）
      </div>
      <div
        style={{
          display: 'flex',
          width: '100%',
          height: 34,
          borderRadius: 9,
          overflow: 'hidden',
          border: `1px solid ${SEMANTIC.borderBarBg}`,
          background: 'oklch(0.19 0.01 265)',
        }}
      >
        {ganttSegs.map((g, i) => (
          <div
            key={g.key}
            onClick={() => onToggleStep(i)}
            title={g.title}
            style={{
              width: `${g.w}%`,
              background: g.color,
              opacity: g.op,
              cursor: 'pointer',
              borderRight: `1px solid oklch(0.16 0.008 265 / 0.5)`,
              transition: 'opacity .14s ease',
            }}
          />
        ))}
      </div>

      {/* Step list */}
      <div
        style={{
          marginTop: 18,
          fontSize: 11.5,
          color: SEMANTIC.textDesc3,
          marginBottom: 8,
        }}
      >
        步骤明细 · 点击任一步骤查看上下文内容
      </div>
      <div
        className="thin-scrollbar"
        style={{
          maxHeight: 230,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          paddingRight: 4,
        }}
      >
        {stepRows.map((s, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'stretch', minHeight: 28 }}>
            {/* Left group connector — uses border-left + ::before/::after pseudo-elements via nested divs */}
            <div style={{ width: 18, flexShrink: 0, position: 'relative' }}>
              {s.groupSize > 1 && (
                <div style={{
                  position: 'absolute',
                  top: s.groupStart ? 15 : -2,
                  bottom: s.groupEnd ? 11 : -2,
                  left: 6,
                  width: 2,
                  background: 'oklch(0.32 0.014 265)',
                }} />
              )}
              {s.groupSize > 1 && s.groupStart && (
                <div style={{
                  position: 'absolute', top: 14, left: 6,
                  width: 8, height: 2, background: 'oklch(0.32 0.014 265)',
                }} />
              )}
              {s.groupSize > 1 && s.groupEnd && (
                <div style={{
                  position: 'absolute', bottom: 10, left: 6,
                  width: 8, height: 2, background: 'oklch(0.32 0.014 265)',
                }} />
              )}
            </div>
          <div
            onClick={() => onToggleStep(i)}
            className={`step-item${i === selectedStepIndex ? ' selected' : ''}`}
            style={{
              flex: 1,
              background: s.bg || (
                s.groupId % 2 === 0
                  ? 'oklch(0.185 0.008 265 / 0.4)'
                  : 'transparent'
              ),
              borderColor: s.border,
            }}
          >
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10.5,
                color: SEMANTIC.textMuted3,
                width: 22,
                flexShrink: 0,
              }}
            >
              {s.idx}
            </span>
            <span className="step-dot" style={{ background: s.color }} />
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 12,
                color: SEMANTIC.textPrimary6,
                width: 150,
                minWidth: 0,
                flexShrink: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={s.name}
            >
              {s.name}{s.tag}
            </span>
            <div className="step-bar-track">
              <div
                className="step-bar-fill"
                style={{ width: `${s.barPct}%`, background: s.color }}
              />
            </div>
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 11.5,
                fontWeight: 600,
                color: SEMANTIC.textPrimary4,
                width: 64,
                textAlign: 'right',
                flexShrink: 0,
              }}
            >
              {s.durFmt}
            </span>
          </div>
          </div>
        ))}
      </div>

      {/* Step detail panel */}
      <TurnStepDetailPanel seg={selSeg} index={selectedStepIndex} prompt={prompt} />
    </div>
  );
}

// ============================================================================
// Delta Panel
// ============================================================================

interface DeltaPanelProps {
  delta: Record<string, number>;
}

const DELTA_KEYS_ORDER = ['toolResults', 'thinking', 'toolCalls', 'userMsgs', 'asstText', 'subagent'];

export function DeltaPanel({ delta }: DeltaPanelProps) {
  const rows = useMemo(() => {
    const dk = DELTA_KEYS_ORDER.filter((k) => (delta[k] ?? 0) > 0);
    const dmax = Math.max(1, ...dk.map((k) => delta[k]!));
    return dk.map((k) => ({
      key: k,
      label: DELTA_LABELS[k] ?? k,
      color: COLORS[k] ?? 'oklch(0.5 0 0)',
      tokensFmt: fmt(Math.round(delta[k]! * CHARS_PER_TOKEN)) + ' chars',
      barPct: Math.max(3, (delta[k]! / dmax) * 100),
    }));
  }, [delta]);

  return (
    <div className="panel" style={{ padding: '18px 20px' }}>
      <h2 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 600 }}>本轮新增内容</h2>
      <p style={{ margin: '0 0 14px', fontSize: 11.5, color: SEMANTIC.textDesc4, lineHeight: 1.5 }}>
        这一轮向上下文追加了什么
      </p>
      {rows.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          {rows.map((r) => (
            <div key={r.key}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                <span style={{ width: 9, height: 9, borderRadius: 2, background: r.color, flexShrink: 0 }} />
                <span style={{ fontSize: 12.5, flex: 1, color: SEMANTIC.textPrimary4 }}>{r.label}</span>
                <span
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 12,
                    fontWeight: 600,
                    color: SEMANTIC.textPrimary6,
                  }}
                >
                  +{r.tokensFmt}
                </span>
              </div>
              <div style={{ height: 6, borderRadius: 4, background: 'oklch(0.24 0.01 265)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${r.barPct}%`, borderRadius: 4, background: r.color }} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ marginTop: 14, fontSize: 12, color: SEMANTIC.textDesc3 }}>
          本轮未产生明显增量。
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Tool Usage Panel
// ============================================================================

interface ToolUsagePanelProps {
  tools: Record<string, number>;
}

export function ToolUsagePanel({ tools }: ToolUsagePanelProps) {
  const rows = useMemo(() => {
    const tk = Object.keys(tools).sort((a, b) => tools[b]! - tools[a]!);
    const tmax = Math.max(1, ...tk.map((k) => tools[k]!));
    return tk.map((k) => ({
      name: k,
      calls: tools[k]!,
      barPct: Math.max(4, (tools[k]! / tmax) * 100),
      color: isTaskName(k) ? STEP_COLORS.subagent : STEP_COLORS.tool,
      tag: isTaskName(k) ? ' · 子Agent' : '',
    }));
  }, [tools]);

  const total = rows.reduce((a, r) => a + r.calls, 0);

  return (
    <div className="panel" style={{ padding: '18px 20px' }}>
      <h2 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 600 }}>本轮调用的工具</h2>
      <p style={{ margin: '0 0 14px', fontSize: 11.5, color: SEMANTIC.textDesc4, lineHeight: 1.5 }}>
        共 {total} 次调用
      </p>
      {rows.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {rows.map((r) => (
            <div key={r.name} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: r.color, flexShrink: 0 }} />
              <span
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 12.5,
                  fontWeight: 500,
                  color: SEMANTIC.textPrimary5,
                  flex: 1,
                }}
              >
                {r.name}{r.tag}
              </span>
              <div style={{ width: 90, height: 7, borderRadius: 4, background: 'oklch(0.24 0.01 265)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${r.barPct}%`, borderRadius: 4, background: r.color }} />
              </div>
              <span
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 12,
                  fontWeight: 600,
                  color: SEMANTIC.textPrimary6,
                  width: 26,
                  textAlign: 'right',
                }}
              >
                {r.calls}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ marginTop: 14, fontSize: 12, color: SEMANTIC.textDesc3 }}>
          本轮为纯对话，未调用任何工具。
        </div>
      )}
    </div>
  );
}
