import { useRef } from 'react';
import { CHART_COLORS, SEMANTIC } from '../../styles/theme';
import { fmt, fmtK } from '../../utils/format';
import type { SeriesPoint } from '../../types/session';

// ============================================================================
// Growth Chart sub-component (inline SVG)
// ============================================================================

interface ContextGrowthChartProps {
  series: SeriesPoint[];
  requests: number;
  peakTokens: number;
  peakIndex: number;
  contextLimit: number;
  xUnit?: string;
  chartHover: { req: number; assembled: number; input: number; output: number; total: number } | null;
  onHoverAt: (frac: number) => void;
  onMouseLeave: () => void;
}

export function ContextGrowthChart({
  series,
  peakTokens,
  peakIndex,
  contextLimit,
  requests,
  xUnit,
  chartHover,
  onHoverAt,
  onMouseLeave,
}: ContextGrowthChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const W = 1000;
  const H = 260;
  // Use actual request count for X scale (not hardcoded to 510)
  const IMAX = requests > 0 ? requests : (series.length > 0 ? series[series.length - 1]!.i : 1);
  // VMAX: accommodate the assembled line (cumulative) + single-request peak
  const maxAssembled = series.length > 0 ? Math.max(...series.map(p => p.assembled)) : 0;
  const rawVmax = Math.max(contextLimit, maxAssembled * 1.05, peakTokens * 1.15);
  const VMAX = Number.isFinite(rawVmax) && rawVmax > 0 ? rawVmax : contextLimit;

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
      onMouseMove={(e) => {
        if (!svgRef.current) return;
        const rect = svgRef.current.getBoundingClientRect();
        const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        onHoverAt(frac);
      }}
      onMouseLeave={onMouseLeave}
    >
      <svg
        ref={svgRef}
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
