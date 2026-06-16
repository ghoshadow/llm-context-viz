import { type CSSProperties } from 'react';
import type { TimelineSegment, SegmentDetail } from '../../types/session';
import {
  SEMANTIC,
  STEP_COLORS,
  OVERFLOW,
  SELECTED_ITEM,
  OK_STATE,
  ERROR_COLOR,
} from '../../styles/theme';
import { fmtDur } from '../../utils/format';

// ============================================================================
// ExecutionTimeline — Gantt chart + step list + step detail drilldown
// Ported from prototype Turn Inspector.dc.html lines 130–218
// ============================================================================

export interface ExecutionTimelineProps {
  segs: TimelineSegment[];
  durMs: number;
  modelMs: number;
  toolMs: number;
  subMs: number;
  stepCount: number;
  longest: { k: string; n: string; ms: number } | null;
  selectedStepIndex: number | null;
  onSelectStep: (index: number) => void;
}

// ─── Segment kind helpers ────────────────────────────────────────────

function segColor(k: string): string {
  if (k === 'm') return STEP_COLORS.model;
  if (k === 's') return STEP_COLORS.subagent;
  return STEP_COLORS.tool;
}

function segLabel(k: string): string {
  if (k === 'm') return '模型生成';
  if (k === 's') return '子 Agent';
  return '工具执行';
}

function segTypeTag(k: string): string {
  if (k === 'm') return '';
  if (k === 's') return ' · 子Agent';
  return ' · 工具';
}

// ─── Detail section type ─────────────────────────────────────────────

interface DetailSection {
  accent: string;
  label: string;
  meta: string;
  body: string;
  font: string;
  mono: boolean;
  truncTxt: string;
}

// ─── Build detail sections per segment type ──────────────────────────

function estTokLabel(tok: number): string {
  if (tok === 0) return '';
  return `约 ${Math.round(tok)} tok`;
}

function buildDetailSections(det: SegmentDetail, k: string): DetailSection[] {
  const sections: DetailSection[] = [];
  const SANS = "'IBM Plex Sans', system-ui, sans-serif";
  const MONO = "'IBM Plex Mono', monospace";

  // ── m-type: thinking, text, tool calls ──
  if (k === 'm') {
    if (det.think) {
      sections.push({
        accent: 'oklch(0.78 0.10 172)',
        label: '思考过程',
        meta: estTokLabel(det.thinkTok ?? 0),
        body: det.think,
        font: SANS,
        mono: false,
        truncTxt: det.thinkTrunc ? '(输出可能被截断)' : '',
      });
    }

    if (det.text) {
      sections.push({
        accent: 'oklch(0.74 0.09 200)',
        label: '回复文本',
        meta: estTokLabel(det.textTok ?? 0),
        body: det.text,
        font: SANS,
        mono: false,
        truncTxt: det.textTrunc ? '(输出可能被截断)' : '',
      });
    }

    if (det.calls) {
      for (const call of det.calls) {
        sections.push({
          accent: STEP_COLORS.tool,
          label: `工具调用 · ${call.name}`,
          meta: estTokLabel(call.tok),
          body: call.input,
          font: MONO,
          mono: true,
          truncTxt: call.trunc ? '(参数可能被截断)' : '',
        });
      }
    }

    // Edge case: no content blocks at all
    if (sections.length === 0) {
      sections.push({
        accent: 'oklch(0.50 0 0)',
        label: '（无文本内容）',
        meta: '',
        body: '该步骤仅包含控制信息。',
        font: SANS,
        mono: false,
        truncTxt: '',
      });
    }
  }

  // ── t-type / s-type: call params + return result ──
  if (k === 't' || k === 's') {
    if (det.name && det.input) {
      sections.push({
        accent: segColor(k),
        label: `调用参数 · ${det.name}`,
        meta: '',
        body: det.input,
        font: MONO,
        mono: true,
        truncTxt: '',
      });
    }

    if (det.result !== undefined && det.result !== null) {
      const isErr = det.isError ?? false;
      sections.push({
        accent: isErr ? ERROR_COLOR : (k === 's' ? STEP_COLORS.subagent : OK_STATE.text),
        label: isErr ? '执行错误' : '返回结果',
        meta: isErr ? '错误' : estTokLabel(det.resultTok ?? 0),
        body: det.result || '（空）',
        font: MONO,
        mono: true,
        truncTxt: det.resultTrunc
          ? `(结果可能被截断)${isErr ? ' · 错误' : ''}`
          : isErr
            ? '· 错误'
            : '',
      });
    }
  }

  return sections;
}

// ─── Format ISO timestamp to "MM-DD HH:MM" ───────────────────────────

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const MM = String(d.getMonth() + 1).padStart(2, '0');
  const DD = String(d.getDate()).padStart(2, '0');
  const HH = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${MM}-${DD} ${HH}:${mm}`;
}

// ============================================================================
// Style objects
// ============================================================================

const S = {
  panel: {
    border: `1px solid ${SEMANTIC.borderColor}`,
    borderRadius: 16,
    padding: '20px 22px',
    background: SEMANTIC.cardBg,
  } as CSSProperties,

  // ── Header ─────────────────────────────────────────────────────────
  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 15,
    flexWrap: 'wrap',
    gap: 6,
  } as CSSProperties,

  headerTitle: {
    margin: 0,
    fontSize: 15,
    fontWeight: 600,
    letterSpacing: '-0.01em',
    color: SEMANTIC.textPrimary,
  } as CSSProperties,

  headerSub: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: SEMANTIC.textMuted,
  } as CSSProperties,

  // ── Stat cards (x4) ────────────────────────────────────────────────
  statGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 11,
  } as CSSProperties,

  statCard: {
    border: `1px solid ${SEMANTIC.borderInner}`,
    borderRadius: 11,
    padding: '12px 13px',
    background: SEMANTIC.innerCardBg,
  } as CSSProperties,

  statValue: (color?: string): CSSProperties => ({
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 18,
    fontWeight: 600,
    color: color ?? SEMANTIC.textPrimary4,
  }),

  statLabel: {
    fontSize: 11,
    color: SEMANTIC.textMiniLabel,
    marginTop: 3,
    whiteSpace: 'nowrap',
  } as CSSProperties,

  // ── Split bar ──────────────────────────────────────────────────────
  splitWrap: {
    marginTop: 16,
  } as CSSProperties,

  splitBar: {
    display: 'flex',
    height: 9,
    borderRadius: 6,
    overflow: 'hidden',
    background: SEMANTIC.barBg3,
  } as CSSProperties,

  splitSeg: (wPct: number, color: string): CSSProperties => ({
    width: `${wPct}%`,
    background: color,
    minWidth: wPct > 0 ? 2 : 0,
  }),

  splitLegend: {
    marginTop: 8,
    display: 'flex',
    gap: 18,
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10.5,
    color: SEMANTIC.textMuted2,
    flexWrap: 'wrap',
  } as CSSProperties,

  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  } as CSSProperties,

  legendDot: (color: string): CSSProperties => ({
    width: 9,
    height: 9,
    borderRadius: 2,
    background: color,
  }),

  // ── Gantt ──────────────────────────────────────────────────────────
  ganttLabel: {
    marginTop: 18,
    fontSize: 11.5,
    color: SEMANTIC.textMiniLabel,
    marginBottom: 8,
  } as CSSProperties,

  ganttBar: {
    display: 'flex',
    width: '100%',
    height: 34,
    borderRadius: 9,
    overflow: 'hidden',
    border: `1px solid ${SEMANTIC.borderBarBg}`,
    background: 'oklch(0.19 0.01 265)',
    boxShadow: SEMANTIC.barInsetBoxShadow,
  } as CSSProperties,

  ganttSeg: (wPct: number, color: string, opacity: number): CSSProperties => ({
    width: `${wPct}%`,
    background: color,
    opacity,
    cursor: 'pointer',
    borderRight: `1px solid ${SEMANTIC.barSeparator2}`,
    transition: 'opacity .14s ease',
    minWidth: wPct > 0.5 ? 1 : 0,
  }),

  // ── Step list ──────────────────────────────────────────────────────
  stepListLabel: {
    marginTop: 18,
    fontSize: 11.5,
    color: SEMANTIC.textMiniLabel,
    marginBottom: 8,
  } as CSSProperties,

  stepList: {
    maxHeight: 230,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    paddingRight: 4,
  } as CSSProperties,

  stepItem: (selected: boolean): CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    cursor: 'pointer',
    padding: '5px 8px',
    borderRadius: 8,
    background: selected ? 'oklch(0.26 0.02 60 / 0.28)' : 'transparent',
    border: `1px solid ${selected ? SELECTED_ITEM.border : 'transparent'}`,
    transition: 'background .12s ease',
  }),

  stepIdx: (selected: boolean): CSSProperties => ({
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10.5,
    color: selected ? SEMANTIC.textAccent3 : SEMANTIC.textMuted4,
    width: 22,
    flexShrink: 0,
  }),

  stepDot: (color: string): CSSProperties => ({
    width: 8,
    height: 8,
    borderRadius: 2,
    background: color,
    flexShrink: 0,
  }),

  stepName: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    color: SEMANTIC.textPrimary5,
    width: 150,
    minWidth: 0,
    flexShrink: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  } as CSSProperties,

  stepBarTrack: {
    flex: 1,
    height: 7,
    borderRadius: 4,
    background: SEMANTIC.barBg,
    overflow: 'hidden',
  } as CSSProperties,

  stepBarFill: (pct: number, color: string): CSSProperties => ({
    height: '100%',
    width: `${pct}%`,
    borderRadius: 4,
    background: color,
  }),

  stepDur: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11.5,
    fontWeight: 600,
    color: SEMANTIC.textPrimary5,
    width: 64,
    textAlign: 'right',
    flexShrink: 0,
  } as CSSProperties,

  // ── Detail panel ───────────────────────────────────────────────────
  detailWrap: {
    marginTop: 16,
    borderTop: `1px solid ${SEMANTIC.borderSubtle}`,
    paddingTop: 16,
  } as CSSProperties,

  detailEmpty: {
    fontSize: 12.5,
    color: SEMANTIC.textMiniLabel,
    lineHeight: 1.6,
  } as CSSProperties,

  detailHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
    marginBottom: 13,
  } as CSSProperties,

  detailNum: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: SEMANTIC.textMuted4,
  } as CSSProperties,

  detailDot: (color: string): CSSProperties => ({
    width: 9,
    height: 9,
    borderRadius: 2,
    background: color,
  }),

  detailTitle: {
    fontSize: 14.5,
    fontWeight: 600,
    color: SEMANTIC.textPrimary2,
  } as CSSProperties,

  detailSpacer: {
    flex: 1,
  } as CSSProperties,

  detailMeta: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: SEMANTIC.textMiniLabel,
  } as CSSProperties,

  detailSections: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  } as CSSProperties,

  // ── Content block (nested in detail) ───────────────────────────────
  contentBlock: {
    border: `1px solid ${SEMANTIC.borderInner}`,
    borderRadius: 10,
    overflow: 'hidden',
  } as CSSProperties,

  blockHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '9px 12px',
    background: SEMANTIC.innerCardBg2,
    borderBottom: `1px solid ${SEMANTIC.borderSubtle4}`,
  } as CSSProperties,

  blockAccent: (accent: string): CSSProperties => ({
    width: 7,
    height: 7,
    borderRadius: 2,
    background: accent,
    flexShrink: 0,
  }),

  blockLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: SEMANTIC.textPrimary5,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  } as CSSProperties,

  blockMeta: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10,
    color: SEMANTIC.textMuted3,
  } as CSSProperties,

  blockSpacer: {
    flex: 1,
  } as CSSProperties,

  blockBody: (mono: boolean): CSSProperties => ({
    maxHeight: 280,
    overflow: 'auto',
    padding: '12px 14px',
    fontFamily: mono
      ? "'IBM Plex Mono', monospace"
      : "'IBM Plex Sans', system-ui, sans-serif",
    fontSize: 12,
    lineHeight: 1.65,
    color: SEMANTIC.textPrimary4,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  }),

  blockTruncWrap: {
    padding: '0 12px 10px',
  } as CSSProperties,

  truncWarning: {
    fontSize: 10.5,
    fontFamily: "'IBM Plex Mono', monospace",
    color: OVERFLOW.text,
    background: OVERFLOW.bg,
    border: `1px solid ${OVERFLOW.border}`,
    borderRadius: 6,
    padding: '4px 10px',
    display: 'inline-block',
  } as CSSProperties,
};

// ============================================================================
// Component
// ============================================================================

export default function ExecutionTimeline({
  segs,
  durMs,
  modelMs,
  toolMs,
  subMs,
  stepCount,
  longest,
  selectedStepIndex,
  onSelectStep,
}: ExecutionTimelineProps) {
  const hasSelection = selectedStepIndex !== null;
  const selectedSeg = hasSelection ? segs[selectedStepIndex!] : null;
  const execMs = toolMs + subMs;

  // ── Summary / split percentages ────────────────────────────────────
  const modelPct = durMs > 0 ? (modelMs / durMs) * 100 : 0;
  const toolPct = durMs > 0 ? (toolMs / durMs) * 100 : 0;
  const subPct = durMs > 0 ? (subMs / durMs) * 100 : 0;

  const longestMs = longest?.ms ?? 0;
  const longestName = longest
    ? (longest.n.length > 18 ? longest.n.slice(0, 16) + '...' : longest.n)
    : '';

  // ── Gantt segments ─────────────────────────────────────────────────
  const ganttSegs = segs.map((seg, i) => ({
    w: durMs > 0 ? Math.max(0.3, (seg.ms / durMs) * 100) : 0,
    color: segColor(seg.k),
    opacity: hasSelection ? (selectedStepIndex === i ? 1 : 0.38) : 1,
    title: `${seg.n} · ${fmtDur(seg.ms)}`,
    idx: i,
  }));

  // ── Step rows ──────────────────────────────────────────────────────
  const longestStepMs = Math.max(1, ...segs.map((s) => s.ms));

  const stepRows = segs.map((seg, i) => ({
    idx: String(i + 1),
    color: segColor(seg.k),
    name: seg.n,
    tag: segTypeTag(seg.k),
    durFmt: fmtDur(seg.ms),
    barPct: (seg.ms / longestStepMs) * 100,
    selected: selectedStepIndex === i,
  }));

  // ── Detail sections ────────────────────────────────────────────────
  const detailSections: DetailSection[] = selectedSeg
    ? buildDetailSections(selectedSeg.det, selectedSeg.k)
    : [];

  const tokLine = selectedSeg
    ? selectedSeg.k === 'm'
      ? selectedSeg.det.inTok !== undefined && selectedSeg.det.outTok !== undefined
        ? `入 ${Math.round(selectedSeg.det.inTok)} · 出 ${Math.round(selectedSeg.det.outTok)} tok`
        : ''
      : selectedSeg.det.resultTok !== undefined && selectedSeg.det.resultTok > 0
        ? `结果 ${Math.round(selectedSeg.det.resultTok)} tok`
        : ''
    : '';

  const timeFmt = selectedSeg ? fmtTime(selectedSeg.ts) : '';

  // ====================================================================
  // Render
  // ====================================================================
  return (
    <div style={S.panel}>
      {/* === Section 1: Header ===================================== */}
      <div style={S.headerRow}>
        <h2 style={S.headerTitle}>执行时序</h2>
        <span style={S.headerSub}>
          总耗时 {fmtDur(durMs)} · {stepCount} 步
        </span>
      </div>

      {/* === Section 2: Four stat cards ============================ */}
      <div style={S.statGrid}>
        <div style={S.statCard}>
          <div style={S.statValue()}>{fmtDur(durMs)}</div>
          <div style={S.statLabel}>总耗时（墙钟）</div>
        </div>
        <div style={S.statCard}>
          <div style={S.statValue(STEP_COLORS.model)}>{fmtDur(modelMs)}</div>
          <div style={S.statLabel}>模型生成</div>
        </div>
        <div style={S.statCard}>
          <div style={S.statValue(STEP_COLORS.tool)}>{fmtDur(execMs)}</div>
          <div style={S.statLabel}>工具/子Agent 执行</div>
        </div>
        <div style={S.statCard}>
          <div style={S.statValue()}>{fmtDur(longestMs)}</div>
          <div style={S.statLabel}>最长步骤 · {longestName}</div>
        </div>
      </div>

      {/* === Section 3: Model/Tool/Sub-agent split bar ============== */}
      <div style={S.splitWrap}>
        <div style={S.splitBar}>
          {modelPct > 0 && <div style={S.splitSeg(modelPct, STEP_COLORS.model)} />}
          {toolPct > 0 && <div style={S.splitSeg(toolPct, STEP_COLORS.tool)} />}
          {subPct > 0 && <div style={S.splitSeg(subPct, STEP_COLORS.subagent)} />}
        </div>
        <div style={S.splitLegend}>
          <span style={S.legendItem}>
            <span style={S.legendDot(STEP_COLORS.model)} />
            模型生成
          </span>
          <span style={S.legendItem}>
            <span style={S.legendDot(STEP_COLORS.tool)} />
            工具执行
          </span>
          <span style={S.legendItem}>
            <span style={S.legendDot(STEP_COLORS.subagent)} />
            子 Agent 等待
          </span>
        </div>
      </div>

      {/* === Section 4: Gantt chart ================================= */}
      <div style={S.ganttLabel}>调用序列（按时间先后，宽度 = 耗时）</div>
      <div style={S.ganttBar}>
        {ganttSegs.map((g) => (
          <div
            key={g.idx}
            onClick={() => onSelectStep(g.idx)}
            title={g.title}
            style={S.ganttSeg(g.w, g.color, g.opacity)}
          />
        ))}
      </div>

      {/* === Section 5: Step list =================================== */}
      <div style={S.stepListLabel}>
        步骤明细 · 点击任一步骤查看上下文内容
      </div>
      <div className="tl thin-scrollbar" style={S.stepList}>
        {stepRows.map((row, i) => (
          <div
            key={i}
            onClick={() => onSelectStep(i)}
            style={S.stepItem(row.selected)}
          >
            <span style={S.stepIdx(row.selected)}>{row.idx}</span>
            <span style={S.stepDot(row.color)} />
            <span style={S.stepName} title={segs[i]?.n}>
              {row.name}{row.tag}
            </span>
            <div style={S.stepBarTrack}>
              <div style={S.stepBarFill(row.barPct, row.color)} />
            </div>
            <span style={S.stepDur}>{row.durFmt}</span>
          </div>
        ))}
      </div>

      {/* === Section 6: Step detail panel =========================== */}
      <div style={S.detailWrap}>
        {!hasSelection && (
          <div style={S.detailEmpty}>选择某步查看详情</div>
        )}

        {hasSelection && selectedSeg && (
          <div>
            {/* Detail header */}
            <div style={S.detailHeader}>
              <span style={S.detailNum}>#{selectedStepIndex! + 1}</span>
              <span style={S.detailDot(segColor(selectedSeg.k))} />
              <span style={S.detailTitle}>
                {selectedSeg.k === 'm' ? '模型生成' : selectedSeg.n}
              </span>
              <span style={S.detailSpacer} />
              <span style={S.detailMeta}>
                {timeFmt} · 耗时 {fmtDur(selectedSeg.ms)}
                {tokLine ? ` · ${tokLine}` : ''}
              </span>
            </div>

            {/* Detail content blocks */}
            <div style={S.detailSections}>
              {detailSections.map((sec, si) => (
                <div key={si} style={S.contentBlock}>
                  <div style={S.blockHeader}>
                    <span style={S.blockAccent(sec.accent)} />
                    <span style={S.blockLabel} title={sec.label}>{sec.label}</span>
                    <span style={S.blockSpacer} />
                    {sec.meta && <span style={S.blockMeta}>{sec.meta}</span>}
                  </div>
                  <div
                    className="tl thin-scrollbar"
                    style={S.blockBody(sec.mono)}
                  >
                    {sec.body}
                  </div>
                  {sec.truncTxt && (
                    <div style={S.blockTruncWrap}>
                      <span style={S.truncWarning}>{sec.truncTxt}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
