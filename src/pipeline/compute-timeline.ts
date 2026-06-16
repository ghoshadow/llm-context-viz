// ============================================================================
// Stage 4: Build execution timeline with detailed step information.
// ============================================================================

import type {
  TurnGroup,
  AssistantLine,
  AssistantMessage,
  ToolUseContent,
  UserLine,
  ContentBlockToolResult,
  TimelineSegment,
  SegmentDetail,
  ToolCallDetail,
  TimelineResult,
} from '../types/session';
import type { TurnContextComposition } from './compute-context';

// ---------------------------------------------------------------------------
// Token estimation (inline — consistent with other stages)
// ---------------------------------------------------------------------------

function estTokens(text: string): number {
  return text.length / 4;
}

function roundTok(text: string): number {
  return Math.round(estTokens(text));
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

function msBetween(startIso: string, endIso: string): number {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (isNaN(start) || isNaN(end)) return 0;
  return Math.max(0, end - start);
}

// ---------------------------------------------------------------------------
// Truncation detection
// ---------------------------------------------------------------------------

/** Max character length before text is flagged as potentially truncated. */
const TRUNC_LENGTH_THRESHOLD = 100_000;

/**
 * Whether the text appears truncated — ends mid-sentence without proper
 * sentence-ending punctuation.
 */
function isTruncated(text: string): boolean {
  if (text.length === 0) return false;
  if (text.length >= TRUNC_LENGTH_THRESHOLD) return true;

  const trimmed = text.trimEnd();
  if (trimmed.length === 0) return false;

  // Ends with sentence-ending punctuation → probably complete.
  const lastChar = trimmed[trimmed.length - 1];
  if (['.', '。', '!', '?', '！', '？', ')', '】', '」', '"', '"', '”'].includes(lastChar ?? '')) {
    return false;
  }

  // Ends with a closing bracket / tag / backtick group → also likely complete.
  if (['}', ']', '>', '`'].includes(lastChar ?? '')) return false;

  // Very short text that ends abruptly (e.g. mid-word) → truncated.
  const lastWord = trimmed.split(/\s+/).pop() ?? '';
  if (lastWord.length < 3 && /[a-zA-Z]/.test(lastWord)) return true;

  // Ends with comma, semicolon, colon, dash → likely mid-sentence.
  if ([',', ';', ':', '-', '—', '，', '；', '：'].includes(lastChar ?? '')) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Sub-agent detection
// ---------------------------------------------------------------------------

function isTaskTool(name: string): boolean {
  return name.startsWith('Task');
}

function isSubAgentTool(name: string): boolean {
  // Agent, Workflow (both spawn sub-agents) and Task* management commands
  return name === 'Agent' || name === 'Workflow' || isTaskTool(name);
}

// ---------------------------------------------------------------------------
// Tool result extraction
// ---------------------------------------------------------------------------

interface ToolResultData {
  content: string;
  is_error: boolean;
}

function extractToolResult(block: ContentBlockToolResult): ToolResultData {
  if (typeof block.content === 'string') {
    return { content: block.content, is_error: block.is_error ?? false };
  }
  // Multi-block tool result: concatenate text blocks.
  const parts: string[] = [];
  for (const inner of block.content) {
    if (inner.type === 'text') {
      parts.push(inner.text);
    }
  }
  return {
    content: parts.join('\n'),
    is_error: block.is_error ?? false,
  };
}

// ---------------------------------------------------------------------------
// Phase 1: Parse a single assistant message into m-type segments.
//
// In the prototype, a single assistant response is split into separate m-type
// segments for each logical phase:
//   1. Thinking phase — if the response has thinking content
//   2. Text phase     — if the response has text content
//   3. Tool-call phase — if the response has tool_use blocks
//
// All segments from the same assistant message share the same inTok/outTok
// (from usage). Each segment gets a duration proportional to its token count.
// ---------------------------------------------------------------------------

function buildModelSegments(asst: AssistantLine): TimelineSegment[] {
  const msg: AssistantMessage = asst.message;
  const blocks = msg.content;
  const segments: TimelineSegment[] = [];

  const inTok = msg.usage?.input_tokens ?? 0;
  const outTok = msg.usage?.output_tokens ?? 0;

  // Collect thinking text.
  let thinkText = '';
  for (const block of blocks) {
    if (block.type === 'thinking') {
      thinkText += (thinkText ? '\n' : '') + block.thinking;
    }
  }

  // Collect reply text.
  let replyText = '';
  for (const block of blocks) {
    if (block.type === 'text') {
      replyText += (replyText ? '\n' : '') + block.text;
    }
  }

  // Collect tool calls.
  const toolCalls: ToolCallDetail[] = [];
  for (const block of blocks) {
    if (block.type === 'tool_use') {
      const inputStr = JSON.stringify(block.input);
      const tok = roundTok(inputStr);
      const call: ToolCallDetail = {
        name: block.name,
        input: inputStr,
        tok,
      };
      if (inputStr.length >= TRUNC_LENGTH_THRESHOLD) {
        call.trunc = true;
      }
      toolCalls.push(call);
    }
  }

  // Build segment for thinking phase.
  if (thinkText) {
    const thinkTok = roundTok(thinkText);
    const detail: SegmentDetail = {
      think: thinkText,
      thinkTok,
      inTok,
      outTok,
    };
    if (thinkText.length >= TRUNC_LENGTH_THRESHOLD || isTruncated(thinkText)) {
      detail.thinkTrunc = true;
    }
    segments.push({
      k: 'm',
      n: '模型生成',
      ms: 0,
      ts: asst.timestamp,
      det: detail,
    });
  }

  // Build segment for text phase.
  if (replyText) {
    const textTok = roundTok(replyText);
    const detail: SegmentDetail = {
      text: replyText,
      textTok,
      inTok,
      outTok,
    };
    if (replyText.length >= TRUNC_LENGTH_THRESHOLD || isTruncated(replyText)) {
      detail.textTrunc = true;
    }
    segments.push({
      k: 'm',
      n: '模型生成',
      ms: 0,
      ts: asst.timestamp,
      det: detail,
    });
  }

  // Build segment for tool-call phase.
  if (toolCalls.length > 0) {
    const detail: SegmentDetail = {
      calls: toolCalls,
      inTok,
      outTok,
    };
    segments.push({
      k: 'm',
      n: '模型生成',
      ms: 0,
      ts: asst.timestamp,
      det: detail,
    });
  }

  // If no blocks produced any content, emit a minimal segment.
  if (segments.length === 0) {
    segments.push({
      k: 'm',
      n: '模型生成',
      ms: 0,
      ts: asst.timestamp,
      det: { inTok, outTok },
    });
  }

  return segments;
}

// ---------------------------------------------------------------------------
// Phase 2: Build tool-execution segment from a tool_use + tool_result pair.
// ---------------------------------------------------------------------------

function buildToolSegment(
  toolUse: ToolUseContent,
  toolResult: ToolResultData | null,
  ts: string,
): TimelineSegment {
  const inputStr = JSON.stringify(toolUse.input);
  const isSubAgent = isSubAgentTool(toolUse.name);

  const detail: SegmentDetail = {
    name: toolUse.name,
    input: inputStr,
    result: toolResult?.content ?? '',
    resultTok: toolResult ? roundTok(toolResult.content) : 0,
    isError: toolResult?.is_error ?? false,
  };

  if (toolResult && toolResult.content.length >= TRUNC_LENGTH_THRESHOLD) {
    detail.resultTrunc = true;
  }
  if (toolResult && isTruncated(toolResult.content)) {
    detail.resultTrunc = true;
  }

  return {
    k: isSubAgent ? 's' : 't',
    n: toolUse.name,
    ms: 0, // Filled in during duration assignment phase.
    ts,
    det: detail,
  };
}

// ---------------------------------------------------------------------------
// Tool-result matching: find the matching tool_result for a tool_use.
//
// The JSONL records tool_use blocks with unique IDs. Subsequent user messages
// carry tool_result blocks that reference those IDs.
// ---------------------------------------------------------------------------

function findMatchingResult(
  toolUseId: string,
  toolResultLines: UserLine[],
): ToolResultData | null {
  for (const trLine of toolResultLines) {
    const content = trLine.message.content;
    if (typeof content === 'string') continue;
    for (const block of content) {
      if (block.type === 'tool_result' && block.tool_use_id === toolUseId) {
        return extractToolResult(block as ContentBlockToolResult);
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Phase 3: Interleave model + tool segments into a unified timeline.
//
// Walk through all assistant messages' content[] blocks in chronological
// order. For each assistant message:
//   1. Emit ONE m-type segment (aggregating all content blocks from that
//      response — thinking + text + tool_use).
//   2. For each tool_use found, emit a t-type/s-type segment by matching
//      against tool_result user lines.
//
// The duration of each segment is calculated from the wall-clock gap
// between consecutive timestamps. For m-type segments spanning thinking →
// text → tool_use, the duration is from the asst message timestamp to
// the next event (next asst or tool result or turn end).
// ---------------------------------------------------------------------------

function interleaveSegments(group: TurnGroup): TimelineSegment[] {
  const segments: TimelineSegment[] = [];
  const toolResultLines = group.toolResultLines;

  for (let ai = 0; ai < group.asstLines.length; ai++) {
    const asst = group.asstLines[ai]!;

    // 1. Emit model segments (one per phase: thinking, text, tool-calls).
    const modelSegs = buildModelSegments(asst);
    for (const s of modelSegs) {
      segments.push(s);
    }

    // 2. Find tool_use blocks and emit tool-execution segments.
    for (const block of asst.message.content) {
      if (block.type !== 'tool_use') continue;

      const result = findMatchingResult(block.id, toolResultLines);
      if (result) {
        for (const trLine of toolResultLines) {
          const content = trLine.message.content;
          if (typeof content === 'string') continue;
          for (const trBlock of content) {
            if (trBlock.type === 'tool_result' && trBlock.tool_use_id === block.id) {
              // Use the tool result user message's timestamp.
              const toolSeg = buildToolSegment(block, result, trLine.timestamp);
              segments.push(toolSeg);
              break;
            }
          }
        }
      } else {
        // No matching result found — still emit the tool segment.
        segments.push(buildToolSegment(block, null, asst.timestamp));
      }
    }
  }

  return segments;
}

// ---------------------------------------------------------------------------
// Phase 4: Assign wall-clock durations to each segment.
//
// The prototype calculates duration as the gap between consecutive distinct
// wall-clock timestamps. M-type segments from the same assistant message share
// the same timestamp — their combined duration is the gap from that timestamp
// to the next event timestamp (tool result, next assistant, or turn end).
// This combined duration is then split proportionally by token count across
// the m-type segments belonging to the same group.
//
// For t-type/s-type segments, each has its own tool_result timestamp, so
// duration is from that timestamp to the next segment's timestamp.
// ---------------------------------------------------------------------------

function assignDurations(
  segments: TimelineSegment[],
  turnEndTs: string,
): void {
  if (segments.length === 0) return;

  // Build effective timestamps: merge consecutive segments that share
  // the same timestamp into groups. Each group gets a combined duration,
  // then splits it proportionally among its members.

  // First pass: assign raw durations from consecutive timestamps.
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const start = seg.ts;

    // Find the next segment with a DIFFERENT timestamp.
    let end = turnEndTs;
    for (let j = i + 1; j < segments.length; j++) {
      if (segments[j]!.ts !== start) {
        end = segments[j]!.ts;
        break;
      }
    }

    let dur = msBetween(start, end);

    // Cap the last segment: if it's the final segment and the gap to turnEndTs
    // exceeds 30 seconds, estimate from output tokens instead (avoid counting
    // inter-turn idle time as model work).
    if (end === turnEndTs && dur > 30000) {
      const outTok = seg.det.outTok ?? 0;
      dur = outTok > 0 ? Math.round(outTok / 30) * 1000 : 0; // ~30 tok/s
    }

    seg.ms = dur;
  }

  // Second pass: for consecutive segments sharing the same timestamp AND
  // having a non-zero combined duration, split proportionally by token count.
  let runStart = 0;
  while (runStart < segments.length) {
    const runTs = segments[runStart]!.ts;
    let runEnd = runStart + 1;
    while (runEnd < segments.length && segments[runEnd]!.ts === runTs) {
      runEnd++;
    }

    const runSize = runEnd - runStart;
    if (runSize > 1) {
      // Multiple segments share the same timestamp.
      // The first segment (index runStart) has the full duration;
      // subsequent segments have 0 (because no timestamp gap).
      // Split proportionally by token weight.
      const totalDur = segments[runStart]!.ms;
      if (totalDur > 0) {
        // Calculate token weights.
        const weights: number[] = [];
        let totalWeight = 0;
        for (let k = runStart; k < runEnd; k++) {
          const det = segments[k]!.det;
          const w =
            (det.thinkTok ?? 0) + (det.textTok ?? 0) +
            (det.calls?.reduce((s, c) => s + c.tok, 0) ?? 0) +
            1; // +1 to avoid zero weight
          weights.push(w);
          totalWeight += w;
        }

        if (totalWeight > 0) {
          let remainder = totalDur;
          for (let k = runStart; k < runEnd - 1; k++) {
            const w = weights[k - runStart]!;
            const share = Math.round((w / totalWeight) * totalDur);
            segments[k]!.ms = Math.max(1, share);
            remainder -= share;
          }
          // Last segment gets the remainder.
          segments[runEnd - 1]!.ms = Math.max(1, remainder);
        }
      }
    }

    runStart = runEnd;
  }
}

// ---------------------------------------------------------------------------
// Phase 5: Compute turn-level summary metrics.
// ---------------------------------------------------------------------------

interface TurnMetrics {
  durMs: number;
  modelMs: number;
  toolMs: number;
  subMs: number;
  stepCount: number;
  longest: { k: string; n: string; ms: number };
}

function computeTurnMetrics(
  segments: TimelineSegment[],
  turnDurMs: number,
): TurnMetrics {
  let modelMs = 0;
  let toolMs = 0;
  let subMs = 0;
  let longest: TurnMetrics['longest'] = { k: '', n: '', ms: 0 };

  for (const seg of segments) {
    if (seg.k === 'm') {
      modelMs += seg.ms;
    } else if (seg.k === 't') {
      toolMs += seg.ms;
    } else if (seg.k === 's') {
      subMs += seg.ms;
    }
    // idle segments contribute to total durMs but not model/tool/sub

    if (seg.ms > longest.ms) {
      longest = { k: seg.k, n: seg.n, ms: seg.ms };
    }
  }

  // stepCount: number of assistant API requests in this turn.
  const stepCount = segments.filter((s) => s.k === 'm').length;

  return {
    durMs: segments.reduce((sum, s) => sum + s.ms, 0),
    modelMs,
    toolMs,
    subMs,
    stepCount,
    longest: longest.ms > 0 ? longest : { k: '', n: '', ms: 0 },
  };
}

// ---------------------------------------------------------------------------
// Phase 6: Extract user prompt text.
// ---------------------------------------------------------------------------

function extractPrompt(userLine: UserLine): string {
  const content = userLine.message.content;
  if (typeof content === 'string') return content;
  const parts: string[] = [];
  for (const block of content) {
    if (block.type === 'text') {
      parts.push(block.text);
    }
  }
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Phase 7: Compute context composition info for the turn.
// ---------------------------------------------------------------------------

function computeContextInfo(
  segments: TimelineSegment[],
  comp: TurnContextComposition,
  group?: TurnGroup,
): { cumTotal: number; outTok: number } {
  // Use API actual total context (input + cache_read) from last assistant,
  // falling back to estimated composition sum
  let cumTotal = 0;
  if (group) {
    // Find the last assistant with usage data
    for (let i = group.asstLines.length - 1; i >= 0; i--) {
      const usage = group.asstLines[i]?.message.usage;
      if (usage) {
        cumTotal = usage.input_tokens + (usage.cache_read_input_tokens ?? 0);
        break;
      }
    }
  }
  if (cumTotal === 0) {
    cumTotal = Object.values(comp).reduce((a, b) => a + b, 0);
  }

  // outTok: total output tokens from all m-type segments.
  let outTok = 0;
  for (const seg of segments) {
    if (seg.k === 'm') {
      outTok += (seg.det.outTok ?? 0);
    }
  }

  return {
    cumTotal: Math.round(cumTotal),
    outTok: Math.round(outTok),
  };
}

// ============================================================================
// Main export
// ============================================================================

/**
 * Compute timeline segments and turn-level metrics for each turn.
 *
 * For each turn, this function:
 * 1. Walks through all assistant messages' content[] blocks in chronological order.
 * 2. Builds segments by interleaving:
 *    - m-type: model generation (thinking + text + tool calls from one assistant msg)
 *    - t-type: tool execution (from tool_use to tool_result pairing)
 *    - s-type: sub-agent execution (Task* tools with tool_result data)
 * 3. Calculates wall-clock duration for each segment from timestamps.
 * 4. Extracts detail (SegmentDetail) including thinking text, reply text,
 *    tool call inputs, token counts, and truncation flags.
 * 5. Computes turn-level metrics: total durMs, modelMs, toolMs, subMs,
 *    stepCount, and longest segment.
 *
 * @param groups       Turn groups (stage 1 output), including tool-result user lines.
 * @param compositions Per-turn cumulative context compositions (stage 2 output).
 * @returns            Array of TimelineResult, parallel to groups.
 */
export function computeTimeline(
  groups: TurnGroup[],
  compositions: TurnContextComposition[],
): TimelineResult[] {
  const results: TimelineResult[] = [];

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i]!;
    const comp = compositions[i] ?? {};

    if (group.asstLines.length === 0) {
      // Edge case: turn with no assistant responses.
      results.push({
        i,
        prompt: extractPrompt(group.userLine),
        ts: group.startTs,
        asstReqs: 0,
        maxInput: 0,
        maxCacheHit: 0,
        outTok: 0,
        tools: {},
        delta: {},
        durMs: 0,
        modelMs: 0,
        toolMs: 0,
        subMs: 0,
        stepCount: 0,
        longest: { k: '', n: '', ms: 0 },
        segs: [],
        comp: { ...comp },
        cumTotal: Math.round(Object.values(comp).reduce((a, b) => a + b, 0)),
      });
      continue;
    }

    // 1. Build interleaved segments.
    const segments = interleaveSegments(group);

    // Prepend idle segment for inter-turn gap (skip first turn)
    if (i > 0) {
      const prevEnd = groups[i-1]!.endTs;
      const gap = msBetween(prevEnd, group.startTs);
      if (gap > 1000) { // only show gaps > 1 second
        segments.unshift({
          k: 'i',
          n: '等待用户输入',
          ms: gap,
          ts: prevEnd,
          det: { name: 'idle', input: '' },
        } as TimelineSegment);
      }
    }

    // 2. Assign wall-clock durations.
    const turnDurMs = msBetween(group.startTs, group.endTs);
    assignDurations(segments, group.endTs);

    // 3. Compute turn-level metrics.
    const metrics = computeTurnMetrics(segments, turnDurMs);

    // 4. Compute context info.
    const { cumTotal, outTok } = computeContextInfo(segments, comp, group);

    // 5. Build tool usage summary.
    const tools: Record<string, number> = {};
    for (const seg of segments) {
      if (seg.k === 'm' && seg.det.calls) {
        for (const call of seg.det.calls) {
          tools[call.name] = (tools[call.name] ?? 0) + 1;
        }
      }
    }

    // 6. Count assistant requests.
    const asstReqs = group.asstLines.length;

    // 7. Max billed input tokens for this turn.
    let maxInput = 0;
    let maxCacheHit = 0;
    let maxReqIdx = 0;
    let maxReqStep = 0;
    let reqNo = 0;
    for (const asst of group.asstLines) {
      const usage = asst.message.usage;
      if (usage) {
        const billed = usage.input_tokens;
        if (billed > maxInput) {
          maxInput = billed;
          maxCacheHit = usage.cache_read_input_tokens ?? 0;
          maxReqIdx = reqNo;
          let stepIdx = 0;
          for (const seg of segments) {
            if (seg.ts === asst.timestamp) { maxReqStep = stepIdx; break; }
            stepIdx++;
          }
        }
        reqNo++;
      }
    }

    // 8. Build delta (delegated to compute-deltas stage).
    const delta = {};

    // 9. Build the result.
    results.push({
      i, // 0-based index (matching array position).
      prompt: extractPrompt(group.userLine),
      ts: group.startTs,
      asstReqs,
      maxInput,
      maxCacheHit,
      maxReqIdx,
      maxReqStep,
      outTok,
      tools,
      delta,
      durMs: metrics.durMs,
      modelMs: metrics.modelMs,
      toolMs: metrics.toolMs,
      subMs: metrics.subMs,
      stepCount: metrics.stepCount,
      longest: metrics.longest,
      segs: segments,
      comp: { ...comp },
      cumTotal,
    });
  }

  return results;
}

// Re-export TimelineResult for consumers (imported from session types).
export type { TimelineResult };
