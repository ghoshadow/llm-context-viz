import { useMemo, useCallback } from 'react';
import type { TurnDetail, TurnSummary, TurnDelta, TimelineSegment } from '../../types/session';
import { SEMANTIC } from '../../styles/theme';
import { fmt, fmtK, fmtDate } from '../../utils/format';
import { useUIStore } from '../../store/uiStore';
import ContextStructure from './ContextStructure';
import ExecutionTimeline from './ExecutionTimeline';
import DeltaPanel from './DeltaPanel';
import ToolUsagePanel from './ToolUsagePanel';

// ============================================================================
// Props
// ============================================================================

export interface TurnDetailProps {
  turn: TurnDetail;
  turns: TurnSummary[];
}

// ============================================================================
// JSON parse helpers
// ============================================================================

function parseJSON<T>(raw: string | undefined | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// ============================================================================
// Component
// ============================================================================

export default function TurnDetailPanel({ turn }: TurnDetailProps) {
  const hoveredCategory = useUIStore((s) => s.hoveredCategory);
  const setHoveredCategory = useUIStore((s) => s.setHoveredCategory);
  const selectedStepIndex = useUIStore((s) => s.selectedStepIndex);
  const toggleStep = useUIStore((s) => s.toggleStep);

  // ── Derived from already-parsed turn fields ────────────────────────────
  const comp: Record<string, number> = turn.comp ?? {};
  const delta = turn.delta ?? {};
  const tools: Record<string, number> = turn.tools ?? {};
  const segs: TimelineSegment[] = turn.segs ?? [];
  const longest = turn.longest ?? { k: 'm', n: '', ms: 0 };

  // ── Derived values for prompt+stats header ────────────────────────────
  const selNumFmt = String(turn.turn_index).padStart(2, '0');
  const selTime = fmtDate(turn.timestamp);
  const selReqs = String(turn.asst_reqs);
  const selPeakFmt = fmt(turn.max_input);
  const selOutFmt = fmt(turn.out_tok);
  const selCumFmt = fmt(turn.cum_total);

  // ── Hover helpers for ContextStructure ────────────────────────────────
  const handleHoverCategory = useCallback(
    (key: string | null) => {
      setHoveredCategory(key);
    },
    [setHoveredCategory],
  );

  // ── Step toggle (delegate to UI store) ────────────────────────────────
  const handleToggleStep = useCallback(
    (index: number) => {
      toggleStep(index);
    },
    [toggleStep],
  );

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        position: 'sticky',
        top: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
      }}
    >
      {/* ================================================================== */}
      {/* SECTION 1: Prompt + Stats Header                                   */}
      {/* ================================================================== */}
      <div
        style={{
          border: `1px solid ${SEMANTIC.borderColor}`,
          borderRadius: 16,
          padding: '20px 22px',
          background: SEMANTIC.cardBg,
        }}
      >
        {/* Turn number + timestamp */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 12,
          }}
        >
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 12,
              fontWeight: 600,
              color: SEMANTIC.textAccent,
            }}
          >
            第 {selNumFmt} 轮
          </span>
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              color: SEMANTIC.textMuted2,
            }}
          >
            {selTime}
          </span>
        </div>

        {/* Prompt text */}
        <div
          style={{
            fontSize: 14,
            lineHeight: 1.65,
            color: SEMANTIC.textPrimary5,
            maxHeight: 120,
            overflowY: 'auto',
            whiteSpace: 'pre-wrap',
            background: SEMANTIC.innerCardBg,
            border: `1px solid ${SEMANTIC.borderInput}`,
            borderRadius: 10,
            padding: '12px 14px',
          }}
        >
          {turn.prompt || '(无提示词)'}
        </div>

        {/* 4-stat grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 11,
            marginTop: 15,
          }}
        >
          {/* 模型请求 */}
          <div
            style={{
              border: `1px solid ${SEMANTIC.borderInner}`,
              borderRadius: 11,
              padding: '12px 13px',
              background: SEMANTIC.innerCardBg,
            }}
          >
            <div
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 21,
                fontWeight: 600,
                color: SEMANTIC.textPrimary3,
              }}
            >
              {selReqs}
            </div>
            <div style={{ fontSize: 11, color: SEMANTIC.textDesc4, marginTop: 3 }}>
              模型请求
            </div>
          </div>

          {/* 峰值输入 */}
          <div
            style={{
              border: `1px solid ${SEMANTIC.borderInner}`,
              borderRadius: 11,
              padding: '12px 13px',
              background: SEMANTIC.innerCardBg,
            }}
          >
            <div
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 21,
                fontWeight: 600,
                color: SEMANTIC.textAccent4,
              }}
            >
              {selPeakFmt}
            </div>
            <div style={{ fontSize: 11, color: SEMANTIC.textDesc4, marginTop: 3 }}>
              峰值输入
            </div>
          </div>

          {/* 输出 Token */}
          <div
            style={{
              border: `1px solid ${SEMANTIC.borderInner}`,
              borderRadius: 11,
              padding: '12px 13px',
              background: SEMANTIC.innerCardBg,
            }}
          >
            <div
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 21,
                fontWeight: 600,
                color: 'oklch(0.78 0.10 172)',
              }}
            >
              {selOutFmt}
            </div>
            <div style={{ fontSize: 11, color: SEMANTIC.textDesc4, marginTop: 3 }}>
              输出 Token
            </div>
          </div>

          {/* 累计拼装 */}
          <div
            style={{
              border: `1px solid ${SEMANTIC.borderInner}`,
              borderRadius: 11,
              padding: '12px 13px',
              background: SEMANTIC.innerCardBg,
            }}
          >
            <div
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 21,
                fontWeight: 600,
                color: SEMANTIC.textPrimary3,
              }}
            >
              {selCumFmt}
            </div>
            <div style={{ fontSize: 11, color: SEMANTIC.textDesc4, marginTop: 3 }}>
              累计拼装
            </div>
          </div>
        </div>
      </div>

      {/* ================================================================== */}
      {/* SECTION 2: ContextStructure (stacked bar + legend)                  */}
      {/* ================================================================== */}
      <ContextStructure
        comp={comp}
        cumTotal={turn.cum_total}
        maxInput={turn.max_input}
        hoveredCategory={hoveredCategory}
        onHoverCategory={handleHoverCategory}
      />

      {/* ================================================================== */}
      {/* SECTION 3: ExecutionTimeline                                        */}
      {/* ================================================================== */}
      <ExecutionTimeline
        durMs={turn.dur_ms}
        modelMs={turn.model_ms}
        toolMs={turn.tool_ms}
        subMs={turn.sub_ms}
        stepCount={turn.step_count}
        longest={longest}
        segs={segs}
        selectedStepIndex={selectedStepIndex}
        onSelectStep={handleToggleStep}
      />

      {/* ================================================================== */}
      {/* SECTION 4: Bottom grid (DeltaPanel + ToolUsagePanel)                */}
      {/* ================================================================== */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 18,
        }}
      >
        <DeltaPanel deltas={delta as Record<string, number>} totalCum={turn.cum_total} />
        <ToolUsagePanel tools={tools} />
      </div>
    </div>
  );
}
