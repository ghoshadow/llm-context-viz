import { COLORS, GROUP_META, WINDOW } from '../../styles/theme';
import { squarify } from '../../utils/geometry';
import { fmt, fmtK } from '../../utils/format';
import { CHARS_PER_TOKEN } from '../../pipeline/utils';
import type { ContextCategory, SeriesPoint, ToolAggregation } from '../../types/session';

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

export interface PeakSessionData {
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
  categories?: ContextCategory[];
  tools?: ToolAggregation[];
  series?: SeriesPoint[];
}

export interface ContextAssemblyData {
  model: string;
  version: string;
  cwd: string;
  requests: number;
  peakIndex: number;
  peakTokens: number;
  contextLimit: number;
  CATSUM: number;
  requestsFmt: string;
  peakTokensFmt: string;
  peakCacheHit: number;
  peakTurnIdx: number;
  peakStep: number;
  peakCacheFmt: string;
  contextLimitFmt: string;
  windowPctFmt: string;
  freeTokensFmt: string;
  barSegments: BarSegment[];
  freePct: number;
  legendRows: LegendRow[];
  treeCells: TreeCell[];
  groups: GroupCard[];
  toolRows: ToolRow[];
  subAgentPctFmt: string;
  subAgentTokFmt: string;
  series: SeriesPoint[];
  clearHover: () => void;
}

export function buildContextAssemblyData({
  session,
  categories,
  tools,
  series,
  hoveredCategory,
  setHoveredCategory,
}: {
  session: PeakSessionData;
  categories: ContextCategory[];
  tools: ToolAggregation[];
  series: SeriesPoint[];
  hoveredCategory: string | null;
  setHoveredCategory: (key: string | null) => void;
}): ContextAssemblyData {
  const model = session.model || 'unknown';
  const version = session.version || '0.0.0';
  const cwd = session.cwd || '';
  const requests = session.total_requests;
  const peakIndex = session.peak_index;
  const peakTokens = session.peak_tokens;
  const contextLimit = session.context_limit || WINDOW;

  const CATSUM = categories.reduce((a, c) => a + c.tokens, 0) || 1;

  const opFor = (k: string) => (hoveredCategory && hoveredCategory !== k ? 0.26 : 1);
  const setH: Record<string, () => void> = {};
  categories.forEach((c) => {
    setH[c.key] = () => setHoveredCategory(c.key);
  });

  const barSegments: BarSegment[] = categories.map((c) => ({
    key: c.key,
    color: COLORS[c.key] ?? 'oklch(0.5 0 0)',
    pct: (c.tokens / contextLimit) * 100,
    op: opFor(c.key),
    onEnter: setH[c.key]!,
    title: `${c.label} — ${fmt(c.tokens)} tok`,
  }));
  const freePct = Math.max(0, ((contextLimit - CATSUM) / contextLimit) * 100);

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
  }));

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

  const maxRes = Math.max(...tools.map((t) => t.resultTokens), 1);
  const toolRows: ToolRow[] = tools.map((t) => ({
    name: t.name,
    calls: t.calls,
    resultFmt: fmt(Math.round(t.resultTokens * CHARS_PER_TOKEN)) + ' chars',
    barPct: (t.resultTokens / maxRes) * 100,
    color: t.task ? 'oklch(0.67 0.15 25)' : 'oklch(0.76 0.13 62)',
    taskTag: t.task ? ' · 子 Agent' : '',
  }));

  const subCat = categories.find((c) => c.key === 'subagent');
  const subAgentPctFmt = subCat
    ? ((subCat.tokens / CATSUM) * 100).toFixed(2) + '%'
    : '0.00%';
  const subAgentTokFmt = subCat ? fmt(subCat.tokens) : '0';

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
}
