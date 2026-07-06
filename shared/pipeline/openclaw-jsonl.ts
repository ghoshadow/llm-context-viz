import type { ContextCategory, SeriesPoint, SessionSummary, TimelineSegment, ToolAggregation, TurnData, TurnDelta } from '../types/session';
import { isObject, msBetween, numberOrZero, stringifyInput } from './codex-jsonl-parser';
import {
  CATEGORY_META,
  addTokenCount,
  addTokens,
  cloneTools,
  deltaBetween,
  initComp,
  sumComp,
} from './codex-jsonl-summary';
import type { ParseError } from './parse-jsonl';
import { roundTokens } from './utils';

interface OpenClawLine {
  order: number;
  timestamp: string;
  sessionId: string;
  sessionKey: string;
  runId: string;
  update: Record<string, unknown> | null;
  raw: Record<string, unknown>;
}

interface OpenClawTurn {
  startTs: string;
  endTs: string;
  prompt: string;
  runId: string;
  hasAssistantActivity: boolean;
  assistantRuns: Set<string>;
  segments: TimelineSegment[];
  tools: Record<string, number>;
  toolNames: Map<string, string>;
  toolInputs: Map<string, string>;
  usage: Array<{ line: OpenClawLine; used: number; size: number }>;
}

interface ToolState {
  calls: number;
  resultTokens: number;
  task: boolean;
}

export function runOpenClawPipeline(
  jsonlText: string,
  filename: string,
): {
  summary: SessionSummary;
  turns: TurnData[];
  errors: ParseError[];
} {
  const { lines, errors } = parseOpenClawLines(jsonlText);
  const rawTurns = buildOpenClawTurns(lines, filename);
  const turns = assembleOpenClawTurns(rawTurns);
  const summary = aggregateOpenClawSession(lines, turns, filename);
  return { summary, turns, errors };
}

function parseOpenClawLines(text: string): { lines: OpenClawLine[]; errors: ParseError[] } {
  const lines: OpenClawLine[] = [];
  const errors: ParseError[] = [];

  text.split('\n').forEach((raw, idx) => {
    if (!raw.trim()) return;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!isObject(parsed)) {
        errors.push({ line: idx + 1, message: 'OpenClaw line must be an object' });
        return;
      }
      const update = openClawUpdate(parsed);
      const isSessionMeta = parsed.type === 'openclaw_session';
      if (!update && !isSessionMeta) {
        errors.push({ line: idx + 1, message: 'OpenClaw line missing sessionUpdate' });
        return;
      }
      lines.push({
        order: idx,
        timestamp: normalizeTimestamp(parsed.timestamp ?? parsed.at),
        sessionId: stringValue(parsed.sessionId) || stringValue(parsed.session_id),
        sessionKey: stringValue(parsed.sessionKey) || stringValue(parsed.session_key),
        runId: stringValue(parsed.runId) || stringValue(parsed.run_id),
        update,
        raw: parsed,
      });
    } catch {
      errors.push({ line: idx + 1, message: 'Invalid JSON: could not parse line' });
    }
  });

  return { lines, errors };
}

function openClawUpdate(raw: Record<string, unknown>): Record<string, unknown> | null {
  if (typeof raw.sessionUpdate === 'string') return raw;
  if (isObject(raw.update) && typeof raw.update.sessionUpdate === 'string') return raw.update;
  return null;
}

function buildOpenClawTurns(lines: OpenClawLine[], filename: string): OpenClawTurn[] {
  const turns: OpenClawTurn[] = [];
  let current: OpenClawTurn | null = null;

  function createTurn(line: OpenClawLine, prompt: string): OpenClawTurn {
    return {
      startTs: line.timestamp,
      endTs: line.timestamp,
      prompt,
      runId: line.runId,
      hasAssistantActivity: false,
      assistantRuns: new Set<string>(),
      segments: [],
      tools: {},
      toolNames: new Map<string, string>(),
      toolInputs: new Map<string, string>(),
      usage: [],
    };
  }

  function ensureTurn(line: OpenClawLine): OpenClawTurn {
    if (!current) {
      current = createTurn(line, `OpenClaw stream: ${filename}`);
      turns.push(current);
    }
    return current;
  }

  for (const line of lines) {
    const update = line.update;
    if (!update) continue;
    const tag = stringValue(update.sessionUpdate);
    if (tag === 'user_message_chunk') {
      const text = textFromContent(update.content ?? update.text);
      const active = current;
      if (!active || active.hasAssistantActivity || (line.runId && active.runId && line.runId !== active.runId)) {
        const turn = createTurn(line, text || `OpenClaw stream: ${filename}`);
        current = turn;
        turns.push(turn);
        if (line.timestamp) turn.endTs = line.timestamp;
      } else if (text) {
        active.prompt = active.prompt.startsWith('OpenClaw stream:')
          ? text
          : [active.prompt, text].filter(Boolean).join('\n');
        if (line.timestamp) active.endTs = line.timestamp;
      } else if (line.timestamp) {
        active.endTs = line.timestamp;
      }
      continue;
    }

    const turn = ensureTurn(line);
    if (line.timestamp) turn.endTs = line.timestamp;

    if (tag === 'agent_message_chunk') {
      markAssistantActivity(turn, line);
      addTextSegment(turn, textFromContent(update.content ?? update.text), line.timestamp);
    } else if (tag === 'agent_thought_chunk') {
      markAssistantActivity(turn, line);
      addThoughtSegment(turn, textFromContent(update.content ?? update.text), line.timestamp);
    } else if (tag === 'tool_call') {
      markAssistantActivity(turn, line);
      addToolCall(turn, update, line.timestamp);
    } else if (tag === 'tool_call_update') {
      markAssistantActivity(turn, line);
      addToolResult(turn, update, line.timestamp);
    } else if (tag === 'usage_update') {
      markAssistantActivity(turn, line);
      const used = numberOrZero(update.used);
      const size = numberOrZero(update.size);
      if (used > 0 || size > 0) turn.usage.push({ line, used, size });
    }
  }

  for (const turn of turns) assignDurations(turn);
  return turns;
}

function assembleOpenClawTurns(turns: OpenClawTurn[]): TurnData[] {
  const results: TurnData[] = [];
  const runningComp = initComp();
  const cumTools: Record<string, ToolState> = {};
  let prevComp = initComp();
  let runningCumTotal = 0;

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i]!;
    const beforeComp = { ...runningComp };
    addTokens(runningComp, 'userMsgs', turn.prompt);

    for (const seg of turn.segments) {
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

    for (const seg of turn.segments) {
      if (seg.k !== 't' && seg.k !== 's') continue;
      const name = seg.det.name || seg.n;
      const existing = cumTools[name] ?? { calls: 0, resultTokens: 0, task: seg.k === 's' };
      existing.calls++;
      existing.resultTokens += seg.det.resultTok ?? 0;
      existing.task = existing.task || seg.k === 's';
      cumTools[name] = existing;
      seg.det.stepTools = cloneTools(cumTools);
    }

    const comp = { ...runningComp };
    const delta: TurnDelta = i === 0 ? deltaBetween(beforeComp, comp) : deltaBetween(prevComp, comp);
    prevComp = comp;

    const tokenMetrics = computeOpenClawTokenMetrics(turn);
    const metrics = segmentMetrics(turn.segments, turn.startTs, turn.endTs);
    const cumTotal = tokenMetrics.lastInput > 0 ? tokenMetrics.lastInput : Math.max(runningCumTotal, sumComp(comp));
    const maxInput = tokenMetrics.maxInput > 0 ? tokenMetrics.maxInput : cumTotal;
    runningCumTotal = cumTotal;

    results.push({
      i,
      prompt: turn.prompt,
      ts: turn.startTs,
      asstReqs: tokenMetrics.requestCount,
      maxInput,
      maxCacheHit: 0,
      maxReqIdx: tokenMetrics.maxReqIdx,
      maxReqStep: findPeakStep(turn.segments, tokenMetrics.peakTs),
      outTok: tokenMetrics.outTok,
      tools: turn.tools,
      delta,
      durMs: metrics.durMs,
      modelMs: metrics.modelMs,
      toolMs: metrics.toolMs,
      subMs: metrics.subMs,
      stepCount: turn.segments.filter((seg) => seg.k === 'm').length,
      longest: metrics.longest,
      segs: turn.segments,
      comp,
      cumTotal,
      cumCacheHit: 0,
      cumTools: cloneTools(cumTools),
      compressionReset: false,
    });
  }

  return results;
}

function aggregateOpenClawSession(lines: OpenClawLine[], turns: TurnData[], filename: string): SessionSummary {
  let peakIndex = 0;
  let peakTokens = 0;
  let peakTurnIdx = 0;
  let peakStep = 0;
  let totalOutput = 0;
  let reqIdx = 0;
  let contextLimit = 200000;
  const series: SeriesPoint[] = [];

  for (const turn of turns) {
    totalOutput += turn.outTok;
    const input = turn.maxInput > 0 ? turn.maxInput : turn.cumTotal;
    if (input > peakTokens) {
      peakTokens = input;
      peakTurnIdx = turn.i;
      peakStep = turn.maxReqStep ?? 0;
      peakIndex = reqIdx;
    }
    if (turn.asstReqs > 0) {
      series.push({ i: reqIdx, assembled: turn.cumTotal, input, output: turn.outTok });
      reqIdx++;
    }
  }

  for (const line of lines) {
    const size = numberOrZero(line.update?.size);
    if (size > 0) contextLimit = size;
  }

  const peakComp = turns[peakTurnIdx]?.comp ?? initComp();
  return {
    session: {
      model: 'openclaw',
      version: firstSessionId(lines) || filename,
      cwd: firstCwd(lines),
      aiTitle: turns[0]?.prompt,
      requests: turns.reduce((sum, turn) => sum + turn.asstReqs, 0),
      peakIndex,
      peakTokens,
      peakCacheHit: 0,
      peakTurnIdx,
      peakStep,
      totalOutput,
      contextLimit,
    },
    categories: categoriesFromComp(peakComp),
    series,
    tools: aggregateTools(turns),
  };
}

function markAssistantActivity(turn: OpenClawTurn, line: OpenClawLine): void {
  turn.hasAssistantActivity = true;
  turn.assistantRuns.add(line.runId || '__openclaw_run__');
}

function addTextSegment(turn: OpenClawTurn, text: string, ts: string): void {
  if (!text) return;
  const prev = turn.segments[turn.segments.length - 1];
  if (prev?.k === 'm' && prev.det.text && !prev.det.calls && !prev.det.think) {
    prev.det.text += text;
    prev.det.textTok = roundTokens(prev.det.text);
    return;
  }
  turn.segments.push({
    k: 'm',
    n: '模型生成',
    ms: 0,
    ts,
    det: { text, textTok: roundTokens(text) },
  });
}

function addThoughtSegment(turn: OpenClawTurn, text: string, ts: string): void {
  if (!text) return;
  const prev = turn.segments[turn.segments.length - 1];
  if (prev?.k === 'm' && prev.det.think && !prev.det.calls && !prev.det.text) {
    prev.det.think += text;
    prev.det.thinkTok = roundTokens(prev.det.think);
    return;
  }
  turn.segments.push({
    k: 'm',
    n: '模型生成',
    ms: 0,
    ts,
    det: { think: text, thinkTok: roundTokens(text) },
  });
}

function addToolCall(turn: OpenClawTurn, update: Record<string, unknown>, ts: string): void {
  const id = stringValue(update.toolCallId) || stringValue(update.id) || `tool_${turn.segments.length}`;
  const name = toolName(update, id);
  turn.toolNames.set(id, name);
  turn.tools[name] = (turn.tools[name] ?? 0) + 1;
  const input = stringifyInput(update.rawInput ?? update.input ?? update.args ?? {});
  turn.toolInputs.set(id, input);
  turn.segments.push({
    k: 'm',
    n: '模型生成',
    ms: 0,
    ts,
    det: { calls: [{ name, input, tok: roundTokens(name + input) }] },
  });
}

function addToolResult(turn: OpenClawTurn, update: Record<string, unknown>, ts: string): void {
  const id = stringValue(update.toolCallId) || stringValue(update.id);
  const name = (id && turn.toolNames.get(id)) || toolName(update, id || 'tool');
  const input = (id && turn.toolInputs.get(id)) || '';
  const result = textFromContent(update.content) || textFromContent(update.rawOutput ?? update.output ?? update.result);
  const status = stringValue(update.status).toLowerCase();
  if (!result && status === 'in_progress') return;
  const resultTok = roundTokens(result);
  turn.segments.push({
    k: name === 'task' ? 's' : 't',
    n: name,
    ms: 0,
    ts,
    det: {
      name,
      input,
      result,
      resultTok,
      isError: status === 'failed' || status === 'error',
    },
  });
}

function computeOpenClawTokenMetrics(turn: OpenClawTurn): {
  requestCount: number;
  maxInput: number;
  maxReqIdx: number;
  outTok: number;
  lastInput: number;
  peakTs: string;
} {
  let maxInput = 0;
  let maxReqIdx = 0;
  let lastInput = 0;
  let peakTs = turn.startTs;

  turn.usage.forEach(({ line, used }, idx) => {
    if (used > 0) lastInput = used;
    if (used > maxInput) {
      maxInput = used;
      maxReqIdx = idx;
      peakTs = line.timestamp;
    }
  });

  const outTok = turn.segments.reduce((sum, seg) => sum + (seg.k === 'm' ? (seg.det.textTok ?? 0) : 0), 0);
  return {
    requestCount: Math.max(turn.assistantRuns.size, turn.hasAssistantActivity ? 1 : 0),
    maxInput,
    maxReqIdx,
    outTok,
    lastInput,
    peakTs,
  };
}

function segmentMetrics(
  segments: TimelineSegment[],
  startTs: string,
  endTs: string,
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
  return { durMs: Math.max(modelMs + toolMs + subMs, msBetween(startTs, endTs)), modelMs, toolMs, subMs, longest };
}

function assignDurations(turn: OpenClawTurn): void {
  for (let i = 0; i < turn.segments.length; i++) {
    const seg = turn.segments[i]!;
    if (seg.ms > 0) continue;
    seg.ms = msBetween(seg.ts || turn.startTs, turn.segments[i + 1]?.ts || turn.endTs || turn.startTs);
  }
}

function findPeakStep(segments: TimelineSegment[], peakTs: string): number {
  if (!segments.length) return 0;
  const peakMs = new Date(peakTs).getTime();
  if (Number.isNaN(peakMs)) return 0;
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < segments.length; i++) {
    const segMs = new Date(segments[i]!.ts).getTime();
    const distance = Math.abs(segMs - peakMs);
    if (!Number.isNaN(distance) && distance < bestDistance) {
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

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(textFromContent).filter(Boolean).join('\n');
  }
  if (isObject(content)) {
    if (typeof content.text === 'string') return content.text;
    if (typeof content.content === 'string') return content.content;
  }
  if (content == null) return '';
  return stringifyInput(content);
}

function toolName(update: Record<string, unknown>, fallback: string): string {
  return stringValue(update.title) || stringValue(update.kind) || stringValue(update.name) || fallback || 'tool';
}

function firstCwd(lines: OpenClawLine[]): string {
  for (const line of lines) {
    if (typeof line.raw.cwd === 'string') return line.raw.cwd;
    if (typeof line.raw.workingDirectory === 'string') return line.raw.workingDirectory;
    if (typeof line.update?.cwd === 'string') return line.update.cwd;
  }
  return '';
}

function firstSessionId(lines: OpenClawLine[]): string {
  for (const line of lines) {
    if (line.sessionId) return line.sessionId;
    if (typeof line.raw.sessionId === 'string') return line.raw.sessionId;
    if (typeof line.raw.session_id === 'string') return line.raw.session_id;
  }
  return '';
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeTimestamp(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = Math.abs(value) < 1_000_000_000_000 ? value * 1000 : value;
    return new Date(ms).toISOString();
  }
  return '';
}
