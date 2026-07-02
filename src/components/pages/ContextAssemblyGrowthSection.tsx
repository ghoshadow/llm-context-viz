import { CHART_COLORS, SEMANTIC } from '../../styles/theme';
import { CHARS_PER_TOKEN } from '../../pipeline/utils';
import type { SeriesPoint } from '../../types/session';
import { ContextGrowthChart } from './ContextGrowthChart';
import type { ContextAssemblyData } from './contextAssemblyData';

export function ContextAssemblyGrowthSection({
  chartHover,
  derived,
  isCum,
  onChartHoverAt,
  onChartMouseLeave,
  series,
}: {
  chartHover: { req: number; assembled: number; input: number; output: number; total: number } | null;
  derived: ContextAssemblyData;
  isCum: boolean;
  onChartHoverAt: (frac: number) => void;
  onChartMouseLeave: () => void;
  series: SeriesPoint[];
}) {
  return (
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
          <ChartLegendItem color={CHART_COLORS.assembled} label="已拼装（累计）" />
          <ChartLegendItem color={CHART_COLORS.billed} label="输入 token" />
          <ChartLegendItem color={CHART_COLORS.output} label="输出 token" />
          <ChartLegendItem color={CHART_COLORS.total} label="总 token" />
        </div>
      </div>

      <ContextGrowthChart
        series={derived.series}
        requests={isCum ? series.length : derived.requests}
        peakTokens={derived.peakTokens}
        peakIndex={isCum ? (series.length > 0 ? series[series.length - 1]!.i : 0) : derived.peakIndex}
        contextLimit={derived.contextLimit}
        xUnit={isCum ? '轮' : undefined}
        chartHover={chartHover}
        onHoverAt={onChartHoverAt}
        onMouseLeave={onChartMouseLeave}
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
  );
}

export function ContextAssemblyFooter({
  derived,
}: {
  derived: ContextAssemblyData;
}) {
  return (
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
        Token 数量按 ~{CHARS_PER_TOKEN} 字符/token 估算（DeepSeek 官方：英文 3.33 / 中文 1.67） · {derived.cwd} · v{derived.version}
      </span>
      <span>
        标"估算"的模块（系统提示词 · 工具 schema）为近似值 —— 日志中未记录
      </span>
    </footer>
  );
}

function ChartLegendItem({
  color,
  label,
}: {
  color: string;
  label: string;
}) {
  return (
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
          background: color,
        }}
      />
      {label}
    </span>
  );
}
