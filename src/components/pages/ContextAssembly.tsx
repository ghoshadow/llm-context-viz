import { useMemo, useCallback } from 'react';
import { useSessionStore } from '../../store/sessionStore';
import { useUIStore } from '../../store/uiStore';
import {
  COLORS,
  GROUP_META,
  CHART_COLORS,
  SEMANTIC,
  WINDOW,
} from '../../styles/theme';
import { squarify } from '../../utils/geometry';
import { fmt, fmtK } from '../../utils/format';
import type {
  ContextCategory,
  ToolAggregation,
  SeriesPoint,
} from '../../types/session';

// ============================================================================
// Derived data types for child components
// ============================================================================

export interface BarSegment {
  key: string;
  color: string;
  pct: number;
  op: number;
  onEnter: () => void;
  title: string;
}

export interface TreeCell {
  key: string;
  label: string;
  color: string;
  left: number;
  top: number;
  w: number;
  h: number;
  pctFmt: string;
  labelSize: number;
  labelOp: number;
  valOp: number;
  innerPadV: number;
  innerPadH: number;
  op: number;
  onEnter: () => void;
}

export interface LegendRow {
  key: string;
  label: string;
  color: string;
  tokensFmt: string;
  pctFmt: string;
  barPct: number;
  op: number;
  onEnter: () => void;
  estBadge: string;
}

export interface GroupMember {
  label: string;
  color: string;
  pctFmt: string;
}

export interface GroupCard {
  key: string;
  label: string;
  desc: string;
  accent: string;
  tokensFmt: string;
  pctFmt: string;
  conic: string;
  members: GroupMember[];
}

export interface ToolRow {
  name: string;
  calls: number;
  resultFmt: string;
  barPct: number;
  color: string;
  taskTag: string;
}

// ============================================================================
// Growth Chart sub-component (inline SVG)
// ============================================================================

interface GrowthChartProps {
  series: SeriesPoint[];
  requests: number;
  peakTokens: number;
  peakIndex: number;
  contextLimit: number;
  xUnit?: string;
  chartHover: { req: number; assembled: number; input: number; output: number; total: number } | null;
  onMouseMove: (e: React.MouseEvent<HTMLDivElement>) => void;
  onMouseLeave: () => void;
}

function GrowthChart({
  series,
  peakTokens,
  peakIndex,
  contextLimit,
  requests,
  xUnit,
  chartHover,
  onMouseMove,
  onMouseLeave,
}: GrowthChartProps) {
  const W = 1000;
  const H = 260;
  // Use actual request count for X scale (not hardcoded to 510)
  const IMAX = requests > 0 ? requests : (series.length > 0 ? series[series.length - 1]!.i : 1);
  // VMAX: accommodate the assembled line (cumulative) + single-request peak
  const maxAssembled = series.length > 0 ? Math.max(...series.map(p => p.assembled)) : 0;
  const VMAX = Math.max(contextLimit, maxAssembled * 1.05, peakTokens * 1.15);

  const X = (i: number) => (i / IMAX) * W;
  const Y = (v: number) => H - (v / VMAX) * H;

  // Compute paths (guard against empty series on initial render)
  let asmPath = '';
  let inpPath = '';
  let outPath = '';
  let totPath = '';
  let areaPath = '';
  if (series.length > 0) {
    for (let k = 0; k < series.length; k++) {
      const p = series[k]!;
      const cmd = k === 0 ? 'M' : 'L';
      const total = p.input + p.output;
      asmPath += `${cmd}${X(p.i).toFixed(2)} ${Y(p.assembled).toFixed(2)} `;
      inpPath += `${cmd}${X(p.i).toFixed(2)} ${Y(p.input).toFixed(2)} `;
      outPath += `${cmd}${X(p.i).toFixed(2)} ${Y(p.output).toFixed(2)} `;
      totPath += `${cmd}${X(p.i).toFixed(2)} ${Y(total).toFixed(2)} `;
    }
    const lastX = X(series[series.length - 1]!.i);
    const firstX = X(series[0]!.i);
    areaPath = asmPath + `L${lastX.toFixed(2)} ${H} L${firstX.toFixed(2)} ${H} Z`;
  }

  const refY = Y(contextLimit);

  const guideOp = chartHover ? 1 : 0;
  const guideX = chartHover ? (chartHover.req / IMAX) * W : 0;
  const tipLeft = chartHover
    ? Math.max(7, Math.min(93, (chartHover.req / IMAX) * 100))
    : 50;

  return (
    <div
      style={{
        position: 'relative',
        marginTop: 18,
      }}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{
          width: '100%',
          height: 300,
          display: 'block',
          overflow: 'visible',
        }}
      >
        {/* Assembled area + line */}
        <path d={areaPath} fill={`${CHART_COLORS.assembled} / 0.13`} />
        <path
          d={asmPath}
          fill="none"
          stroke={CHART_COLORS.assembled}
          strokeWidth={2.2}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
        />
        {/* Input line */}
        <path
          d={inpPath}
          fill="none"
          stroke={CHART_COLORS.billed}
          strokeWidth={1.4}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          opacity={0.85}
        />
        {/* Output line */}
        <path
          d={outPath}
          fill="none"
          stroke={CHART_COLORS.output}
          strokeWidth={1.2}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          opacity={0.85}
        />
        {/* Total line */}
        <path
          d={totPath}
          fill="none"
          stroke={CHART_COLORS.total}
          strokeWidth={1.2}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          opacity={0.85}
        />
        {/* Data point markers */}
        {series.map((p, k) => (
          <g key={k}>
            <circle cx={X(p.i)} cy={Y(p.assembled)} r={3.5}
              fill={CHART_COLORS.assembled} stroke="oklch(0.16 0.01 265)" strokeWidth={1}
              vectorEffect="non-scaling-stroke" />
            <circle cx={X(p.i)} cy={Y(p.input)} r={2.5}
              fill={CHART_COLORS.billed} stroke="oklch(0.16 0.01 265)" strokeWidth={0.8}
              vectorEffect="non-scaling-stroke" opacity={0.85} />
            <circle cx={X(p.i)} cy={Y(p.output)} r={2}
              fill={CHART_COLORS.output} stroke="oklch(0.16 0.01 265)" strokeWidth={0.8}
              vectorEffect="non-scaling-stroke" opacity={0.85} />
          </g>
        ))}
        {/* Reference line for context limit — rendered last to appear on top */}
        <line
          x1={0}
          y1={refY}
          x2={W}
          y2={refY}
          stroke={CHART_COLORS.refLine}
          strokeWidth={1.5}
          strokeDasharray="5 5"
          vectorEffect="non-scaling-stroke"
        />
        {/* Peak request marker */}
        <line
          x1={X(peakIndex)}
          y1={0}
          x2={X(peakIndex)}
          y2={H}
          stroke={CHART_COLORS.assembled}
          strokeWidth={1}
          strokeDasharray="3 4"
          opacity={0.6}
          vectorEffect="non-scaling-stroke"
        />
        {/* Vertical guide line */}
        <line
          x1={guideX}
          y1={0}
          x2={guideX}
          y2={H}
          stroke={SEMANTIC.textPrimary}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          opacity={guideOp}
        />
      </svg>

      {/* Y-axis labels */}
      <span
        style={{
          position: 'absolute',
          left: 0,
          top: `${((1 - contextLimit / VMAX) * 100).toFixed(2)}%`,
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 10,
          color: CHART_COLORS.refLine,
          transform: 'translateY(-50%)',
          background: SEMANTIC.cardBg,
          paddingRight: 4,
        }}
      >
        {fmtK(contextLimit)} 窗口
      </span>
      <span
        style={{
          position: 'absolute',
          left: 0,
          top: `${((1 - 100000 / VMAX) * 100).toFixed(2)}%`,
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 10,
          color: SEMANTIC.textMuted3,
          transform: 'translateY(-50%)',
          background: SEMANTIC.cardBg,
          paddingRight: 4,
        }}
      >
        100K
      </span>

      {/* Tooltip */}
      <div
        style={{
          position: 'absolute',
          top: 8,
          left: `${tipLeft}%`,
          transform: 'translateX(-50%)',
          pointerEvents: 'none',
          opacity: guideOp,
          transition: 'opacity .12s',
          background: 'oklch(0.26 0.012 265)',
          border: `1px solid ${SEMANTIC.borderTip}`,
          borderRadius: 9,
          padding: '8px 11px',
          fontFamily: "'IBM Plex Mono', monospace",
          whiteSpace: 'nowrap',
          boxShadow: `0 8px 24px oklch(0 0 0 / 0.4)`,
        }}
      >
        <div
          style={{
            fontSize: 10,
            color: SEMANTIC.textMuted2,
            marginBottom: 4,
          }}
        >
          {xUnit ?? '请求'} #{chartHover?.req ?? ''}
        </div>
        <div style={{ fontSize: 11.5, color: CHART_COLORS.assembled }}>
          已拼装 {chartHover ? fmt(chartHover.assembled) : ''}
        </div>
        <div style={{ fontSize: 11.5, color: CHART_COLORS.billed }}>
          输入 {chartHover ? fmt(chartHover.input) : ''}
        </div>
        <div style={{ fontSize: 11.5, color: CHART_COLORS.output }}>
          输出 {chartHover ? fmt(chartHover.output) : ''}
        </div>
        <div style={{ fontSize: 11.5, color: CHART_COLORS.total }}>
          总 {chartHover ? fmt(chartHover.total) : ''}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

interface PeakSessionData {
  model: string;
  version: string;
  cwd: string;
  total_requests: number;
  peak_index: number;
  peak_tokens: number;
  context_limit: number;
  peak_cache_hit?: number;
  peak_turn_idx?: number;
  peak_step?: number;
  total_output?: number;
}

interface PeakDataProps {
  peakData?: {
    session: PeakSessionData;
    categories: ContextCategory[];
    tools: ToolAggregation[];
    series?: SeriesPoint[];
  };
  embedded?: boolean;
  mode?: 'peak' | 'cumulative';
}

export default function ContextAssembly({ peakData, embedded, mode }: PeakDataProps = {}) {
  const isCum = mode === 'cumulative';
  const sessionFromStore = useSessionStore((s) => s.currentSession);
  const session = (peakData ? peakData.session : sessionFromStore) as PeakSessionData | any;
  const setPage = useUIStore((s) => s.setPage);
  const hoveredCategory = useUIStore((s) => s.hoveredCategory);
  const setHoveredCategory = useUIStore((s) => s.setHoveredCategory);
  const chartHover = useUIStore((s) => s.chartHover);
  const setChartHover = useUIStore((s) => s.setChartHover);

  const categories: ContextCategory[] = useMemo(
    () => peakData?.categories ?? session?.categories ?? [],
    [peakData?.categories, session?.categories],
  );
  const tools: ToolAggregation[] = useMemo(
    () => peakData?.tools ?? session?.tools ?? [],
    [peakData?.tools, session?.tools],
  );
  const series: SeriesPoint[] = useMemo(
    () => peakData?.series ?? session?.series ?? [],
    [peakData?.series, session?.series],
  );

  // ==========================================================================
  // Compute all derived values (matches prototype algorithms exactly)
  // ==========================================================================

  const derived = useMemo(() => {
    if (!session) return null;

    const model = session.model || 'unknown';
    const version = session.version || '0.0.0';
    const cwd = session.cwd || '';
    const requests = session.total_requests;
    const peakIndex = session.peak_index;
    const peakTokens = session.peak_tokens;
    const contextLimit = session.context_limit || WINDOW;

    const CATSUM = categories.reduce((a, c) => a + c.tokens, 0) || 1;

    // Hover helpers
    const opFor = (k: string) => (hoveredCategory && hoveredCategory !== k ? 0.26 : 1);
    const setH: Record<string, () => void> = {};
    categories.forEach((c) => {
      setH[c.key] = () => setHoveredCategory(c.key);
    });

    // ── Hero bar segments (scaled to context window) ──
    const barSegments: BarSegment[] = categories.map((c) => ({
      key: c.key,
      color: COLORS[c.key] ?? 'oklch(0.5 0 0)',
      pct: (c.tokens / contextLimit) * 100,
      op: opFor(c.key),
      onEnter: setH[c.key]!,
      title: `${c.label} — ${fmt(c.tokens)} tok`,
    }));
    const freePct = Math.max(0, ((contextLimit - CATSUM) / contextLimit) * 100);

    // ── Legend rows (share of peak) ──
    const maxTok = categories[0]?.tokens ?? 1;
    const legendRows: LegendRow[] = categories.map((c) => ({
      key: c.key,
      label: c.label,
      color: COLORS[c.key] ?? 'oklch(0.5 0 0)',
      tokensFmt: fmt(c.tokens) + ' tok',
      pctFmt: ((c.tokens / CATSUM) * 100).toFixed(2) + '%',
      barPct: (c.tokens / maxTok) * 100,
      op: opFor(c.key),
      onEnter: setH[c.key]!,
      estBadge: c.estimated ? '估算' : '',
    }));

    // ── Treemap cells ──
    const cellResults = squarify(
      categories.map((c) => ({ key: c.key, value: c.tokens, label: c.label })),
      100,
      100,
    );

    const treeCells: TreeCell[] = cellResults.map((cr) => {
      const key = cr.item.key as string;
      const label = (cr.item.label as string) ?? key;
      const big = cr.w > 16 && cr.h > 16;
      const med = cr.w > 9 && cr.h > 11;
      const tiny = cr.w < 6 || cr.h < 6;
      // Padding that scales with cell size to prevent tiny cells from bleeding
      const innerPadV = tiny ? 1 : big ? 9 : 4;
      const innerPadH = tiny ? 2 : big ? 10 : 5;
      return {
        key,
        label,
        color: COLORS[key] ?? 'oklch(0.5 0 0)',
        left: cr.left,
        top: cr.top,
        w: cr.w,
        h: cr.h,
        pctFmt: ((cr.value / CATSUM) * 100).toFixed(2) + '%',
        labelSize: cr.w > 30 ? 14 : big ? 12 : tiny ? 8 : 11,
        labelOp: med ? 1 : 0,
        valOp: cr.w > 11 && cr.h > 9 ? 1 : 0,
        innerPadV,
        innerPadH,
        op: opFor(key),
        onEnter: setH[key]!,
      };
    });

    // ── Three groups (io, convo, core) ──
    const order = ['io', 'convo', 'core'] as const;
    const groups: GroupCard[] = order.map((gk) => {
      const mem = categories
        .filter((c) => c.group === gk)
        .sort((a, b) => b.tokens - a.tokens);
      const gtot = mem.reduce((a, c) => a + c.tokens, 0);
      const gtotSafe = gtot || 1;
      let acc = 0;
      const stops = mem.map((c) => {
        const a0 = (acc / gtotSafe) * 100;
        acc += c.tokens;
        const a1 = (acc / gtotSafe) * 100;
        return `${COLORS[c.key] ?? 'oklch(0.5 0 0)'} ${a0.toFixed(2)}% ${a1.toFixed(2)}%`;
      });

      const meta = GROUP_META[gk] ?? {
        label: gk,
        desc: '',
        accent: 'oklch(0.5 0 0)',
      };

      return {
        key: gk,
        label: meta.label,
        desc: meta.desc,
        accent: meta.accent,
        tokensFmt: fmt(gtot) + ' tok',
        pctFmt: ((gtot / CATSUM) * 100).toFixed(2) + '%',
        conic: `conic-gradient(${stops.join(',')})`,
        members: mem.map((c) => ({
          label: c.label,
          color: COLORS[c.key] ?? 'oklch(0.5 0 0)',
          pctFmt: ((c.tokens / CATSUM) * 100).toFixed(2) + '%',
        })),
      };
    });

    // ── Tool drilldown ──
    const maxRes = Math.max(...tools.map((t) => t.resultTokens), 1);
    const toolRows: ToolRow[] = tools.map((t) => ({
      name: t.name,
      calls: t.calls,
      resultFmt: fmt(t.resultTokens),
      barPct: (t.resultTokens / maxRes) * 100,
      color: t.task ? 'oklch(0.67 0.15 25)' : 'oklch(0.76 0.13 62)',
      taskTag: t.task ? ' · 子 Agent' : '',
    }));

    // ── Sub-agent stats ──
    const subCat = categories.find((c) => c.key === 'subagent');
    const subAgentPctFmt = subCat
      ? ((subCat.tokens / CATSUM) * 100).toFixed(2) + '%'
      : '0.00%';
    const subAgentTokFmt = subCat ? fmt(subCat.tokens) : '0';

    // ── Growth chart ──
    const requestsFmt = fmt(requests);
    const peakTokensFmt = fmt(peakTokens);
    const peakCacheHit = session.peak_cache_hit ?? 0;
    const peakCacheFmt = fmt(peakCacheHit);
    const peakTurnIdx = session.peak_turn_idx ?? peakIndex;
    const peakStep = session.peak_step ?? 0;
    const contextLimitFmt = fmtK(contextLimit);
    const windowPctFmt = ((CATSUM / contextLimit) * 100).toFixed(2) + '%';
    const freeTokensFmt = fmt(Math.max(0, contextLimit - CATSUM));

    return {
      model,
      version,
      cwd,
      requests,
      peakIndex,
      peakTokens,
      contextLimit,
      CATSUM,
      requestsFmt,
      peakTokensFmt,
      peakCacheHit,
      peakTurnIdx,
      peakStep,
      peakCacheFmt,
      contextLimitFmt,
      windowPctFmt,
      freeTokensFmt,
      barSegments,
      freePct,
      legendRows,
      treeCells,
      groups,
      toolRows,
      subAgentPctFmt,
      subAgentTokFmt,
      series,
      clearHover: () => setHoveredCategory(null),
    };
  }, [session, categories, tools, series, hoveredCategory, setHoveredCategory]);

  // ==========================================================================
  // Chart hover handler
  // ==========================================================================

  const handleChartMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!series.length) return;
      const rect = e.currentTarget.getBoundingClientRect();
      let frac = (e.clientX - rect.left) / rect.width;
      frac = Math.max(0, Math.min(1, frac));
      const req = frac * (series[series.length - 1]?.i ?? 510);
      let best = series[0]!;
      let bd = Infinity;
      for (const p of series) {
        const d = Math.abs(p.i - req);
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
      setChartHover({
        req: best.i,
        assembled: best.assembled,
        input: best.input,
        output: best.output,
        total: best.input + best.output,
      });
    },
    [series, setChartHover],
  );

  const handleChartMouseLeave = useCallback(() => {
    setChartHover(null);
  }, [setChartHover]);

  // ==========================================================================
  // Guard: no data yet
  // ==========================================================================

  if (!derived) {
    return (
      <div
        style={{
          textAlign: 'center',
          padding: '120px 20px',
          color: SEMANTIC.textMuted,
          fontSize: 15,
        }}
      >
        正在加载会话数据...
      </div>
    );
  }

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <>
      {embedded && (
        <style>{`
          .sc-embedded { padding: 20px 28px !important; font-size: 0.92em; }
          .sc-embedded h1 { font-size: 24px !important; }
          .sc-embedded h2 { font-size: 13px !important; }
        `}</style>
      )}
      <div className={embedded ? 'sc-embedded' : ''} style={embedded ? { minHeight: 'auto', background: 'transparent', padding: '16px 22px', fontFamily: "'IBM Plex Sans', system-ui, sans-serif", color: 'oklch(0.93 0.006 265)', letterSpacing: '-0.01em' } : undefined}>
      {/* ================================================================ */}
      {/* HEADER                                                           */}
      {/* ================================================================ */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          gap: 24,
          borderBottom: `1px solid ${SEMANTIC.borderColor}`,
          paddingBottom: 22,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ maxWidth: 680 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 12,
            }}
          >
            <div
              style={{
                width: 9,
                height: 9,
                borderRadius: 2,
                background: 'oklch(0.74 0.13 60)',
                boxShadow: '0 0 12px oklch(0.74 0.13 60 / 0.7)',
              }}
            />
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 11,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: SEMANTIC.textDesc6,
              }}
            >
              {isCum ? '累计拼装上下文透视' : '上下文峰值透视'}
            </span>
          </div>
          <h1
            style={{
              margin: 0,
              fontSize: 30,
              fontWeight: 600,
              lineHeight: 1.12,
              letterSpacing: '-0.025em',
            }}
          >
            {isCum ? '累计拼装上下文全貌' : '上下文消耗最大的一次请求'}
          </h1>
          <p
            style={{
              margin: '12px 0 0',
              fontSize: 14.5,
              lineHeight: 1.7,
              color: SEMANTIC.textDesc7,
              maxWidth: 600,
            }}
          >
            {isCum
              ? '从会话开始到本轮结束，上下文窗口中累计拼装的全部内容。随着对话推进，历史内容通过缓存复用，实际计费远低于拼装总量。'
              : <>每一轮对话都会把整个已拼装的上下文重新发送给模型。这里把全会话中<strong style={{ color: SEMANTIC.textPrimary4, fontWeight: 600 }}>最重的一次请求</strong>拆解成各个组成模块 —— 看清输入 Token 究竟花在了哪里。</>}
          </p>
        </div>

        <div
          style={{
            display: 'flex',
            gap: 10,
            fontFamily: "'IBM Plex Mono', monospace",
            flexWrap: 'wrap',
            alignItems: 'stretch',
          }}
        >
          {/* Turn Inspector link */}
          {!embedded && (
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); setPage('home'); }}
              style={{
                textDecoration: 'none', display: 'flex', alignItems: 'center',
                border: `1px solid ${SEMANTIC.borderColor}`, borderRadius: 10,
                padding: '11px 15px', background: SEMANTIC.innerCardBg,
                color: SEMANTIC.textSecondary, fontSize: 12.5, height: 'fit-content',
              }}
            >← 首页</a>
          )}
          {!embedded && (
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); setPage('ontology'); }}
              style={{
                textDecoration: 'none', display: 'flex', alignItems: 'center',
                border: `1px solid ${SEMANTIC.borderColor}`, borderRadius: 10,
                padding: '11px 15px', background: SEMANTIC.innerCardBg,
                color: SEMANTIC.textSecondary, fontSize: 12.5, height: 'fit-content',
              }}
            >本体建模</a>
          )}
          {!embedded && (
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); setPage('inspector'); }}
              style={{
                textDecoration: 'none', display: 'flex', alignItems: 'center',
                border: `1px solid ${SEMANTIC.borderAccent}`, borderRadius: 10,
                padding: '11px 15px', background: 'oklch(0.74 0.13 60 / 0.12)',
                color: SEMANTIC.textAccent2, fontSize: 12.5, height: 'fit-content',
              }}
            >逐轮检查 →</a>
          )}

          {/* Model badge */}
          <div
            style={{
              border: `1px solid ${SEMANTIC.borderColor}`,
              borderRadius: 10,
              padding: '11px 15px',
              background: 'oklch(0.20 0.01 265 / 0.6)',
            }}
          >
            <div
              style={{
                fontSize: 10,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: SEMANTIC.textMiniLabel,
                marginBottom: 5,
              }}
            >
              模型
            </div>
            <div
              style={{
                fontSize: 13.5,
                fontWeight: 500,
                color: SEMANTIC.textPrimary3,
              }}
            >
              {derived.model}
            </div>
          </div>

          {/* Requests badge */}
          <div
            style={{
              border: `1px solid ${SEMANTIC.borderColor}`,
              borderRadius: 10,
              padding: '11px 15px',
              background: 'oklch(0.20 0.01 265 / 0.6)',
            }}
          >
            <div
              style={{
                fontSize: 10,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: SEMANTIC.textMiniLabel,
                marginBottom: 5,
              }}
            >
              请求数
            </div>
            <div
              style={{
                fontSize: 13.5,
                fontWeight: 500,
                color: SEMANTIC.textPrimary3,
              }}
            >
              {derived.requestsFmt}
            </div>
          </div>

          {/* Peak tokens badge */}
          <div
            style={{
              border: `1px solid ${SEMANTIC.borderColor}`,
              borderRadius: 10,
              padding: '11px 15px',
              background: 'oklch(0.20 0.01 265 / 0.6)',
            }}
          >
            <div
              style={{
                fontSize: 10,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: SEMANTIC.textMiniLabel,
                marginBottom: 5,
              }}
            >
              {isCum ? '累计拼装' : '峰值输入'}
            </div>
            <div
              style={{
                fontSize: 13.5,
                fontWeight: 500,
                color: SEMANTIC.textAccent,
              }}
            >
              {derived.peakTokensFmt}
            </div>
          </div>
        </div>
      </header>

      {/* ================================================================ */}
      {/* HERO BAR: Full context window visualization                      */}
      {/* ================================================================ */}
      <section style={{ marginTop: 30 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginBottom: 14,
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 12,
                color: SEMANTIC.textDesc2,
              }}
            >
              {isCum ? `第 ${derived.peakTurnIdx + 1} 轮 · 累计拼装上下文` : `第 ${derived.peakTurnIdx} 轮 · 步骤 #${derived.peakStep + 1} · 当前轮次峰值输入`}
            </span>
          </div>
          <div
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 12.5,
              color: SEMANTIC.textDesc,
            }}
          >
            <span
              style={{
                color: SEMANTIC.textPrimary2,
                fontWeight: 600,
              }}
            >
              {derived.peakTokensFmt}
            </span>{' '}
            / {derived.contextLimitFmt} 窗口 ·{' '}
            <span style={{ color: SEMANTIC.textAccent }}>
              已用 {derived.windowPctFmt}
            </span>
          </div>
        </div>

        {/* The bar = full context window */}
        <div
          onMouseLeave={derived.clearHover}
          style={{
            display: 'flex',
            width: '100%',
            height: 74,
            borderRadius: 12,
            overflow: 'hidden',
            border: `1px solid ${SEMANTIC.borderBarBg}`,
            background: 'oklch(0.19 0.01 265)',
            boxShadow: SEMANTIC.barInsetBoxShadow,
          }}
        >
          {derived.barSegments.map((seg) => (
            <div
              key={seg.key}
              onMouseEnter={seg.onEnter}
              title={seg.title}
              style={{
                width: `${seg.pct}%`,
                background: seg.color,
                opacity: seg.op,
                transition: 'opacity .18s ease',
                cursor: 'default',
                position: 'relative',
                borderRight: `1px solid ${SEMANTIC.barSeparator}`,
              }}
            />
          ))}
          <div
            style={{
              width: `${derived.freePct}%`,
              background: SEMANTIC.freeStripes,
            }}
          />
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: 7,
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 10.5,
            color: SEMANTIC.textMuted3,
          }}
        >
          <span>0</span>
          <span>窗口剩余 {derived.freeTokensFmt}</span>
          <span>{derived.contextLimitFmt}</span>
        </div>
      </section>

      {/* ================================================================ */}
      {/* MAIN GRID: Treemap + Legend                                      */}
      {/* ================================================================ */}
      <section
        style={{
          marginTop: 30,
          display: 'grid',
          gridTemplateColumns: '1.15fr 1fr',
          gap: 22,
          alignItems: 'stretch',
        }}
      >
        {/* ── Treemap ── */}
        <div
          style={{
            border: `1px solid ${SEMANTIC.borderColor}`,
            borderRadius: 16,
            padding: '20px 20px 22px',
            background: SEMANTIC.cardBg,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              marginBottom: 16,
            }}
          >
            <h2
              style={{
                margin: 0,
                fontSize: 15,
                fontWeight: 600,
                letterSpacing: '-0.01em',
              }}
            >
              各模块 Token 占用
            </h2>
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10.5,
                color: SEMANTIC.textDesc5,
              }}
            >
              面积 = Token 数
            </span>
          </div>
          <div
            onMouseLeave={derived.clearHover}
            style={{
              position: 'relative',
              width: '100%',
              height: 330,
              overflow: 'hidden',
              borderRadius: 8,
            }}
          >
            {derived.treeCells.map((c) => (
              <div
                key={c.key}
                onMouseEnter={c.onEnter}
                style={{
                  position: 'absolute',
                  left: `${c.left}%`,
                  top: `${c.top}%`,
                  width: `${c.w}%`,
                  height: `${c.h}%`,
                  padding: 2,
                }}
              >
                <div
                  style={{
                    width: '100%',
                    height: '100%',
                    borderRadius: 7,
                    background: c.color,
                    opacity: c.op,
                    transition: 'opacity .18s ease',
                    padding: `${c.innerPadV}px ${c.innerPadH}px`,
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                  }}
                >
                  <div
                    style={{
                      fontSize: c.labelSize,
                      fontWeight: 600,
                      lineHeight: 1.15,
                      color: 'oklch(0.16 0.02 265)',
                      opacity: c.labelOp,
                    }}
                  >
                    {c.label}
                  </div>
                  <div
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 11,
                      fontWeight: 600,
                      color: 'oklch(0.16 0.02 265 / 0.85)',
                      opacity: c.valOp,
                    }}
                  >
                    {c.pctFmt}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Legend ── */}
        <div
          style={{
            border: `1px solid ${SEMANTIC.borderColor}`,
            borderRadius: 16,
            padding: '20px 22px',
            background: SEMANTIC.cardBg,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              marginBottom: 6,
            }}
          >
            <h2
              style={{
                margin: 0,
                fontSize: 15,
                fontWeight: 600,
              }}
            >
              模块明细
            </h2>
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10.5,
                color: SEMANTIC.textDesc5,
              }}
            >
              占 {derived.peakTokensFmt} 的比例
            </span>
          </div>
          <div
            onMouseLeave={derived.clearHover}
            style={{ display: 'flex', flexDirection: 'column' }}
          >
            {derived.legendRows.map((r) => (
              <div
                key={r.key}
                onMouseEnter={r.onEnter}
                style={{
                  padding: '9px 0',
                  borderBottom: `1px solid ${SEMANTIC.borderSubtle3}`,
                  opacity: r.op,
                  transition: 'opacity .18s ease',
                  cursor: 'default',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                  }}
                >
                  <span
                    style={{
                      width: 11,
                      height: 11,
                      borderRadius: 3,
                      background: r.color,
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      flex: 1,
                    }}
                  >
                    {r.label}
                  </span>
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 11,
                      color: SEMANTIC.textMuted,
                    }}
                  >
                    {r.estBadge}
                  </span>
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: SEMANTIC.textPrimary3,
                      width: 62,
                      textAlign: 'right',
                    }}
                  >
                    {r.tokensFmt}
                  </span>
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 12,
                      color: SEMANTIC.textDesc,
                      width: 50,
                      textAlign: 'right',
                    }}
                  >
                    {r.pctFmt}
                  </span>
                </div>
                <div
                  style={{
                    height: 4,
                    borderRadius: 3,
                    background: 'oklch(0.26 0.01 265)',
                    marginTop: 7,
                    marginLeft: 21,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${r.barPct}%`,
                      background: r.color,
                      borderRadius: 3,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div
            style={{
              marginTop: 14,
              display: 'flex',
              gap: 5,
              alignItems: 'center',
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 10.5,
              color: SEMANTIC.textMuted2,
            }}
          >
            <span
              style={{
                border: `1px solid oklch(0.40 0.012 265)`,
                borderRadius: 4,
                padding: '1px 5px',
              }}
            >
              估算
            </span>
            <span>= 日志中未记录,按典型 schema 大小估算</span>
          </div>
        </div>
      </section>

      {/* ================================================================ */}
      {/* THREE GROUP CARDS: I/O, Conversation, Scaffolding                 */}
      {/* ================================================================ */}
      <section style={{ marginTop: 24 }}>
        <h2
          style={{
            margin: '0 0 16px',
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: SEMANTIC.textDesc2,
          }}
        >
          上下文的三个层次
        </h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 18,
          }}
        >
          {derived.groups.map((g) => (
            <div
              key={g.key}
              style={{
                border: `1px solid ${SEMANTIC.borderColor}`,
                borderRadius: 16,
                padding: 20,
                background: SEMANTIC.cardBg,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                {/* Donut ring */}
                <div
                  style={{
                    position: 'relative',
                    width: 88,
                    height: 88,
                    flexShrink: 0,
                    borderRadius: '50%',
                    background: g.conic,
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      inset: 13,
                      borderRadius: '50%',
                      background: SEMANTIC.donutCenter,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <div
                      style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: 15,
                        fontWeight: 600,
                        color: g.accent,
                      }}
                    >
                      {g.pctFmt}
                    </div>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>
                    {g.label}
                  </div>
                  <div
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 12,
                      color: SEMANTIC.textSecondary,
                      marginTop: 3,
                    }}
                  >
                    {g.tokensFmt} tok
                  </div>
                  <div
                    style={{
                      fontSize: 11.5,
                      color: SEMANTIC.textDesc4,
                      marginTop: 5,
                      lineHeight: 1.35,
                    }}
                  >
                    {g.desc}
                  </div>
                </div>
              </div>
              <div
                style={{
                  marginTop: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 7,
                }}
              >
                {g.members.map((m) => (
                  <div
                    key={m.label}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: 12,
                    }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 2,
                        background: m.color,
                        flexShrink: 0,
                      }}
                    />
                    <span
                      style={{ flex: 1, color: 'oklch(0.80 0.01 265)' }}
                    >
                      {m.label}
                    </span>
                    <span
                      style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: 11,
                        color: SEMANTIC.textMiniLabel,
                      }}
                    >
                      {m.pctFmt}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ================================================================ */}
      {/* TOOL SECTION: Tool drilldown + Sub-agent stats                   */}
      {/* ================================================================ */}
      <section
        style={{
          marginTop: 30,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 22,
          alignItems: 'start',
        }}
      >
        {/* ── Tool I/O Drilldown ── */}
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
              alignItems: 'flex-start',
              gap: 12,
              marginBottom: 4,
            }}
          >
            <h2
              style={{
                margin: 0,
                fontSize: 15,
                fontWeight: 600,
                whiteSpace: 'nowrap',
              }}
            >
              深入"工具结果"
            </h2>
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10.5,
                color: SEMANTIC.textDesc5,
                flexShrink: 0,
                textAlign: 'right',
                paddingTop: 3,
              }}
            >
              单一最大模块
            </span>
          </div>
          <p
            style={{
              margin: '4px 0 16px',
              fontSize: 12.5,
              color: SEMANTIC.textDesc3,
              lineHeight: 1.6,
            }}
          >
            截至本轮/本步，已累计回传的所有工具输出。即使当前步骤本身不调用工具，前面步骤的工具结果仍然留在上下文中。
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
            {derived.toolRows.map((t) => (
              <div key={t.name}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 9,
                    marginBottom: 5,
                  }}
                >
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: SEMANTIC.textPrimary3,
                      width: 420,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={t.name}
                  >
                    {t.name}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      color: SEMANTIC.textMuted,
                      flex: 1,
                      textAlign: 'right',
                    }}
                  >
                    {t.calls} 次调用{t.taskTag}
                    {' · '}
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, color: SEMANTIC.textPrimary5 }}>
                      {t.resultFmt}
                    </span>
                    {' tok'}
                  </span>
                </div>
                <div
                  style={{
                    height: 9,
                    borderRadius: 5,
                    background: 'oklch(0.24 0.01 265)',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${t.barPct}%`,
                      borderRadius: 5,
                      background: t.color,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Sub-agent callout ── */}
        <div
          style={{
            border: `1px solid ${SEMANTIC.borderColor}`,
            borderRadius: 16,
            padding: 22,
            background: SEMANTIC.cardBg,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <h2
            style={{
              margin: '0 0 4px',
              fontSize: 15,
              fontWeight: 600,
            }}
          >
            子 Agent（Task）
          </h2>
          <p
            style={{
              margin: '4px 0 18px',
              fontSize: 12.5,
              color: SEMANTIC.textDesc3,
              lineHeight: 1.6,
            }}
          >
            被生成的工作者运行在自己独立的上下文窗口中。只有它们
            <em style={{ color: SEMANTIC.textPrimary7 }}>
              提炼后的输出
            </em>
            会返回给主 Agent —— 这就是为什么它们虽然干了重活,在这里却占用极小。
          </p>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <div
              style={{
                flex: 1,
                minWidth: 120,
                border: `1px solid ${SEMANTIC.borderColor}`,
                borderRadius: 12,
                padding: 15,
                background: 'oklch(0.20 0.01 265 / 0.5)',
              }}
            >
              <div
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 24,
                  fontWeight: 600,
                  color: 'oklch(0.67 0.15 25)',
                }}
              >
                {derived.subAgentPctFmt}
              </div>
              <div
                style={{
                  fontSize: 11.5,
                  color: SEMANTIC.textDesc3,
                  marginTop: 4,
                }}
              >
                占本次请求
              </div>
            </div>
            <div
              style={{
                flex: 1,
                minWidth: 120,
                border: `1px solid ${SEMANTIC.borderColor}`,
                borderRadius: 12,
                padding: 15,
                background: 'oklch(0.20 0.01 265 / 0.5)',
              }}
            >
              <div
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 24,
                  fontWeight: 600,
                  color: SEMANTIC.textPrimary3,
                }}
              >
                {derived.subAgentTokFmt}
              </div>
              <div
                style={{
                  fontSize: 11.5,
                  color: SEMANTIC.textDesc3,
                  marginTop: 4,
                }}
              >
                注入的 Token
              </div>
            </div>
          </div>
          <div
            style={{
              marginTop: 16,
              borderTop: `1px solid ${SEMANTIC.borderSubtle2}`,
              paddingTop: 14,
              fontSize: 12,
              color: SEMANTIC.textDesc,
              lineHeight: 1.6,
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 14,
                whiteSpace: 'nowrap',
              }}
            >
              <span>创建的工作者</span>
              <span
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  color: SEMANTIC.textPrimary5,
                }}
              >
                {tools.filter((t) => t.task).length}
              </span>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 14,
                whiteSpace: 'nowrap',
                marginTop: 6,
              }}
            >
              <span>拉取的输出摘要</span>
              <span
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  color: SEMANTIC.textPrimary5,
                }}
              >
                {tools
                  .filter((t) => t.task)
                  .reduce((sum, t) => sum + t.calls, 0)}
              </span>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 14,
                whiteSpace: 'nowrap',
                marginTop: 6,
              }}
            >
              <span>相比内联的压缩</span>
              <span
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  color: SEMANTIC.textGreen2,
                }}
              >
                高
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ================================================================ */}
      {/* GROWTH CHART: Context growth over session                        */}
      {/* ================================================================ */}
      {(!embedded || isCum) && (
      <section
        style={{
          marginTop: 30,
          border: `1px solid ${SEMANTIC.borderColor}`,
          borderRadius: 16,
          padding: '22px 24px 18px',
          background: SEMANTIC.cardBg,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            flexWrap: 'wrap',
            gap: '10px 24px',
          }}
        >
          <div style={{ flex: 1, minWidth: 300, maxWidth: 620 }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
              {isCum
                ? `${series.length} 轮对话中的上下文增长`
                : `${derived.requestsFmt} 次请求中的上下文增长`}
            </h2>
            <p
              style={{
                margin: '5px 0 0',
                fontSize: 12.5,
                color: SEMANTIC.textDesc3,
              }}
            >
              {isCum
                ? '累计拼装 token 逐轮累积，上下文压缩后重置并从零重新增长。'
                : '累计拼装的内容持续上升 —— 缓存使得每次请求实际'}
              {!isCum && (<em>计费</em>)}
              {!isCum && '的 Token 保持低而尖岭。'}
            </p>
          </div>
          <div
            style={{
              display: 'flex',
              gap: 16,
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
            }}
          >
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                color: SEMANTIC.textSecondary,
              }}
            >
              <span
                style={{
                  width: 14,
                  height: 3,
                  borderRadius: 2,
                  background: CHART_COLORS.assembled,
                }}
              />
              已拼装（累计）
            </span>
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                color: SEMANTIC.textSecondary,
              }}
            >
              <span
                style={{
                  width: 14,
                  height: 3,
                  borderRadius: 2,
                  background: CHART_COLORS.billed,
                }}
              />
              输入 token
            </span>
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                color: SEMANTIC.textSecondary,
              }}
            >
              <span
                style={{
                  width: 14,
                  height: 3,
                  borderRadius: 2,
                  background: CHART_COLORS.output,
                }}
              />
              输出 token
            </span>
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                color: SEMANTIC.textSecondary,
              }}
            >
              <span
                style={{
                  width: 14,
                  height: 3,
                  borderRadius: 2,
                  background: CHART_COLORS.total,
                }}
              />
              总 token
            </span>
          </div>
        </div>

        <GrowthChart
          series={derived.series}
          requests={isCum ? series.length : derived.requests}
          peakTokens={derived.peakTokens}
          peakIndex={isCum ? (series.length > 0 ? series[series.length - 1]!.i : 0) : derived.peakIndex}
          contextLimit={derived.contextLimit}
          xUnit={isCum ? '轮' : undefined}
          chartHover={chartHover}
          onMouseMove={handleChartMouseMove}
          onMouseLeave={handleChartMouseLeave}
        />

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: 8,
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 10,
            color: SEMANTIC.textMuted3,
          }}
        >
          <span>{isCum ? '轮' : 'req'} 0</span>
          <span>{isCum ? '轮' : 'req'} {Math.floor((isCum ? derived.series.length : derived.requests) / 2)}</span>
          <span>{isCum ? '轮' : 'req'} {isCum ? derived.series.length : derived.requests}</span>
        </div>
      </section>
      )}

      {/* ================================================================ */}
      {/* FOOTER                                                            */}
      {/* ================================================================ */}
      {!embedded && (
      <footer
        style={{
          marginTop: 26,
          display: 'flex',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 10.5,
          color: SEMANTIC.textMuted4,
          lineHeight: 1.6,
        }}
      >
        <span>
          Token 数量按 ~3.0 字符/token 估算（DeepSeek 官方：英文 3.33 / 中文 1.67） · {derived.cwd} · v{derived.version}
        </span>
        <span>
          标"估算"的模块（系统提示词 · 工具 schema）为近似值 —— 日志中未记录
        </span>
      </footer>
      )}
      </div>
    </>
  );
}
