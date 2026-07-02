import type { TimelineSegment } from '../types/session';
import { isSubAgentTool, roundTokens } from './utils';
import type { CodexLine, CodexTurn, TokenUsage, ToolCall, ToolResult } from './codex-jsonl-types';
import {
  durationToMs,
  isToolCallPayload,
  msBetween,
  numberOrZero,
  outputToText,
  stringifyInput,
  textFromCodexContent,
  textFromCodexReasoningSummary,
  toolNameFor,
} from './codex-jsonl-parser';

interface SegmentToolState {
  incrementTool: (
    cumTools: Record<string, { calls: number; resultTokens: number; task: boolean }>,
    name: string,
  ) => void;
  addToolResultTokens: (
    cumTools: Record<string, { calls: number; resultTokens: number; task: boolean }>,
    name: string,
    resultTokens: number,
  ) => void;
  cloneTools: (
    tools: Record<string, { calls: number; resultTokens: number; task: boolean }>,
  ) => Record<string, { calls: number; resultTokens: number; task: boolean }>;
}

export function buildSegments(
  turn: CodexTurn,
  cumTools: Record<string, { calls: number; resultTokens: number; task: boolean }>,
  toolState: SegmentToolState,
): { segments: TimelineSegment[]; tools: Record<string, number> } {
  const calls = collectToolCalls(turn.events);
  const results = collectToolResults(turn.events);
  const segments: TimelineSegment[] = [];
  const tools: Record<string, number> = {};
  const seenAssistantTexts = new Set<string>();
  let compactedEventPending = false;

  for (const event of turn.events) {
    const payload = event.payload;
    if (event.type === 'compacted') {
      compactedEventPending = true;
      segments.push({
        k: 'i',
        n: '上下文压缩',
        ms: 0,
        ts: event.timestamp,
        det: {
          text: 'Codex 在本轮执行中触发上下文压缩，后续步骤基于压缩后的新窗口继续。',
        },
      });
    } else if (event.type === 'event_msg' && payload.type === 'context_compacted') {
      if (compactedEventPending) {
        compactedEventPending = false;
        continue;
      }
      segments.push({
        k: 'i',
        n: '上下文压缩',
        ms: 0,
        ts: event.timestamp,
        det: {
          text: 'Codex 在本轮执行中触发上下文压缩，后续步骤基于压缩后的新窗口继续。',
        },
      });
    } else if (event.type === 'response_item' && payload.type === 'reasoning') {
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
      toolState.incrementTool(cumTools, call.name);
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
      if (result) toolState.addToolResultTokens(cumTools, call.name, resultTok);
      const stepTools = toolState.cloneTools(cumTools);
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

export function collectToolCalls(events: CodexLine[]): Map<string, ToolCall> {
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

export function collectToolResults(events: CodexLine[]): Map<string, ToolResult> {
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

export function computeTokenMetrics(turn: CodexTurn): {
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
  let lastCompactOrder = -1;

  for (const event of turn.events) {
    if (event.type === 'compacted' || (event.type === 'event_msg' && event.payload.type === 'context_compacted')) {
      lastCompactOrder = event.order;
    }
  }

  turn.tokenUsages.forEach(({ line, usage }, idx) => {
    const input = numberOrZero(usage.input_tokens);
    const cache = numberOrZero(usage.cached_input_tokens);
    const output = numberOrZero(usage.output_tokens);
    outTok += output;
    if (input > 0 || cache > 0 || output > 0) {
      if (lastCompactOrder < 0 || line.order > lastCompactOrder) {
        lastInput = input;
        lastCacheHit = cache;
      }
    }
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

export function computeSegmentMetrics(
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

export function assignDurations(segments: TimelineSegment[], turn: CodexTurn): void {
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

export function nearestInputTokens(turn: CodexTurn, order: number): number {
  return nearestUsage(turn, order)?.input_tokens ?? 0;
}

export function nearestOutputTokens(turn: CodexTurn, order: number): number {
  return nearestUsage(turn, order)?.output_tokens ?? 0;
}

export function nearestReasoningTokens(turn: CodexTurn, order: number): number {
  return nearestUsage(turn, order)?.reasoning_output_tokens ?? 0;
}

export function nearestUsage(turn: CodexTurn, order: number): TokenUsage | null {
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

export function findPeakStep(segments: TimelineSegment[], peakTs: string): number {
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
