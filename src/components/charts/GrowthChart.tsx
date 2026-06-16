import { useRef, useCallback, useState } from 'react';
import type { SeriesPoint } from '../../types/session';
import { CHART_COLORS } from '../../styles/theme';
import { fmt } from '../../utils/format';

// ============================================================================
// Props
// ============================================================================

export interface GrowthChartProps {
  /** Sampled series points (every 5th request). */
  series: SeriesPoint[];
  /** Reference line Y value (default 200000). */
  contextLimit?: number;
  /** Index of the request with peak context usage. */
  peakIndex: number;
  /** Called when the mouse enters/leaves the chart area or moves within it. */
  onHover: (data: { req: number; assembled: number; billed: number } | null) => void;
}

// ============================================================================
// Chart constants
// ============================================================================

const W = 1000;
const H = 260;
const VMAX = 260000;

/** Y-axis tick values (in token space). */
const Y_TICKS = [0, 100000, 200000, 260000];

// ============================================================================
// SVG coordinate helpers
// ============================================================================

function x(i: number, imax: number): number {
  return (i / imax) * W;
}

function y(v: number): number {
  return H - (v / VMAX) * H;
}

// ============================================================================
// Path building
// ============================================================================

/**
 * Build a polyline path from series[k][field] values.
 * Uses `i` for X and the chosen token field for Y.
 */
function buildLinePath(
  series: SeriesPoint[],
  imax: number,
  field: 'input' | 'output',
): string {
  let d = '';
  for (let k = 0; k < series.length; k++) {
    const pt = series[k]!;
    d += (k === 0 ? 'M' : 'L') + x(pt.i, imax).toFixed(1) + ' ' + y(pt[field]).toFixed(1) + ' ';
  }
  return d;
}

/**
 * Build a filled area path: the assembled (input) line plus bottom-closing
 * segments to form a closed polygon.
 */
function buildAreaPath(series: SeriesPoint[], imax: number): string {
  const last = series[series.length - 1]!;
  const first = series[0]!;
  let d = '';
  // Top edge: follow the assembled line
  for (let k = 0; k < series.length; k++) {
    const pt = series[k]!;
    d += (k === 0 ? 'M' : 'L') + x(pt.i, imax).toFixed(1) + ' ' + y(pt.input).toFixed(1) + ' ';
  }
  // Bottom edge: close along the bottom of the chart
  d += 'L' + x(last.i, imax).toFixed(1) + ' ' + H.toFixed(1) + ' ';
  d += 'L' + x(first.i, imax).toFixed(1) + ' ' + H.toFixed(1) + ' Z';
  return d;
}

// ============================================================================
// Component
// ============================================================================

export default function GrowthChart({
  series,
  contextLimit = 200000,
  peakIndex,
  onHover,
}: GrowthChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [chartHover, setChartHover] = useState<{
    frac: number;
    req: number;
    assembled: number;
    billed: number;
  } | null>(null);

  // ------------------------------------------------------------------
  // Mouse handlers
  // ------------------------------------------------------------------

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!containerRef.current || series.length === 0) return;
      const r = containerRef.current.getBoundingClientRect();
      let frac = (e.clientX - r.left) / r.width;
      frac = Math.max(0, Math.min(1, frac));

      const maxIdx = series[series.length - 1]!.i;
      const req = frac * maxIdx;

      // Find nearest series point by index
      let best = series[0]!;
      let bd = Infinity;
      for (const pt of series) {
        const d = Math.abs(pt.i - req);
        if (d < bd) {
          bd = d;
          best = pt;
        }
      }

      const hov = { frac, req: best.i, assembled: best.input, billed: best.output };
      setChartHover(hov);
      onHover({ req: best.i, assembled: best.input, billed: best.output });
    },
    [series, onHover],
  );

  const handleMouseLeave = useCallback(() => {
    setChartHover(null);
    onHover(null);
  }, [onHover]);

  // ------------------------------------------------------------------
  // Derived values
  // ------------------------------------------------------------------

  const maxIdx = series.length > 0 ? series[series.length - 1]!.i : 1;

  // Display labels for x-axis: always show 0, mid, and max
  const xMid = Math.round(maxIdx / 2);
  const xLabels = [0, xMid, maxIdx];

  // Path strings
  const gAreaPath = buildAreaPath(series, maxIdx);
  const gLinePath = buildLinePath(series, maxIdx, 'input');
  const gInputPath = buildLinePath(series, maxIdx, 'output');

  // Reference line Y position
  const refY = y(Math.min(contextLimit, VMAX));

  // Guide line / tooltip
  const guideOp = chartHover ? 1 : 0;
  const guideX = chartHover ? chartHover.frac * W : 0;
  const tipLeft = chartHover ? Math.max(7, Math.min(93, chartHover.frac * 100)) : 50;

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  return (
    <div style={{ position: 'relative' }}>
      {/* --- Legend swatches --- */}
      <div style={legendRow}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ ...legendSwatch, background: CHART_COLORS.assembled }} />
          <span style={legendLabel}>已拼装（累计）</span>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ ...legendSwatch, background: CHART_COLORS.billed }} />
          <span style={legendLabel}>按请求计费</span>
        </span>
      </div>

      {/* --- Chart area --- */}
      <div
        ref={containerRef}
        style={chartArea}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          style={svgStyle}
        >
          {/* Reference line (dashed, at context limit) */}
          <line
            x1="0"
            y1={refY}
            x2={W}
            y2={refY}
            stroke={CHART_COLORS.refLine}
            strokeWidth="1"
            strokeDasharray="5 5"
            vectorEffect="non-scaling-stroke"
          />

          {/* Filled area under the assembled line */}
          <path d={gAreaPath} fill={`${CHART_COLORS.assembled} / 0.13`} />

          {/* Assembled line (input tokens) */}
          <path
            d={gLinePath}
            fill="none"
            stroke={CHART_COLORS.assembled}
            strokeWidth="2.2"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
          />

          {/* Billed per-request line (output tokens) */}
          <path
            d={gInputPath}
            fill="none"
            stroke={CHART_COLORS.billed}
            strokeWidth="1.4"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            opacity="0.85"
          />

          {/* Vertical guide line */}
          <line
            x1={guideX}
            y1="0"
            x2={guideX}
            y2={H}
            stroke="oklch(0.85 0.01 265)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            opacity={guideOp}
          />
        </svg>

        {/* --- Y-axis labels (absolutely positioned over the SVG) --- */}
        <div style={{ ...yLabelBase, top: '0%' }}>
          260K
        </div>
        <div style={{ ...yLabelBase, top: `${(1 - 200000 / VMAX) * 100}%`, color: 'oklch(0.66 0.10 30)' }}>
          200K ·窗口
        </div>
        <div style={{ ...yLabelBase, top: `${(1 - 100000 / VMAX) * 100}%` }}>
          100K
        </div>
        {/* The 0 tick is omitted — shown by the x-axis labels instead */}

        {/* --- Tooltip --- */}
        <div
          style={{
            ...tooltipStyle,
            left: `${tipLeft}%`,
            opacity: guideOp,
            transition: guideOp ? 'opacity .12s' : 'none',
          }}
        >
          <div style={tooltipHeader}>
            请求 #{chartHover ? chartHover.req : ''}
          </div>
          <div style={{ ...tooltipRow, color: CHART_COLORS.assembled }}>
            已拼装 {chartHover ? fmt(chartHover.assembled) : ''}
          </div>
          <div style={{ ...tooltipRow, color: CHART_COLORS.billed }}>
            计费&nbsp;&nbsp;&nbsp;&nbsp;{chartHover ? fmt(chartHover.billed) : ''}
          </div>
        </div>
      </div>

      {/* --- X-axis labels --- */}
      <div style={xAxisRow}>
        {xLabels.map((val) => (
          <span key={val}>req {val}</span>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Styles (inline objects)
// ============================================================================

const legendRow: React.CSSProperties = {
  display: 'flex',
  gap: 16,
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: 11,
  marginBottom: 12,
};

const legendSwatch: React.CSSProperties = {
  width: 14,
  height: 3,
  borderRadius: 2,
};

const legendLabel: React.CSSProperties = {
  color: 'oklch(0.70 0.012 265)',
};

const chartArea: React.CSSProperties = {
  position: 'relative',
};

const svgStyle: React.CSSProperties = {
  width: '100%',
  height: 300,
  display: 'block',
  overflow: 'visible',
};

const yLabelBase: React.CSSProperties = {
  position: 'absolute',
  left: 0,
  top: 0,
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: 10,
  color: 'oklch(0.50 0.012 265)',
  transform: 'translateY(-50%)',
  background: 'oklch(0.185 0.009 265)',
  paddingRight: 4,
};

const tooltipStyle: React.CSSProperties = {
  position: 'absolute',
  top: 8,
  transform: 'translateX(-50%)',
  pointerEvents: 'none',
  background: 'oklch(0.26 0.012 265)',
  border: '1px solid oklch(0.40 0.014 265)',
  borderRadius: 9,
  padding: '8px 11px',
  fontFamily: "'IBM Plex Mono', monospace",
  whiteSpace: 'nowrap',
  boxShadow: '0 8px 24px oklch(0 0 0 / 0.4)',
};

const tooltipHeader: React.CSSProperties = {
  fontSize: 10,
  color: 'oklch(0.60 0.012 265)',
  marginBottom: 4,
};

const tooltipRow: React.CSSProperties = {
  fontSize: 11.5,
};

const xAxisRow: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  marginTop: 8,
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: 10,
  color: 'oklch(0.50 0.012 265)',
};
