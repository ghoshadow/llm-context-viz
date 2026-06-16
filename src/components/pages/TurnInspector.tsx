import { useEffect, useMemo, useState, useCallback } from 'react';
import { useSessionStore } from '../../store/sessionStore';
import { useUIStore } from '../../store/uiStore';
import {
  COLORS,
  LABELS,
  DELTA_LABELS,
  EST,
  SEMANTIC,
  WINDOW,
  SELECTED_ITEM,
  UNSELECTED_ITEM,
  STEP_SELECTED,
  STEP_COLORS,
  OVERFLOW,
  OK_STATE,
  ERROR_COLOR,
  ERROR_TEXT,
} from '../../styles/theme';
import { fmt, fmtK, fmtDur, fmtDate } from '../../utils/format';
import type { TurnDetail, TimelineSegment, SegmentDetail } from '../../types/session';

// ============================================================================
// Helpers
// ============================================================================

function parseJSON<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function segColor(k: string): string {
  if (k === 'm') return STEP_COLORS.model;
  if (k === 's') return STEP_COLORS.subagent;
  if (k === 'i') return 'oklch(0.62 0.03 265)';
  return STEP_COLORS.tool;
}

function segLabel(k: string, n: string): string {
  if (k === 'm') return '模型生成';
  if (k === 's') return `子Agent · ${n}`;
  if (k === 'i') return n;
  return `工具 · ${n}`;
}

function isTaskName(n: string): boolean {
  return /^Task/.test(n);
}

// ============================================================================
// Sub-components
// ============================================================================

interface TurnListItemProps {
  turnIndex: number;
  turnNum: string;
  asstReqs: number;
  maxInput: number;
  prompt: string;
  maxPeak: number;
  isSelected: boolean;
  onClick: () => void;
}

function TurnListItem({
  turnNum,
  asstReqs,
  maxInput,
  prompt,
  maxPeak,
  isSelected,
  onClick,
}: TurnListItemProps) {
  const loadPct = Math.max(2, (maxInput / maxPeak) * 100);
  const peakColor = maxInput >= 120000 ? 'oklch(0.76 0.13 60)' : SEMANTIC.textDesc2;

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
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {prompt}
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
  hoveredComp: string | null;
  onCompEnter: (key: string) => void;
  onCompLeave: () => void;
}

function ContextStructure({
  comp,
  cumTotal,
  maxInput,
  hoveredComp,
  onCompEnter,
  onCompLeave,
}: ContextStructureProps) {
  const order = useMemo(() => {
    return Object.keys(comp)
      .filter((k) => comp[k]! > 0)
      .sort((a, b) => comp[b]! - comp[a]!);
  }, [comp]);

  const barSegs = order.map((k) => ({
    key: k,
    color: COLORS[k] ?? 'oklch(0.5 0 0)',
    pct: (comp[k]! / cumTotal) * 100,
    op: hoveredComp && hoveredComp !== k ? 0.28 : 1,
    title: `${LABELS[k] ?? k} — ${fmt(comp[k]!)} tok`,
  }));

  const legendRows = order.map((k) => ({
    key: k,
    label: LABELS[k] ?? k,
    color: COLORS[k] ?? 'oklch(0.5 0 0)',
    tokensFmt: fmt(comp[k]!),
    pctFmt: ((comp[k]! / cumTotal) * 100).toFixed(1) + '%',
    estimated: EST.has(k),
    op: hoveredComp && hoveredComp !== k ? 0.28 : 1,
  }));

  const over = cumTotal > WINDOW;
  const overflowNote = over
    ? `累计拼装内容已超过 ${fmtK(WINDOW)} 上下文窗口 —— 实际请求依靠缓存与压缩才能容纳，峰值输入仅 ${fmt(maxInput)} tok。`
    : `本轮峰值输入 ${fmt(maxInput)} tok，占 ${fmtK(WINDOW)} 窗口的 ${((maxInput / WINDOW) * 100).toFixed(0)}%。`;

  return (
    <div
      className="panel"
      style={{ padding: '20px 22px' }}
    >
      <div className="section-header">
        <h2>本轮上下文拼装结构</h2>
        <span className="helper-text" style={{ fontSize: 11, color: SEMANTIC.textMuted }}>
          总计 {fmt(cumTotal)} · 宽度 = 占比
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
            {l.estimated && <span className="legend-badge">估算</span>}
            <span className="legend-tokens" style={{ width: 56, textAlign: 'right' }}>
              {l.tokensFmt}
            </span>
            <span className="legend-pct" style={{ width: 46, textAlign: 'right' }}>
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

function ExecutionTimeline({
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
      <StepDetailPanel seg={selSeg} index={selectedStepIndex} prompt={prompt} />
    </div>
  );
}

// ============================================================================
// Step Detail Panel
// ============================================================================

interface SubAgentInfo {
  file: string;
  model: string;
  prompt: string;
  asstCount: number;
  durMs: number;
  toolCalls: string[];
}

function SubAgentSummary({ subAgents }: { subAgents: SubAgentInfo[] }) {
  return (
    <div className="content-block">
      <div className="block-header">
        <span style={{ width: 7, height: 7, borderRadius: 2, background: 'oklch(0.67 0.15 25)', flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: SEMANTIC.textPrimary4 }}>
          并行子Agent · {subAgents.length} 个
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '6px 0' }}>
        {subAgents.map((sa, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px',
            borderRadius: 6, background: 'oklch(0.185 0.009 265 / 0.5)',
            border: `1px solid ${SEMANTIC.borderSubtle1}`,
          }}>
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'oklch(0.67 0.15 25)', fontWeight: 600, flexShrink: 0, width: 20 }}>
              #{i + 1}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 11.5, fontWeight: 500, color: SEMANTIC.textPrimary3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                {sa.prompt || sa.file.replace('.jsonl','')}
              </span>
              <span style={{ fontSize: 10.5, color: SEMANTIC.textMuted, marginTop: 1, display: 'block' }}>
                {sa.model} · {sa.asstCount} 次调用 · {fmtDur(sa.durMs)} · 工具: {sa.toolCalls.join(', ') || '无'}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function UserPromptSection({ prompt }: { prompt: string }) {
  return (
    <div className="content-block">
      <div className="block-header">
        <span style={{ width: 7, height: 7, borderRadius: 2, background: 'oklch(0.80 0.12 148)', flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: SEMANTIC.textPrimary4 }}>用户输入</span>
      </div>
      <div style={{
        maxHeight: 140, overflowY: 'auto', padding: '10px 12px',
        fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
        fontSize: 13, lineHeight: 1.65, color: SEMANTIC.textPrimary3,
        background: 'oklch(0.20 0.01 265 / 0.5)',
        border: `1px solid ${SEMANTIC.borderSubtle1}`,
        borderRadius: 8, whiteSpace: 'pre-wrap',
      }}>
        {prompt}
      </div>
    </div>
  );
}

interface StepDetailPanelProps {
  prompt: string;
  seg: TimelineSegment | null;
  index: number | null;
}

function StepDetailPanel({ seg, index, prompt }: StepDetailPanelProps) {
  if (!seg || index === null) {
    // Show user prompt even when no step selected
    if (prompt) {
      return (
        <div style={{ marginTop: 16, borderTop: `1px solid ${SEMANTIC.borderSubtle2}`, paddingTop: 16 }}>
          <UserPromptSection prompt={prompt} />
        </div>
      );
    }
    return (
      <div style={{ marginTop: 16, borderTop: `1px solid ${SEMANTIC.borderSubtle2}`, paddingTop: 16 }}>
        <div style={{ fontSize: 12.5, color: SEMANTIC.textDesc4, lineHeight: 1.6 }}>
          点击上方甘特图或步骤列表中的任一时间节点，查看该步骤的上下文内容（思考过程 / 工具调用参数 / 返回结果）。
        </div>
      </div>
    );
  }

  const d: SegmentDetail = seg.det ?? {};
  const SANS = "'IBM Plex Sans', sans-serif";
  const MONO = "'IBM Plex Mono', monospace";

  const tf = (() => {
    const tt = new Date(seg.ts);
    if (isNaN(tt.getTime())) return '';
    return `${String(tt.getHours()).padStart(2, '0')}:${String(tt.getMinutes()).padStart(2, '0')}:${String(tt.getSeconds()).padStart(2, '0')}`;
  })();

  interface Section {
    label: string;
    accent: string;
    font: string;
    meta: string;
    body: string;
    truncTxt: string;
  }

  const sections: Section[] = [];

  if (seg.k === 'm') {
    if (d.think) {
      sections.push({
        label: '思考过程',
        accent: STEP_COLORS.model,
        font: SANS,
        meta: `${fmt(d.thinkTok ?? 0)} tok`,
        body: d.think,
        truncTxt: d.thinkTrunc ? '\n\n…（内容已截断）' : '',
      });
    }
    if (d.text) {
      sections.push({
        label: '回复文本',
        accent: 'oklch(0.74 0.09 200)',
        font: SANS,
        meta: `${fmt(d.textTok ?? 0)} tok`,
        body: d.text,
        truncTxt: d.textTrunc ? '\n\n…（内容已截断）' : '',
      });
    }
    (d.calls ?? []).forEach((c) => {
      sections.push({
        label: `工具调用 · ${c.name}`,
        accent: STEP_COLORS.tool,
        font: MONO,
        meta: `${fmt(c.tok)} tok`,
        body: c.input,
        truncTxt: c.trunc ? '\n\n…（已截断）' : '',
      });
    });
    if (!sections.length) {
      sections.push({
        label: '（无文本内容）',
        accent: ERROR_TEXT,
        font: SANS,
        meta: '',
        body: '该步骤仅包含控制信息。',
        truncTxt: '',
      });
    }
  } else {
    if (d.input) {
      sections.push({
        label: `调用参数 · ${d.name ?? seg.n}`,
        accent: STEP_COLORS.tool,
        font: MONO,
        meta: '',
        body: d.input,
        truncTxt: '',
      });
    }
    sections.push({
      label: d.isError ? '返回结果 · 错误' : '返回结果',
      accent: d.isError ? ERROR_COLOR : STEP_COLORS.tool,
      font: MONO,
      meta: `${fmt(d.resultTok ?? 0)} tok`,
      body: d.result ?? '（空）',
      truncTxt: d.resultTrunc ? '\n\n…（结果已截断）' : '',
    });
  }

  const title = seg.k === 'i' ? seg.n || '等待用户输入'
    : seg.k === 'm'
    ? (d.think ? '模型生成 · thinking' : d.text ? '模型生成 · text' : d.calls ? '模型生成 · tool_use' : '模型生成')
    : `${seg.k === 's' ? '子Agent · ' : '工具 · '}${seg.n}`;

  const tokLine = seg.k === 'm'
    ? `输入 ${fmt(d.inTok ?? 0)} · 输出 ${fmt(d.outTok ?? 0)} tok`
    : `结果 ${fmt(d.resultTok ?? 0)} tok`;

  return (
    <div style={{ marginTop: 16, borderTop: `1px solid ${SEMANTIC.borderSubtle2}`, paddingTop: 16 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
          marginBottom: 13,
        }}
      >
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: SEMANTIC.textMuted3 }}>
          #{String(index + 1).padStart(2, '0')}
        </span>
        <span style={{ width: 9, height: 9, borderRadius: 2, background: segColor(seg.k) }} />
        <span style={{ fontSize: 14.5, fontWeight: 600, color: SEMANTIC.textPrimary2 }}>
          {title}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: SEMANTIC.textDesc3 }}>
          {tf} · 耗时 {fmtDur(seg.ms)} · {tokLine}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* User input section — always shown first */}
        {prompt && <UserPromptSection prompt={prompt} />}
        {/* Sub-agent summary — shown before detail sections when subAgents present */}
        {d.subAgents && d.subAgents.length > 0 && (
          <SubAgentSummary subAgents={d.subAgents} />
        )}
        {sections.map((sec, si) => (
          <div key={si} className="content-block">
            <div className="block-header">
              <span style={{ width: 7, height: 7, borderRadius: 2, background: sec.accent, flexShrink: 0 }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: SEMANTIC.textPrimary4, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={sec.label}>
                {sec.label}
              </span>
              <span style={{ flex: 1 }} />
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: SEMANTIC.textMuted2 }}>
                {sec.meta}
              </span>
            </div>
            <div
              className={`block-body${sec.font === MONO ? ' mono' : ''}`}
              style={{ fontFamily: sec.font }}
            >
              {sec.body}{sec.truncTxt}
            </div>
          </div>
        ))}
      </div>
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

function DeltaPanel({ delta }: DeltaPanelProps) {
  const rows = useMemo(() => {
    const dk = DELTA_KEYS_ORDER.filter((k) => (delta[k] ?? 0) > 0);
    const dmax = Math.max(1, ...dk.map((k) => delta[k]!));
    return dk.map((k) => ({
      key: k,
      label: DELTA_LABELS[k] ?? k,
      color: COLORS[k] ?? 'oklch(0.5 0 0)',
      tokensFmt: fmt(delta[k]!),
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

function ToolUsagePanel({ tools }: ToolUsagePanelProps) {
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

// ============================================================================
// Main TurnInspector Component
// ============================================================================

import PeakModal, { buildCategories } from '../upload/PeakModal';

export default function TurnInspector() {
  const sessionStore = useSessionStore();
  const {
    currentSessionId,
    fetchTurns,
    selectTurn,
    turns,
    turnsLoading,
    currentTurnIndex,
    currentTurn,
    currentTurnLoading,
  } = sessionStore;

  const selectedStepIndex = useUIStore((s) => s.selectedStepIndex);
  const toggleStep = useUIStore((s) => s.toggleStep);
  const [showPeakDetail, setShowPeakDetail] = useState(false);
  const setSelectedStepIndex = useUIStore((s) => s.setSelectedStepIndex);
  const setPage = useUIStore((s) => s.setPage);

  // Local hover state for context bar (not in UI store to keep it scoped)
  const [hoveredComp, setHoveredComp] = useState<string | null>(null);

  // On mount: fetch turns, then auto-select peak turn
  useEffect(() => {
    if (currentSessionId) {
      fetchTurns(currentSessionId);
    }
  }, [currentSessionId, fetchTurns]);

  useEffect(() => {
    if (turns.length > 0 && currentTurnIndex === null) {
      // Auto-select the turn with highest maxInput
      let bestIdx = 0;
      let bestVal = -1;
      turns.forEach((t, i) => {
        const val = t.max_input ?? 0;
        if (val > bestVal) {
          bestVal = val;
          bestIdx = i;
        }
      });
      selectTurn(bestIdx);
    }
  }, [turns, currentTurnIndex, selectTurn]);

  // Reset step selection when turn changes
  useEffect(() => {
    setSelectedStepIndex(null);
  }, [currentTurnIndex, setSelectedStepIndex]);

  const handleCompEnter = useCallback((key: string) => {
    setHoveredComp(key);
  }, []);

  const handleCompLeave = useCallback(() => {
    setHoveredComp(null);
  }, []);

  // Derive values from API data
  const turnDetail = useMemo(() => {
    if (!currentTurn) return null;

    const comp = currentTurn.comp ?? {};
    const delta = currentTurn.delta ?? {};
    const tools = currentTurn.tools ?? {};
    const segs = currentTurn.segs ?? [];
    const longest = currentTurn.longest ?? { k: 'm', n: '', ms: 0 };

    const durMs = currentTurn.dur_ms ?? 0;
    const modelMs = currentTurn.model_ms ?? 0;
    const toolMs = currentTurn.tool_ms ?? 0;
    const subMs = currentTurn.sub_ms ?? 0;
    const stepCount = currentTurn.step_count ?? 0;

    const longestName = longest.k === 'm' ? '模型生成' : longest.n;
    const longestMs = longest.ms ?? 0;

    return {
      comp,
      delta,
      tools,
      segs,
      longestName,
      longestMs,
      durMs,
      modelMs,
      toolMs,
      subMs,
      stepCount,
    };
  }, [currentTurn]);

  // Max peak for list bars
  const maxPeak = useMemo(() => {
    return Math.max(1, ...turns.map((t) => t.max_input ?? 0));
  }, [turns]);

  // Guard: no session
  if (!currentSessionId) {
    return (
      <div
        style={{
          textAlign: 'center',
          padding: '120px 20px',
          color: SEMANTIC.textMuted,
          fontSize: 15,
        }}
      >
        请先选择一个会话
      </div>
    );
  }

  return (
    <>
      {/* ================================================================ */}
      {/* HEADER                                                           */}
      {/* ================================================================ */}
      <header className="header-bar">
        <div style={{ maxWidth: 680 }}>
          <div className="tag">
            <div className="tag-dot" />
            <span className="tag-text">逐轮上下文检查器</span>
          </div>
          <h1>逐轮查看对话的上下文结构</h1>
          <p className="subtitle">
            选择左侧任意一轮对话，查看该轮请求时上下文窗口的拼装结构、本轮新增内容以及调用的工具。
          </p>
        </div>
        <div style={{ display: 'flex', gap: 9, fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setPage('home');
            }}
            style={{
              textDecoration: 'none',
              border: `1px solid ${SEMANTIC.borderColor}`,
              borderRadius: 9,
              padding: '9px 14px',
              color: SEMANTIC.textSecondary,
              background: 'oklch(0.20 0.01 265 / 0.6)',
            }}
          >
            &larr; 首页
          </a>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setPage('assembly');
            }}
            style={{
              textDecoration: 'none',
              border: `1px solid ${SEMANTIC.borderColor}`,
              borderRadius: 9,
              padding: '9px 14px',
              color: SEMANTIC.textSecondary,
              background: 'oklch(0.20 0.01 265 / 0.6)',
            }}
          >
            &larr; 峰值透视
          </a>
          <span
            style={{
              border: `1px solid ${SEMANTIC.borderAccent}`,
              borderRadius: 9,
              padding: '9px 14px',
              color: SEMANTIC.textAccent2,
              background: 'oklch(0.74 0.13 60 / 0.12)',
            }}
          >
            逐轮检查
          </span>
        </div>
      </header>

      {/* ================================================================ */}
      {/* MAIN: list + detail                                              */}
      {/* ================================================================ */}
      <section
        style={{
          marginTop: 26,
          display: 'grid',
          gridTemplateColumns: '360px 1fr',
          gap: 24,
          alignItems: 'start',
        }}
      >
        {/* LEFT: Turn list */}
        <div
          style={{
            border: `1px solid ${SEMANTIC.borderColor}`,
            borderRadius: 16,
            background: SEMANTIC.cardBg,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              padding: '16px 18px 12px',
              borderBottom: `1px solid ${SEMANTIC.borderSubtle2}`,
            }}
          >
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>对话轮次</h2>
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 11,
                color: SEMANTIC.textMuted,
              }}
            >
              共 {turns.length} 轮
            </span>
          </div>

          {turnsLoading ? (
            <div style={{ padding: 40, textAlign: 'center', color: SEMANTIC.textMuted, fontSize: 13 }}>
              加载轮次数列表...
            </div>
          ) : (
            <div
              className="thin-scrollbar"
              style={{
                maxHeight: 760,
                overflowY: 'auto',
                padding: '8px',
                display: 'flex',
                flexDirection: 'column',
                gap: 5,
              }}
            >
              {turns.map((t) => {
                const turnNum = String(t.turn_index).padStart(2, '0');
                const isSelected = t.turn_index === currentTurnIndex;
                return (
                  <TurnListItem
                    key={t.id}
                    turnIndex={t.turn_index}
                    turnNum={turnNum}
                    asstReqs={t.asst_reqs ?? 0}
                    maxInput={t.max_input ?? 0}
                    prompt={t.prompt ?? ''}
                    maxPeak={maxPeak}
                    isSelected={isSelected}
                    onClick={() => selectTurn(t.turn_index)}
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* RIGHT: Detail (sticky) */}
        <div
          style={{
            position: 'sticky',
            top: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
          }}
        >
          {currentTurnLoading ? (
            <div
              className="panel"
              style={{ textAlign: 'center', padding: 80, color: SEMANTIC.textMuted, fontSize: 14 }}
            >
              正在加载轮次详情...
            </div>
          ) : currentTurn && turnDetail ? (
            <>
              {/* Prompt + Stats Card */}
              <div className="panel" style={{ padding: '20px 22px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 12,
                      fontWeight: 600,
                      color: SEMANTIC.textAccent,
                    }}
                  >
                    第 {String(currentTurn.turn_index).padStart(2, '0')} 轮
                  </span>
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 11,
                      color: SEMANTIC.textMuted2,
                    }}
                  >
                    {fmtDate(currentTurn.timestamp)}
                  </span>
                </div>
                <div
                  className="thin-scrollbar"
                  style={{
                    fontSize: 14,
                    lineHeight: 1.65,
                    color: SEMANTIC.textPrimary5,
                    maxHeight: 120,
                    overflowY: 'auto',
                    whiteSpace: 'pre-wrap',
                    background: 'oklch(0.20 0.01 265 / 0.5)',
                    border: `1px solid ${SEMANTIC.borderInput}`,
                    borderRadius: 10,
                    padding: '12px 14px',
                  }}
                >
                  {currentTurn.prompt}
                </div>

                <div className="four-col" style={{ marginTop: 15 }}>
                  <div className="stat-card">
                    <div className="stat-value">{currentTurn.asst_reqs}</div>
                    <div className="stat-label">模型请求</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-value" style={{ color: SEMANTIC.textAccent }}>
                      {fmt(currentTurn.max_input)}
                    </div>
                    <div className="stat-label">
                      峰值输入 · 步骤 #{(currentTurn.max_req_step ?? 0) + 1}
                      <span
                        style={{ marginLeft: 4, color: 'oklch(0.74 0.13 60)', cursor: 'pointer', fontSize: 10, textDecoration: 'underline' }}
                        onClick={(e) => { e.stopPropagation(); setShowPeakDetail(true); }}
                      >查看</span>
                    </div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-value" style={{ color: STEP_COLORS.model }}>
                      {fmt(currentTurn.out_tok)}
                    </div>
                    <div className="stat-label">输出 Token</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-value">{fmt(currentTurn.cum_total)}</div>
                    <div className="stat-label">累计拼装{(currentTurn.max_cache_hit ?? 0) > 0 ? ` · 缓存 ${fmt(currentTurn.max_cache_hit ?? 0)}（${((currentTurn.max_cache_hit! / currentTurn.cum_total) * 100).toFixed(0)}%）` : ''}</div>
                  </div>
                </div>
              </div>

              {/* Context Structure Card */}
              <ContextStructure
                comp={turnDetail.comp}
                cumTotal={currentTurn.cum_total}
                maxInput={currentTurn.max_input}
                hoveredComp={hoveredComp}
                onCompEnter={handleCompEnter}
                onCompLeave={handleCompLeave}
              />

              {/* Execution Timeline Card */}
              <ExecutionTimeline
                durMs={turnDetail.durMs}
                modelMs={turnDetail.modelMs}
                toolMs={turnDetail.toolMs}
                subMs={turnDetail.subMs}
                stepCount={turnDetail.stepCount}
                segs={turnDetail.segs}
                longestName={turnDetail.longestName}
                longestMs={turnDetail.longestMs}
                prompt={currentTurn?.prompt ?? ''}
                selectedStepIndex={selectedStepIndex}
                onToggleStep={toggleStep}
              />

              {/* Bottom grid: Delta + Tools */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
                <DeltaPanel delta={turnDetail.delta} />
                <ToolUsagePanel tools={turnDetail.tools} />
              </div>
            </>
          ) : (
            <div
              className="panel"
              style={{ textAlign: 'center', padding: 80, color: SEMANTIC.textMuted, fontSize: 14 }}
            >
              选择左侧轮次查看详情
            </div>
          )}
        </div>
      </section>

      {/* ================================================================ */}
      {/* FOOTER                                                            */}
      {/* ================================================================ */}
      <footer className="app-footer">
        <span>
          Token 数量按 ~4 字符/token 估算 · "累计拼装"为到该轮为止拼入上下文的内容总量 · 标"估算"的模块为近似值
        </span>
      </footer>

      {/* Peak request detail modal */}
      {showPeakDetail && currentTurn && (
        <PeakModal
          categories={buildCategories(turnDetail?.comp ?? (currentTurn as any).comp ?? {}, Math.max(currentTurn.max_input + (currentTurn.max_cache_hit ?? 0), currentTurn.cum_total), currentTurn.cum_total)}
          tools={Object.entries(turnDetail?.tools ?? (currentTurn as any).tools ?? {}).map(([name, calls]) => ({ name, calls: calls as number, resultTokens: 0, task: name.startsWith('Task') || name === 'Agent' || name === 'Workflow' }))}
          peakTokens={currentTurn.max_input}
          peakIndex={currentTurnIndex ?? 0}
          turnIndex={currentTurn.turn_index ?? currentTurnIndex ?? 0}
          reqStep={currentTurn.max_req_step ?? 0}
          model={sessionStore.currentSession?.model ?? 'unknown'}
          contextLimit={200000}
          cacheHit={currentTurn.max_cache_hit ?? 0}
          fullCtx={Math.max(currentTurn.max_input + (currentTurn.max_cache_hit ?? 0), currentTurn.cum_total)}
          asstReqs={currentTurn.asst_reqs}
          onClose={() => setShowPeakDetail(false)}
        />
      )}
    </>
  );
}
