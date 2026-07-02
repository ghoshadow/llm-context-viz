import { SEMANTIC, STEP_SELECTED, STEP_COLORS } from '../../../styles/theme';
import { fmtDur } from '../../../utils/format';
import type { TimelineSegment } from '../../../types/session';
import { isTaskName, segColor } from '../turnInspectorLogic';
import { TurnStepDetailPanel } from '../TurnStepDetailPanel';

/** Max height for collapsed content blocks. */
const COLLAPSED_H = 180;

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
