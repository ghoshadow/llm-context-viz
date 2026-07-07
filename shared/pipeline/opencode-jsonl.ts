import type { ContextCategory, SeriesPoint, SessionSummary, TimelineSegment, ToolAggregation, TurnData, TurnDelta } from '../types/session';
import { isObject, msBetween, numberOrZero, stringifyInput } from './codex-jsonl-parser';
import { CATEGORY_META, addTokenCount, addTokens, applyCoreCalibrationFallback, cloneTools, deltaBetween, initComp, sumComp } from './codex-jsonl-summary';
import type { NormalizedCalibration, NormalizedCalibrationSummary } from './calibration-types';
import type { ParseError } from './parse-jsonl';
import { roundTokens } from './utils';

interface OpenCodeLine {
  order: number;
  timestamp: string;
  type: string;
  sessionID: string;
  part: Record<string, unknown>;
  raw: Record<string, unknown>;
}

interface OpenCodeTurn {
  startTs: string;
  endTs: string;
  prompt: string;
  events: OpenCodeLine[];
  tokenUsages: Array<{ line: OpenCodeLine; usage: OpenCodeUsage }>;
  errors: OpenCodeLine[];
}

interface OpenCodeUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
}

interface ToolState {
  calls: number;
  resultTokens: number;
  task: boolean;
}

export function runOpenCodePipeline(
  jsonlText: string,
  filename: string,
  calibration?: NormalizedCalibration | NormalizedCalibrationSummary | null,
): {
  summary: SessionSummary;
  turns: TurnData[];
  errors: ParseError[];
} {
  const { lines, errors } = parseOpenCodeLines(jsonlText);
  const rawTurns = buildOpenCodeTurns(lines, filename);
  const turns = assembleOpenCodeTurns(rawTurns, calibration);
  const summary = aggregateOpenCodeSession(lines, rawTurns, turns, filename);
  return { summary, turns, errors };
}

function parseOpenCodeLines(text: string): { lines: OpenCodeLine[]; errors: ParseError[] } {
  const lines: OpenCodeLine[] = [];
  const errors: ParseError[] = [];

  text.split('\n').forEach((raw, idx) => {
    if (!raw.trim()) return;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!isObject(parsed) || typeof parsed.type !== 'string') {
        errors.push({ line: idx + 1, message: 'OpenCode line missing type' });
        return;
      }
      const part = isObject(parsed.part) ? parsed.part : {};
      lines.push({
        order: idx,
        timestamp: normalizeTimestamp(parsed.timestamp),
        type: parsed.type,
        sessionID: typeof parsed.sessionID === 'string'
          ? parsed.sessionID
          : typeof part.sessionID === 'string' ? part.sessionID : '',
        part,
        raw: parsed,
      });
    } catch {
      errors.push({ line: idx + 1, message: 'Invalid JSON: could not parse line' });
    }
  });

  return { lines, errors };
}

function buildOpenCodeTurns(lines: OpenCodeLine[], filename: string): OpenCodeTurn[] {
  const turns: OpenCodeTurn[] = [];
  let current: OpenCodeTurn | null = null;

  function ensureTurn(line: OpenCodeLine): OpenCodeTurn {
    if (!current) {
      current = {
        startTs: line.timestamp,
        endTs: line.timestamp,
        prompt: `OpenCode stream: ${filename}`,
        events: [],
        tokenUsages: [],
        errors: [],
      };
      turns.push(current);
    }
    return current;
  }

  for (const line of lines) {
    if (line.type === 'step_start' && current !== null) current = null;
    const turn = ensureTurn(line);
    if (line.type === 'step_start' && typeof line.part.prompt === 'string' && line.part.prompt.trim()) {
      turn.prompt = line.part.prompt.trim();
    }
    turn.events.push(line);
    if (line.timestamp) turn.endTs = line.timestamp;

    if (line.type === 'step_finish') {
      const usage = usageFromPart(line.part);
      if (usage) turn.tokenUsages.push({ line, usage });
    } else if (line.type === 'error') {
      turn.errors.push(line);
    }
  }

  return turns;
}

function assembleOpenCodeTurns(
  turns: OpenCodeTurn[],
  calibration?: NormalizedCalibration | NormalizedCalibrationSummary | null,
): TurnData[] {
  const results: TurnData[] = [];
  const runningComp = initComp();
  applyCoreCalibrationFallback(runningComp, calibration);
  const cumTools: Record<string, ToolState> = {};
  let prevComp = initComp();
  let runningCumTotal = 0;

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i]!;
    const beforeComp = { ...runningComp };
    addTokens(runningComp, 'userMsgs', turn.prompt);

    const { segments, tools } = buildOpenCodeSegments(turn, cumTools);
    for (const seg of segments) {
      if (seg.k === 'm') {
        if (seg.det.text) addTokens(runningComp, 'asstText', seg.det.text);
        for (const call of seg.det.calls ?? []) addTokenCount(runningComp, 'toolCalls', call.tok);
      } else if (seg.k === 's') {
        addTokenCount(runningComp, 'subagent', seg.det.resultTok ?? 0);
      } else if (seg.k === 't') {
        addTokenCount(runningComp, 'toolResults', seg.det.resultTok ?? 0);
      }
    }

    const comp = { ...runningComp };
    const delta: TurnDelta = i === 0 ? deltaBetween(beforeComp, comp) : deltaBetween(prevComp, comp);
    prevComp = comp;

    const tokenMetrics = computeOpenCodeTokenMetrics(turn);
    const metrics = computeOpenCodeSegmentMetrics(segments, turn);
    const cumTotal = tokenMetrics.lastInput > 0 ? tokenMetrics.lastInput : Math.max(runningCumTotal, sumComp(comp));
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
      compressionReset: false,
    });
  }

  return results;
}

function buildOpenCodeSegments(
  turn: OpenCodeTurn,
  cumTools: Record<string, ToolState>,
): { segments: TimelineSegment[]; tools: Record<string, number> } {
  const segments: TimelineSegment[] = [];
  const tools: Record<string, number> = {};

  for (const event of turn.events) {
    if (event.type === 'text') {
      const text = textFromOpenCodePart(event.part);
      if (!text) continue;
      segments.push({
        k: 'm',
        n: '模型生成',
        ms: 0,
        ts: event.timestamp,
        det: {
          text,
          textTok: roundTokens(text),
          inTok: nearestInputTokens(turn, event.order),
          outTok: nearestOutputTokens(turn, event.order),
        },
      });
    } else if (event.type === 'tool_use') {
      const tool = toolFromOpenCodePart(event.part);
      tools[tool.name] = (tools[tool.name] ?? 0) + 1;
      incrementOpenCodeTool(cumTools, tool.name);
      segments.push({
        k: 'm',
        n: '模型生成',
        ms: 0,
        ts: event.timestamp,
        det: {
          calls: [{ name: tool.name, input: tool.input, tok: roundTokens(tool.name + tool.input) }],
          inTok: nearestInputTokens(turn, event.order),
          outTok: nearestOutputTokens(turn, event.order),
        },
      });

      const resultTok = roundTokens(tool.result);
      addOpenCodeToolResultTokens(cumTools, tool.name, resultTok);
      segments.push({
        k: tool.name === 'task' ? 's' : 't',
        n: tool.name,
        ms: tool.durationMs,
        ts: event.timestamp,
        det: {
          name: tool.name,
          input: tool.input,
          result: tool.result,
          resultTok,
          isError: tool.isError,
          stepTools: cloneTools(cumTools),
        },
      });
    } else if (event.type === 'error') {
      segments.push({
        k: 'i',
        n: 'OpenCode 错误',
        ms: 0,
        ts: event.timestamp,
        det: { text: openCodeErrorText(event.raw) },
      });
    }
  }

  if (segments.length === 0) {
    segments.push({
      k: 'm',
      n: '模型生成',
      ms: 0,
      ts: turn.startTs,
      det: { text: '（OpenCode 日志未记录可读的 assistant 文本或工具事件。）', textTok: 0 },
    });
  }

  assignDurations(segments, turn);
  return { segments, tools };
}

function aggregateOpenCodeSession(
  lines: OpenCodeLine[],
  rawTurns: OpenCodeTurn[],
  turns: TurnData[],
  filename: string,
): SessionSummary {
  let peakIndex = 0;
  let peakTokens = 0;
  let peakCacheHit = 0;
  let peakTurnIdx = 0;
  let peakStep = 0;
  let reqIdx = 0;
  let totalOutput = 0;
  const series: SeriesPoint[] = [];

  for (const turn of turns) {
    totalOutput += turn.outTok;
    const rawTurn = rawTurns[turn.i];
    for (const { usage } of rawTurn?.tokenUsages ?? []) {
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

  if (series.length === 0) {
    for (const turn of turns) {
      if (turn.cumTotal > peakTokens) {
        peakTokens = turn.cumTotal;
        peakTurnIdx = turn.i;
      }
    }
  }

  const peakComp = turns[peakTurnIdx]?.comp ?? initComp();
  const categories = categoriesFromComp(peakComp);
  const tools = aggregateTools(turns);
  const sessionID = lines.find((line) => line.sessionID)?.sessionID || filename;

  return {
    session: {
      model: 'opencode',
      version: sessionID,
      cwd: firstCwd(lines),
      aiTitle: turns[0]?.prompt,
      requests: turns.reduce((sum, turn) => sum + turn.asstReqs, 0),
      peakIndex,
      peakTokens,
      peakCacheHit,
      peakTurnIdx,
      peakStep,
      totalOutput,
      contextLimit: 200000,
    },
    categories,
    series,
    tools,
  };
}

function usageFromPart(part: Record<string, unknown>): OpenCodeUsage | null {
  const tokens = isObject(part.tokens) ? part.tokens : isObject(part.usage) ? part.usage : null;
  if (!tokens) return null;
  const cache = isObject(tokens.cache) ? tokens.cache : {};
  return {
    input_tokens: typeof tokens.input === 'number' ? tokens.input : undefined,
    output_tokens: typeof tokens.output === 'number' ? tokens.output : undefined,
    reasoning_output_tokens: typeof tokens.reasoning === 'number' ? tokens.reasoning : undefined,
    cached_input_tokens: typeof cache.read === 'number' ? cache.read : undefined,
  };
}

function toolFromOpenCodePart(part: Record<string, unknown>): {
  name: string;
  input: string;
  result: string;
  durationMs: number;
  isError: boolean;
} {
  const state = isObject(part.state) ? part.state : {};
  const name = String(part.tool ?? part.name ?? state.tool ?? 'tool');
  const input = stringifyInput(state.input ?? part.input ?? {});
  const result = outputText(state.output ?? state.result ?? part.output ?? '');
  const status = String(state.status ?? part.status ?? '').toLowerCase();
  const durationMs = durationFromState(state);
  return { name, input, result, durationMs, isError: status === 'error' || status === 'failed' };
}

function textFromOpenCodePart(part: Record<string, unknown>): string {
  if (typeof part.text === 'string') return part.text;
  if (typeof part.content === 'string') return part.content;
  return '';
}

function outputText(value: unknown): string {
  if (typeof value === 'string') return value;
  return stringifyInput(value);
}

function openCodeErrorText(raw: Record<string, unknown>): string {
  const error = isObject(raw.error) ? raw.error : raw;
  if (typeof error.message === 'string') return error.message;
  if (isObject(error.data) && typeof error.data.message === 'string') return error.data.message;
  return stringifyInput(error);
}

function durationFromState(state: Record<string, unknown>): number {
  const time = isObject(state.time) ? state.time : {};
  const start = typeof time.start === 'number' ? time.start : undefined;
  const end = typeof time.end === 'number' ? time.end : undefined;
  if (start == null || end == null) return 0;
  return Math.max(0, Math.round(end - start));
}

function computeOpenCodeTokenMetrics(turn: OpenCodeTurn): {
  requestCount: number;
  maxInput: number;
  maxCacheHit: number;
  maxReqIdx: number;
  outTok: number;
  lastInput: number;
  lastCacheHit: number;
  peakTs: string;
} {
  let maxInput = 0;
  let maxCacheHit = 0;
  let maxReqIdx = 0;
  let outTok = 0;
  let lastInput = 0;
  let lastCacheHit = 0;
  let peakTs = turn.startTs;

  turn.tokenUsages.forEach(({ line, usage }, idx) => {
    const input = numberOrZero(usage.input_tokens);
    const cache = numberOrZero(usage.cached_input_tokens);
    const output = numberOrZero(usage.output_tokens);
    outTok += output;
    if (input > 0 || cache > 0 || output > 0) {
      lastInput = input;
      lastCacheHit = cache;
    }
    if (input > maxInput) {
      maxInput = input;
      maxCacheHit = cache;
      maxReqIdx = idx;
      peakTs = line.timestamp;
    }
  });

  return {
    requestCount: Math.max(turn.tokenUsages.length, turn.events.some((line) => line.type === 'step_start') ? 1 : 0),
    maxInput,
    maxCacheHit,
    maxReqIdx,
    outTok,
    lastInput,
    lastCacheHit,
    peakTs,
  };
}

function computeOpenCodeSegmentMetrics(
  segments: TimelineSegment[],
  turn: OpenCodeTurn,
): { durMs: number; modelMs: number; toolMs: number; subMs: number; longest: { k: string; n: string; ms: number } } {
  let modelMs = 0;
  let toolMs = 0;
  let subMs = 0;
  let longest = { k: '', n: '', ms: 0 };

  for (const seg of segments) {
    if (seg.k === 'm') modelMs += seg.ms;
    else if (seg.k === 's') subMs += seg.ms;
    else if (seg.k === 't') toolMs += seg.ms;
    if (seg.ms > longest.ms) longest = { k: seg.k, n: seg.n, ms: seg.ms };
  }

  return {
    durMs: Math.max(modelMs + toolMs + subMs, msBetween(turn.startTs, turn.endTs)),
    modelMs,
    toolMs,
    subMs,
    longest,
  };
}

function assignDurations(segments: TimelineSegment[], turn: OpenCodeTurn): void {
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    if (seg.ms > 0) continue;
    const next = segments[i + 1];
    seg.ms = msBetween(seg.ts, next?.ts || turn.endTs || turn.startTs);
  }
}

function nearestInputTokens(turn: OpenCodeTurn, order: number): number {
  return nearestUsage(turn, order)?.input_tokens ?? 0;
}

function nearestOutputTokens(turn: OpenCodeTurn, order: number): number {
  return nearestUsage(turn, order)?.output_tokens ?? 0;
}

function nearestUsage(turn: OpenCodeTurn, order: number): OpenCodeUsage | null {
  let nearest: OpenCodeUsage | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const { line, usage } of turn.tokenUsages) {
    const distance = Math.abs(line.order - order);
    if (distance < bestDistance) {
      bestDistance = distance;
      nearest = usage;
    }
  }
  return nearest;
}

function findPeakStep(segments: TimelineSegment[], peakTs: string): number {
  if (!segments.length) return 0;
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  const peakMs = new Date(peakTs).getTime();
  for (let i = 0; i < segments.length; i++) {
    const segMs = new Date(segments[i]!.ts).getTime();
    const distance = Math.abs(segMs - peakMs);
    if (!isNaN(distance) && distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

function categoriesFromComp(comp: Record<string, number>): ContextCategory[] {
  return Object.entries(comp)
    .map(([key, tokens]) => {
      const meta = CATEGORY_META[key] ?? { label: key, group: 'convo' as const, estimated: true };
      return { key, label: meta.label, group: meta.group, estimated: meta.estimated, tokens: Math.round(tokens), raw: 0 };
    })
    .sort((a, b) => b.tokens - a.tokens);
}

function aggregateTools(turns: TurnData[]): ToolAggregation[] {
  const toolMap = new Map<string, { calls: number; resultTokens: number; task: boolean }>();
  for (const turn of turns) {
    for (const [name, calls] of Object.entries(turn.tools)) {
      const existing = toolMap.get(name) ?? { calls: 0, resultTokens: 0, task: name === 'task' };
      existing.calls += calls;
      const agg = turn.cumTools?.[name]?.resultTokens;
      if (typeof agg === 'number') existing.resultTokens = Math.max(existing.resultTokens, agg);
      existing.task = existing.task || name === 'task';
      toolMap.set(name, existing);
    }
  }
  return [...toolMap.entries()]
    .map(([name, data]) => ({ name, calls: data.calls, resultTokens: data.resultTokens, task: data.task }))
    .sort((a, b) => b.calls - a.calls);
}

function incrementOpenCodeTool(cumTools: Record<string, ToolState>, name: string): void {
  const existing = cumTools[name] ?? { calls: 0, resultTokens: 0, task: name === 'task' };
  existing.calls++;
  cumTools[name] = existing;
}

function addOpenCodeToolResultTokens(cumTools: Record<string, ToolState>, name: string, resultTokens: number): void {
  const existing = cumTools[name] ?? { calls: 0, resultTokens: 0, task: name === 'task' };
  existing.resultTokens += resultTokens;
  cumTools[name] = existing;
}

function firstCwd(lines: OpenCodeLine[]): string {
  for (const line of lines) {
    if (typeof line.raw.cwd === 'string') return line.raw.cwd;
    if (typeof line.part.cwd === 'string') return line.part.cwd;
  }
  return '';
}

function normalizeTimestamp(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = Math.abs(value) < 1_000_000_000_000 ? value * 1000 : value;
    return new Date(ms).toISOString();
  }
  return '';
}
