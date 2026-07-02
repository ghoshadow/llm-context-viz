import { useMemo, useCallback } from 'react';
import { useSessionStore } from '../../store/sessionStore';
import { useUIStore } from '../../store/uiStore';
import { SEMANTIC } from '../../styles/theme';
import type {
  ContextCategory,
  ToolAggregation,
  SeriesPoint,
} from '../../types/session';
import {
  buildContextAssemblyData,
  type PeakSessionData,
} from './contextAssemblyData';
import {
  ContextAssemblyHeader,
  ContextAssemblyHeroBar,
} from './ContextAssemblyOverview';
import { ContextAssemblyBreakdown } from './ContextAssemblyBreakdown';
import { ContextAssemblyTools } from './ContextAssemblyTools';
import {
  ContextAssemblyFooter,
  ContextAssemblyGrowthSection,
} from './ContextAssemblyGrowthSection';

// ============================================================================
// Main Component
// ============================================================================

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
  const session = (peakData ? peakData.session : sessionFromStore) as PeakSessionData | null;
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

  const derived = useMemo(() => {
    if (!session) return null;
    return buildContextAssemblyData({
      session,
      categories,
      tools,
      series,
      hoveredCategory,
      setHoveredCategory,
    });
  }, [session, categories, tools, series, hoveredCategory, setHoveredCategory]);

  // ==========================================================================
  // Chart hover handler
  // ==========================================================================

  const handleChartHoverAt = useCallback(
    (frac: number) => {
      if (!series.length) return;
      const req = frac * (series[series.length - 1]?.i ?? 510);
      let best = series[0]!;
      let bd = Infinity;
      for (const p of series) {
        const d = Math.abs(p.i - req);
        if (d < bd) { bd = d; best = p; }
      }
      setChartHover({
        req: best.i, assembled: best.assembled,
        input: best.input, output: best.output,
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
      <ContextAssemblyHeader
        derived={derived}
        embedded={embedded}
        isCum={isCum}
        setPage={setPage}
      />
      <ContextAssemblyHeroBar derived={derived} isCum={isCum} />

      <ContextAssemblyBreakdown derived={derived} />

      <ContextAssemblyTools derived={derived} tools={tools} />

      {(!embedded || isCum) && (
        <ContextAssemblyGrowthSection
          chartHover={chartHover}
          derived={derived}
          isCum={isCum}
          onChartHoverAt={handleChartHoverAt}
          onChartMouseLeave={handleChartMouseLeave}
          series={series}
        />
      )}

      {!embedded && (
        <ContextAssemblyFooter derived={derived} />
      )}
      </div>
    </>
  );
}
