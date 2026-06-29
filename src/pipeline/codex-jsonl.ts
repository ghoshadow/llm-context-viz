import type {
  ContextCategory,
  SeriesPoint,
  SessionSummary,
  TimelineSegment,
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

type JsonObject = Record<string, unknown>;

interface CodexLine {
  order: number;
  timestamp: string;
  type: string;
  payload: JsonObject;
}

interface TokenUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
}

interface CodexTurn {
  turnId: string;
  startTs: string;
  endTs: string;
  prompt: string;
  model: string;
  contextLimit: number;
  events: CodexLine[];
  tokenUsages: Array<{ line: CodexLine; usage: TokenUsage }>;
  durationMs?: number;
  aborted?: boolean;
  compacted?: boolean;
}

interface ToolCall {
  callId: string;
  name: string;
  input: string;
  ts: string;
  order: number;
}

interface ToolResult {
  callId: string;
  output: string;
  ts: string;
  order: number;
  isError: boolean;
  durationMs?: number;
}

const CATEGORY_META: Record<string, { label: string; group: ContextCategory['group']; estimated: boolean }> = {
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

const EMPTY_COMP_KEYS = [
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

export function isCodexJsonl(jsonlText: string): boolean {
  for (const raw of jsonlText.split('\n')) {
    if (!raw.trim()) continue;
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>;
      if (obj.type === 'session_meta' || obj.type === 'turn_context') return true;
      if (obj.type === 'event_msg') {
        const payload = obj.payload;
        if (typeof payload === 'object' && payload !== null && !Array.isArray(payload) && typeof (payload as Record<string, unknown>).type === 'string') return true;
      }
      if (obj.type === 'response_item') {
        const payload = obj.payload;
        if (typeof payload === 'object' && payload !== null && !Array.isArray(payload) && typeof (payload as Record<string, unknown>).type === 'string') return true;
      }
    } catch {
      return false;
    }
  }
  return false;
}

export function runCodexPipeline(
  jsonlText: string,
  filename: string,
  calibration?: NormalizedCalibration | NormalizedCalibrationSummary | null,
): {
  summary: SessionSummary;
  turns: TurnData[];
  errors: { line: number; message: string }[];
} {
  const { lines, errors } = parseCodexLines(jsonlText);
  const sessionMeta = firstPayload(lines, 'session_meta');
  const turns = buildCodexTurns(lines);
  const turnData = assembleTurns(turns, sessionMeta, calibration);
  const summary = aggregateCodexSession(sessionMeta, turns, turnData, filename);
  return { summary, turns: turnData, errors };
}

function parseCodexLines(text: string): { lines: CodexLine[]; errors: { line: number; message: string }[] } {
  const lines: CodexLine[] = [];
  const errors: { line: number; message: string }[] = [];

  text.split('\n').forEach((raw, idx) => {
    if (!raw.trim()) return;
    try {
      const obj = JSON.parse(raw) as JsonObject;
      if (typeof obj.type !== 'string') {
        errors.push({ line: idx + 1, message: 'Codex line missing type' });
        return;
      }
      lines.push({
        order: idx,
        timestamp: typeof obj.timestamp === 'string' ? obj.timestamp : '',
        type: obj.type,
        payload: isObject(obj.payload) ? obj.payload : {},
      });
    } catch {
      errors.push({ line: idx + 1, message: 'Invalid JSON: could not parse line' });
    }
  });

  return { lines, errors };
}

function buildCodexTurns(lines: CodexLine[]): CodexTurn[] {
  const turns: CodexTurn[] = [];
  let current: CodexTurn | null = null;
  let lastModel = 'codex';
  let lastContextLimit = 200000;

  for (const line of lines) {
    const payload = line.payload;

    if (line.type === 'turn_context') {
      if (typeof payload.model === 'string') lastModel = payload.model;
      if (typeof payload.model_context_window === 'number') lastContextLimit = payload.model_context_window;
    }

    if (line.type === 'event_msg' && payload.type === 'task_started') {
      if (current) finalizeTurn(current, line.timestamp);
      current = {
        turnId: typeof payload.turn_id === 'string' ? payload.turn_id : `turn_${turns.length + 1}`,
        startTs: line.timestamp,
        endTs: line.timestamp,
        prompt: '',
        model: lastModel,
        contextLimit: typeof payload.model_context_window === 'number' ? payload.model_context_window : lastContextLimit,
        events: [line],
        tokenUsages: [],
      };
      turns.push(current);
      continue;
    }

    if (!current) continue;

    current.events.push(line);
    if (line.timestamp) current.endTs = line.timestamp;

    if (line.type === 'turn_context') {
      if (typeof payload.model === 'string') current.model = payload.model;
      if (typeof payload.model_context_window === 'number') current.contextLimit = payload.model_context_window;
      if (typeof payload.cwd === 'string') {
        // Kept on the event for aggregation; no separate field needed.
      }
    } else if (line.type === 'event_msg' && payload.type === 'user_message') {
      if (!current.prompt && typeof payload.message === 'string') current.prompt = payload.message;
    } else if (line.type === 'response_item' && payload.type === 'message' && payload.role === 'user' && !current.prompt) {
      const text = textFromCodexContent(payload.content).trim();
      if (text && !text.startsWith('<environment_context>')) current.prompt = text;
    } else if (line.type === 'event_msg' && payload.type === 'token_count') {
      const info = payload.info as Record<string, unknown> | undefined;
      const usage = info?.last_token_usage;
      if (isObject(usage)) current.tokenUsages.push({ line, usage });
      const window = info?.model_context_window;
      if (typeof window === 'number') current.contextLimit = window;
    } else if (line.type === 'event_msg' && payload.type === 'task_complete') {
      current.durationMs = typeof payload.duration_ms === 'number' ? payload.duration_ms : undefined;
      finalizeTurn(current, line.timestamp);
      current = null;
    } else if (line.type === 'event_msg' && payload.type === 'turn_aborted') {
      current.durationMs = typeof payload.duration_ms === 'number' ? payload.duration_ms : undefined;
      current.aborted = true;
      finalizeTurn(current, line.timestamp);
      current = null;
    } else if (line.type === 'event_msg' && payload.type === 'context_compacted') {
      current.compacted = true;
    } else if (line.type === 'compacted') {
      current.compacted = true;
    }
  }

  if (current) finalizeTurn(current, current.endTs);
  return turns;
}

function finalizeTurn(turn: CodexTurn, fallbackEndTs: string): void {
  if (!turn.endTs) turn.endTs = fallbackEndTs || turn.startTs;
  if (!turn.prompt) turn.prompt = '(Codex 日志未记录用户输入)';
}

function assembleTurns(
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

    const { segments, tools } = buildSegments(turn, cumTools);
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

function buildSegments(
  turn: CodexTurn,
  cumTools: Record<string, { calls: number; resultTokens: number; task: boolean }>,
): { segments: TimelineSegment[]; tools: Record<string, number> } {
  const calls = collectToolCalls(turn.events);
  const results = collectToolResults(turn.events);
  const segments: TimelineSegment[] = [];
  const tools: Record<string, number> = {};
  const seenAssistantTexts = new Set<string>();

  for (const event of turn.events) {
    const payload = event.payload;
    if (event.type === 'response_item' && payload.type === 'reasoning') {
      const reasoningTok = nearestReasoningTokens(turn, event.order);
      const summaryText = textFromCodexReasoningSummary(payload.summary);
      segments.push({
        k: 'm',
        n: '模型生成',
        ms: 0,
        ts: event.timestamp,
        det: {
          think: summaryText || '（Codex 推理内容已加密或不可读；仅保留 reasoning token 统计。）',
          thinkTok: reasoningTok,
          inTok: nearestInputTokens(turn, event.order),
          outTok: nearestOutputTokens(turn, event.order),
        },
      });
    } else if (event.type === 'event_msg' && payload.type === 'agent_message' && typeof payload.message === 'string') {
      if (seenAssistantTexts.has(payload.message)) continue;
      seenAssistantTexts.add(payload.message);
      segments.push({
        k: 'm',
        n: '模型生成',
        ms: 0,
        ts: event.timestamp,
        det: {
          text: payload.message,
          textTok: roundTokens(payload.message),
          inTok: nearestInputTokens(turn, event.order),
          outTok: nearestOutputTokens(turn, event.order),
        },
      });
    } else if (event.type === 'response_item' && payload.type === 'message' && payload.role === 'assistant') {
      const text = textFromCodexContent(payload.content).trim();
      if (text && seenAssistantTexts.has(text)) continue;
      if (text) {
        seenAssistantTexts.add(text);
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
      }
    } else if (isToolCallPayload(payload)) {
      const call = calls.get(payload.call_id as string);
      if (!call) continue;
      tools[call.name] = (tools[call.name] ?? 0) + 1;
      incrementTool(cumTools, call.name);
      segments.push({
        k: 'm',
        n: '模型生成',
        ms: 0,
        ts: event.timestamp,
        det: {
          calls: [{ name: call.name, input: call.input, tok: roundTokens(call.name + call.input) }],
          inTok: nearestInputTokens(turn, event.order),
          outTok: nearestOutputTokens(turn, event.order),
        },
      });

      const result = results.get(call.callId);
      const resultTok = result ? roundTokens(result.output) : 0;
      if (result) addToolResultTokens(cumTools, call.name, resultTok);
      const stepTools = cloneTools(cumTools);
      segments.push({
        k: isSubAgentTool(call.name) ? 's' : 't',
        n: call.name,
        ms: result?.durationMs ?? 0,
        ts: result?.ts ?? call.ts,
        det: {
          name: call.name,
          input: call.input,
          result: result?.output ?? '（未发现匹配的 Codex 工具结果；该调用可能被中断或日志不完整。）',
          resultTok,
          isError: result ? result.isError : true,
          stepTools,
        },
      });
    }
  }

  if (segments.length === 0 && turn.tokenUsages.length > 0) {
    const last = turn.tokenUsages[turn.tokenUsages.length - 1]!;
    segments.push({
      k: 'm',
      n: '模型生成',
      ms: 0,
      ts: last.line.timestamp || turn.startTs,
      det: {
        text: '（Codex 日志记录了 token_count，但未记录可读的 assistant 文本、推理摘要或工具事件；该轮只展示 token 统计。）',
        textTok: 0,
        inTok: numberOrZero(last.usage.input_tokens),
        outTok: numberOrZero(last.usage.output_tokens),
      },
    });
  }

  if (segments.length === 0) {
    segments.push({
      k: 'm',
      n: '模型生成',
      ms: 0,
      ts: turn.startTs,
      det: {
        text: '（Codex 日志未记录可读的 assistant 事件或 token_count；该轮可能被中断、压缩，或来自早期日志格式。）',
        textTok: 0,
        inTok: 0,
        outTok: 0,
      },
    });
  }

  assignDurations(segments, turn);
  return { segments, tools };
}

function collectToolCalls(events: CodexLine[]): Map<string, ToolCall> {
  const calls = new Map<string, ToolCall>();
  for (const event of events) {
    const p = event.payload;
    if (!isToolCallPayload(p)) continue;
    const input = p.type === 'function_call' || p.type === 'tool_search_call'
      ? stringifyInput(p.arguments as string)
      : p.type === 'web_search_call'
        ? stringifyInput(p.action as string)
        : stringifyInput(p.input as string);
    calls.set(p.call_id as string, {
      callId: p.call_id as string,
      name: toolNameFor(p),
      input,
      ts: event.timestamp,
      order: event.order,
    });
  }
  return calls;
}

function collectToolResults(events: CodexLine[]): Map<string, ToolResult> {
  const results = new Map<string, ToolResult>();
  for (const event of events) {
    const p = event.payload;
    if (typeof p.call_id !== 'string') continue;

    if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') {
      results.set(p.call_id, {
        callId: p.call_id,
        output: outputToText(p.output),
        ts: event.timestamp,
        order: event.order,
        isError: false,
      });
    } else if (p.type === 'tool_search_output') {
      results.set(p.call_id, {
        callId: p.call_id,
        output: outputToText(p.tools ?? p),
        ts: event.timestamp,
        order: event.order,
        isError: p.status === 'failed',
      });
    } else if (p.type === 'web_search_end') {
      results.set(p.call_id, {
        callId: p.call_id,
        output: outputToText(p.action ?? p.query ?? p),
        ts: event.timestamp,
        order: event.order,
        isError: false,
      });
    } else if (p.type === 'mcp_tool_call_end') {
      const result = p.result as Record<string, unknown> | undefined;
      const ok = result?.Ok;
      const err = result?.Err;
      results.set(p.call_id, {
        callId: p.call_id,
        output: outputToText((ok as Record<string, unknown> | undefined)?.content ?? err ?? p.result),
        ts: event.timestamp,
        order: event.order,
        isError: (ok as Record<string, unknown> | undefined)?.isError === true || Boolean(err),
        durationMs: durationToMs(p.duration),
      });
    } else if (p.type === 'patch_apply_end' && !results.has(p.call_id)) {
      results.set(p.call_id, {
        callId: p.call_id,
        output: [p.stdout, p.stderr].filter((s) => typeof s === 'string' && s).join('\n') || outputToText(p),
        ts: event.timestamp,
        order: event.order,
        isError: p.success === false || p.status === 'failed',
      });
    }
  }
  return results;
}

function computeTokenMetrics(turn: CodexTurn): {
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
    lastInput = input;
    lastCacheHit = cache;
    if (input > maxInput) {
      maxInput = input;
      maxCacheHit = cache;
      maxReqIdx = idx;
      peakTs = line.timestamp;
    }
  });

  return {
    requestCount: turn.tokenUsages.length,
    maxInput,
    maxCacheHit,
    maxReqIdx,
    outTok,
    lastInput,
    lastCacheHit,
    peakTs,
  };
}

function computeSegmentMetrics(
  segments: TimelineSegment[],
  turn: CodexTurn,
  tokenMetrics: ReturnType<typeof computeTokenMetrics>,
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
  const durMs = turn.durationMs ?? Math.max(modelMs + toolMs + subMs, msBetween(turn.startTs, turn.endTs));
  if (segments.length === 0 && tokenMetrics.requestCount > 0) {
    modelMs = durMs;
    longest = { k: 'm', n: '模型生成', ms: durMs };
  }
  return { durMs, modelMs, toolMs, subMs, longest };
}

function assignDurations(segments: TimelineSegment[], turn: CodexTurn): void {
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    if (seg.ms > 0) continue;
    const next = segments[i + 1];
    const end = next?.ts || turn.endTs || turn.startTs;
    seg.ms = msBetween(seg.ts, end);
    if (seg.ms === 0 && seg.k === 'm') {
      const tok = (seg.det.outTok ?? 0) + (seg.det.thinkTok ?? 0) + (seg.det.textTok ?? 0);
      seg.ms = tok > 0 ? Math.max(1, Math.round(tok / 30) * 1000) : 0;
    }
  }
}

function aggregateCodexSession(
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

function initComp(seed?: Record<string, number>): Record<string, number> {
  const comp: Record<string, number> = {};
  for (const key of EMPTY_COMP_KEYS) comp[key] = seed?.[key] ?? 0;
  return comp;
}

function addTokens(comp: Record<string, number>, key: string, text: string): void {
  if (!text) return;
  // 使用模型感知估算：Codex 日志通常为英文/代码混合
  comp[key] = (comp[key] ?? 0) + Math.round(estimateTokensModelAware(text));
}

function addTokenCount(comp: Record<string, number>, key: string, count: number): void {
  if (!count) return;
  comp[key] = (comp[key] ?? 0) + Math.max(0, Math.round(count));
}

function deltaBetween(prev: Record<string, number>, curr: Record<string, number>): TurnDelta {
  const delta: TurnDelta = {};
  for (const key of ['thinking', 'asstText', 'toolCalls', 'toolResults', 'userMsgs', 'subagent'] as const) {
    const diff = (curr[key] ?? 0) - (prev[key] ?? 0);
    if (diff > 0) delta[key] = diff;
  }
  return delta;
}

function sumComp(comp: Record<string, number>): number {
  return Math.round(Object.values(comp).reduce((sum, value) => sum + value, 0));
}

function buildCodexCoreComp(
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

function applyCodexCalibrationFallback(
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

function codexInstructionText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (isObject(value) && typeof value.text === 'string') return value.text;
  return '';
}

function codexDeveloperCategory(text: string): string {
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

function nearestInputTokens(turn: CodexTurn, order: number): number {
  return nearestUsage(turn, order)?.input_tokens ?? 0;
}

function nearestOutputTokens(turn: CodexTurn, order: number): number {
  return nearestUsage(turn, order)?.output_tokens ?? 0;
}

function nearestReasoningTokens(turn: CodexTurn, order: number): number {
  return nearestUsage(turn, order)?.reasoning_output_tokens ?? 0;
}

function nearestUsage(turn: CodexTurn, order: number): TokenUsage | null {
  let nearest: TokenUsage | null = null;
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

function incrementTool(
  cumTools: Record<string, { calls: number; resultTokens: number; task: boolean }>,
  name: string,
): void {
  const existing = cumTools[name] ?? { calls: 0, resultTokens: 0, task: isTaskTool(name) || isSubAgentTool(name) };
  existing.calls++;
  cumTools[name] = existing;
}

function addToolResultTokens(
  cumTools: Record<string, { calls: number; resultTokens: number; task: boolean }>,
  name: string,
  resultTokens: number,
): void {
  const existing = cumTools[name] ?? { calls: 0, resultTokens: 0, task: isTaskTool(name) || isSubAgentTool(name) };
  existing.resultTokens += resultTokens;
  cumTools[name] = existing;
}

function cloneTools(tools: Record<string, { calls: number; resultTokens: number; task: boolean }>) {
  const out: Record<string, { calls: number; resultTokens: number; task: boolean }> = {};
  for (const [key, value] of Object.entries(tools)) out[key] = { ...value };
  return out;
}

function firstPayload(lines: CodexLine[], type: string): JsonObject | null {
  return lines.find((line) => line.type === type)?.payload ?? null;
}

function firstTurnCwd(turns: CodexTurn[]): string {
  for (const turn of turns) {
    for (const event of turn.events) {
      if (event.type === 'turn_context' && typeof event.payload.cwd === 'string') return event.payload.cwd;
    }
  }
  return '';
}

function isToolCallPayload(payload: JsonObject): boolean {
  return typeof payload.call_id === 'string' && (
    payload.type === 'function_call' ||
    payload.type === 'custom_tool_call' ||
    payload.type === 'web_search_call' ||
    payload.type === 'tool_search_call'
  );
}

function toolNameFor(payload: JsonObject): string {
  if (typeof payload.name === 'string') return payload.name;
  if (payload.type === 'web_search_call') return 'web_search';
  if (payload.type === 'tool_search_call') return 'tool_search';
  return 'unknown';
}

function stringifyInput(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input == null) return '';
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}

function outputToText(output: unknown): string {
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) {
    return output.map((item) => {
      if (typeof item === 'string') return item;
      if (isObject(item) && typeof item.text === 'string') return item.text;
      return stringifyInput(item);
    }).join('\n');
  }
  if (isObject(output) && typeof output.text === 'string') return output.text;
  return stringifyInput(output);
}

function textFromCodexContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(textFromCodexContentBlock).filter(Boolean).join('\n');
}

function textFromCodexContentBlock(block: unknown): string {
  if (!isObject(block)) return '';
  if ((block.type === 'input_text' || block.type === 'output_text' || block.type === 'text') && typeof block.text === 'string') {
    return block.text;
  }
  return '';
}

function textFromCodexReasoningSummary(summary: unknown): string {
  if (typeof summary === 'string') return summary.trim();
  if (!Array.isArray(summary)) return '';
  return summary.map((item) => {
    if (typeof item === 'string') return item.trim();
    if (!isObject(item)) return '';
    if (typeof item.text === 'string') return item.text.trim();
    if (typeof item.content === 'string') return item.content.trim();
    return '';
  }).filter(Boolean).join('\n\n');
}

function durationToMs(duration: unknown): number | undefined {
  if (!isObject(duration)) return undefined;
  const secs = typeof duration.secs === 'number' ? duration.secs : 0;
  const nanos = typeof duration.nanos === 'number' ? duration.nanos : 0;
  return Math.round(secs * 1000 + nanos / 1_000_000);
}

function msBetween(startIso: string, endIso: string): number {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (isNaN(start) || isNaN(end)) return 0;
  return Math.max(0, end - start);
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
