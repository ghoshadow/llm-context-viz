import type {
  ContextCategory,
  SeriesPoint,
  SessionSummary,
  ToolAggregation,
  TurnData,
  TurnDelta,
} from '../types/session';
import {
  type NormalizedCalibration,
  type NormalizedCalibrationSummary,
  categoryChars,
} from './calibration-types';
import { estimateTokensModelAware, isSubAgentTool, isTaskTool, roundTokens } from './utils';
import type { CodexTurn, JsonObject } from './codex-jsonl-types';
import {
  computeSegmentMetrics,
  computeTokenMetrics,
  findPeakStep,
  buildSegments,
} from './codex-jsonl-segments';
import {
  isObject,
  numberOrZero,
  stringifyInput,
  textFromCodexContent,
  textFromCodexContentBlock,
} from './codex-jsonl-parser';

export const CATEGORY_META: Record<string, { label: string; group: ContextCategory['group']; estimated: boolean }> = {
  sysPrompt: { label: '系统提示', group: 'core', estimated: true },
  tool_defs: { label: '工具定义', group: 'core', estimated: true },
  skills: { label: '技能定义', group: 'core', estimated: true },
  memory: { label: '记忆文件', group: 'core', estimated: true },
  mcp: { label: 'MCP 配置', group: 'core', estimated: true },
  reminders: { label: '周期提醒', group: 'core', estimated: true },
  thinking: { label: '思考过程', group: 'io', estimated: false },
  asstText: { label: '助手输出', group: 'io', estimated: false },
  toolCalls: { label: '工具调用', group: 'io', estimated: false },
  toolResults: { label: '工具结果', group: 'io', estimated: false },
  userMsgs: { label: '用户消息', group: 'convo', estimated: false },
  subagent: { label: '子代理', group: 'convo', estimated: false },
};

export const EMPTY_COMP_KEYS = [
  'sysPrompt',
  'tool_defs',
  'skills',
  'memory',
  'mcp',
  'reminders',
  'thinking',
  'asstText',
  'toolCalls',
  'toolResults',
  'userMsgs',
  'subagent',
] as const;

export function assembleTurns(
  turns: CodexTurn[],
  sessionMeta: JsonObject | null,
  calibration?: NormalizedCalibration | NormalizedCalibrationSummary | null,
): TurnData[] {
  const results: TurnData[] = [];
  const coreComp = buildCodexCoreComp(sessionMeta, turns, calibration);
  const runningComp = initComp(coreComp);
  const cumTools: Record<string, { calls: number; resultTokens: number; task: boolean }> = {};
  let prevComp = initComp(coreComp);
  let runningCumTotal = 0;

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i]!;
    const beforeComp = { ...runningComp };
    addTokens(runningComp, 'userMsgs', turn.prompt);

    const { segments, tools } = buildSegments(turn, cumTools, {
      incrementTool,
      addToolResultTokens,
      cloneTools,
    });
    for (const seg of segments) {
      if (seg.k === 'm') {
        if (seg.det.think) addTokenCount(runningComp, 'thinking', seg.det.thinkTok ?? roundTokens(seg.det.think));
        if (seg.det.text) addTokens(runningComp, 'asstText', seg.det.text);
        for (const call of seg.det.calls ?? []) addTokenCount(runningComp, 'toolCalls', call.tok);
      } else if (seg.k === 's') {
        addTokenCount(runningComp, 'subagent', seg.det.resultTok ?? 0);
      } else if (seg.k === 't') {
        addTokenCount(runningComp, 'toolResults', seg.det.resultTok ?? 0);
      }
    }

    const comp = { ...runningComp };
    const delta = i === 0 ? deltaBetween(beforeComp, comp) : deltaBetween(prevComp, comp);
    prevComp = comp;

    const tokenMetrics = computeTokenMetrics(turn);
    const metrics = computeSegmentMetrics(segments, turn, tokenMetrics);
    const cumTotal = tokenMetrics.lastInput > 0 ? tokenMetrics.lastInput : Math.max(runningCumTotal, sumComp(comp));
    const compressionReset = turn.compacted || (runningCumTotal > 0 && cumTotal < runningCumTotal * 0.5);
    runningCumTotal = cumTotal;

    results.push({
      i,
      prompt: turn.prompt,
      ts: turn.startTs,
      asstReqs: tokenMetrics.requestCount,
      maxInput: tokenMetrics.maxInput,
      maxCacheHit: tokenMetrics.maxCacheHit,
      maxReqIdx: tokenMetrics.maxReqIdx,
      maxReqStep: findPeakStep(segments, tokenMetrics.peakTs),
      outTok: tokenMetrics.outTok,
      tools,
      delta,
      durMs: metrics.durMs,
      modelMs: metrics.modelMs,
      toolMs: metrics.toolMs,
      subMs: metrics.subMs,
      stepCount: segments.filter((seg) => seg.k === 'm').length,
      longest: metrics.longest,
      segs: segments,
      comp,
      cumTotal,
      cumCacheHit: tokenMetrics.lastCacheHit,
      cumTools: cloneTools(cumTools),
      compressionReset,
    });
  }

  return results;
}

export function aggregateCodexSession(
  sessionMeta: JsonObject | null,
  turns: CodexTurn[],
  turnData: TurnData[],
  filename: string,
): SessionSummary {
  const firstTurn = turns[0];
  const firstData = turnData[0];
  const model = firstTurn?.model || 'codex';
  let peakIndex = 0;
  let peakTokens = 0;
  let peakCacheHit = 0;
  let peakTurnIdx = 0;
  let peakStep = 0;
  let reqIdx = 0;
  const series: SeriesPoint[] = [];
  let totalOutput = 0;

  for (const turn of turnData) {
    totalOutput += turn.outTok;
    const rawTurn = turns[turn.i];
    for (let i = 0; i < (rawTurn?.tokenUsages.length ?? 0); i++) {
      const usage = rawTurn!.tokenUsages[i]!.usage;
      const input = numberOrZero(usage.input_tokens);
      const cache = numberOrZero(usage.cached_input_tokens);
      const output = numberOrZero(usage.output_tokens);
      series.push({ i: reqIdx, assembled: turn.cumTotal, input, output });
      if (input > peakTokens) {
        peakTokens = input;
        peakCacheHit = cache;
        peakTurnIdx = turn.i;
        peakStep = turn.maxReqStep ?? 0;
        peakIndex = reqIdx;
      }
      reqIdx++;
    }
  }

  const peakComp = turnData[peakTurnIdx]?.comp ?? firstData?.comp ?? initComp();
  const categories: ContextCategory[] = Object.entries(peakComp)
    .map(([key, tokens]) => {
      const meta = CATEGORY_META[key] ?? { label: key, group: 'convo' as const, estimated: true };
      return { key, label: meta.label, group: meta.group, estimated: meta.estimated, tokens: Math.round(tokens), raw: 0 };
    })
    .sort((a, b) => b.tokens - a.tokens);

  const toolMap = new Map<string, { calls: number; resultTokens: number }>();
  for (const turn of turnData) {
    for (const [name, calls] of Object.entries(turn.tools)) {
      const existing = toolMap.get(name) ?? { calls: 0, resultTokens: 0 };
      existing.calls += calls;
      const agg = turn.cumTools?.[name]?.resultTokens;
      if (typeof agg === 'number') existing.resultTokens = Math.max(existing.resultTokens, agg);
      toolMap.set(name, existing);
    }
  }
  const tools: ToolAggregation[] = [...toolMap.entries()]
    .map(([name, data]) => ({ name, calls: data.calls, resultTokens: data.resultTokens, task: isTaskTool(name) }))
    .sort((a, b) => b.calls - a.calls);

  return {
    session: {
      model,
      version: typeof sessionMeta?.cli_version === 'string' ? sessionMeta.cli_version : filename,
      cwd: typeof sessionMeta?.cwd === 'string' ? sessionMeta.cwd : firstTurnCwd(turns) || '',
      aiTitle: firstData?.prompt,
      requests: turnData.reduce((sum, t) => sum + t.asstReqs, 0),
      peakIndex,
      peakTokens,
      peakCacheHit,
      peakTurnIdx,
      peakStep,
      totalOutput,
      contextLimit: firstTurn?.contextLimit || 200000,
    },
    categories,
    series,
    tools,
  };
}

export function initComp(seed?: Record<string, number>): Record<string, number> {
  const comp: Record<string, number> = {};
  for (const key of EMPTY_COMP_KEYS) comp[key] = seed?.[key] ?? 0;
  return comp;
}

export function addTokens(comp: Record<string, number>, key: string, text: string): void {
  if (!text) return;
  // 使用模型感知估算：Codex 日志通常为英文/代码混合
  comp[key] = (comp[key] ?? 0) + Math.round(estimateTokensModelAware(text));
}

export function addTokenCount(comp: Record<string, number>, key: string, count: number): void {
  if (!count) return;
  comp[key] = (comp[key] ?? 0) + Math.max(0, Math.round(count));
}

export function deltaBetween(prev: Record<string, number>, curr: Record<string, number>): TurnDelta {
  const delta: TurnDelta = {};
  for (const key of ['thinking', 'asstText', 'toolCalls', 'toolResults', 'userMsgs', 'subagent'] as const) {
    const diff = (curr[key] ?? 0) - (prev[key] ?? 0);
    if (diff > 0) delta[key] = diff;
  }
  return delta;
}

export function sumComp(comp: Record<string, number>): number {
  return Math.round(Object.values(comp).reduce((sum, value) => sum + value, 0));
}

export function buildCodexCoreComp(
  sessionMeta: JsonObject | null,
  turns: CodexTurn[],
  calibration?: NormalizedCalibration | NormalizedCalibrationSummary | null,
): Record<string, number> {
  const comp = initComp();
  addTokens(comp, 'sysPrompt', codexInstructionText(sessionMeta?.base_instructions));

  if (sessionMeta?.dynamic_tools != null) {
    addTokens(comp, 'tool_defs', stringifyInput(sessionMeta.dynamic_tools));
  }

  const seenDeveloperBlocks = new Set<string>();
  for (const turn of turns) {
    for (const event of turn.events) {
      const payload = event.payload;
      if (event.type !== 'response_item' || payload.type !== 'message' || payload.role !== 'developer') continue;
      if (!Array.isArray(payload.content)) {
        const text = textFromCodexContent(payload.content).trim();
        if (text && !seenDeveloperBlocks.has(text)) {
          seenDeveloperBlocks.add(text);
          addTokens(comp, codexDeveloperCategory(text), text);
        }
        continue;
      }

      for (const block of payload.content) {
        const text = textFromCodexContentBlock(block).trim();
        if (!text || seenDeveloperBlocks.has(text)) continue;
        seenDeveloperBlocks.add(text);
        addTokens(comp, codexDeveloperCategory(text), text);
      }
    }
  }

  applyCodexCalibrationFallback(comp, calibration);
  return comp;
}

export function applyCodexCalibrationFallback(
  comp: Record<string, number>,
  calibration?: NormalizedCalibration | NormalizedCalibrationSummary | null,
): void {
  applyCoreCalibrationFallback(comp, calibration);
}

export function applyCoreCalibrationFallback(
  comp: Record<string, number>,
  calibration?: NormalizedCalibration | NormalizedCalibrationSummary | null,
): void {
  if (!calibration) return;
  for (const key of ['sysPrompt', 'tool_defs', 'skills', 'mcp', 'reminders'] as const) {
    if ((comp[key] ?? 0) > 0) continue;
    const chars = categoryChars(calibration, key);
    if (chars > 0) addTokens(comp, key, ' '.repeat(chars));
  }
}

export function codexInstructionText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (isObject(value) && typeof value.text === 'string') return value.text;
  return '';
}

export function codexDeveloperCategory(text: string): string {
  if (text.includes('<skills_instructions>')) return 'skills';
  if (text.includes('<plugins_instructions>')) return 'mcp';
  if (
    text.includes('<permissions instructions>') ||
    text.includes('<collaboration_mode>') ||
    text.includes('<app-context>')
  ) {
    return 'reminders';
  }
  return 'sysPrompt';
}

export function incrementTool(
  cumTools: Record<string, { calls: number; resultTokens: number; task: boolean }>,
  name: string,
): void {
  const existing = cumTools[name] ?? { calls: 0, resultTokens: 0, task: isTaskTool(name) || isSubAgentTool(name) };
  existing.calls++;
  cumTools[name] = existing;
}

export function addToolResultTokens(
  cumTools: Record<string, { calls: number; resultTokens: number; task: boolean }>,
  name: string,
  resultTokens: number,
): void {
  const existing = cumTools[name] ?? { calls: 0, resultTokens: 0, task: isTaskTool(name) || isSubAgentTool(name) };
  existing.resultTokens += resultTokens;
  cumTools[name] = existing;
}

export function cloneTools(tools: Record<string, { calls: number; resultTokens: number; task: boolean }>) {
  const out: Record<string, { calls: number; resultTokens: number; task: boolean }> = {};
  for (const [key, value] of Object.entries(tools)) out[key] = { ...value };
  return out;
}

export function firstTurnCwd(turns: CodexTurn[]): string {
  for (const turn of turns) {
    for (const event of turn.events) {
      if (event.type === 'turn_context' && typeof event.payload.cwd === 'string') return event.payload.cwd;
    }
  }
  return '';
}
