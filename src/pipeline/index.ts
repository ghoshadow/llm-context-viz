// ============================================================================
// Pipeline Orchestrator
//
// Chains all 5 processing stages and assembles the final output.
//
// Stages:
//   0. parseJsonl      — Parse raw JSONL text into typed line entries
//   1. identifyTurns   — Group lines into conversation turns
//   2. computeContext   — Compute cumulative context composition per turn
//   3. computeDeltas    — Compute per-category token deltas between turns
//   4. computeTimeline  — Decompose each turn into timeline segments
//   5. aggregateSession — Build session-level summary from turn data
// ============================================================================

import type {
  SessionSummary,
  TurnData,
  TurnGroup,
  TurnDelta,
} from '../types/session';

import { parseJsonl } from './parse-jsonl';
import { identifyTurns } from './identify-turns';
import { computeContext } from './compute-context';
import { computeDeltas } from './compute-deltas';
import { computeTimeline } from './compute-timeline';
import { aggregateSession } from './aggregate-session';
import { estimateTokens, extractPromptText } from './utils';

import type { ParseError } from './parse-jsonl';
import type { TurnContextComposition, TokenEstimator } from './compute-context';
import type { TimelineResult } from './compute-timeline';

// ---------------------------------------------------------------------------
// Re-exports for consumers that want individual stages
// ---------------------------------------------------------------------------

export { parseJsonl } from './parse-jsonl';
export { identifyTurns } from './identify-turns';
export { computeContext, setMemoryChars } from './compute-context';
// Re-export for server-side use
export { loadCalibratedConstants } from './compute-context';
export { computeDeltas } from './compute-deltas';
export { computeTimeline } from './compute-timeline';
export { aggregateSession } from './aggregate-session';
// Re-export shared utilities
export { estimateTokens, CHARS_PER_TOKEN, isSubAgentTool, isTaskTool } from './utils';

export type { ParseError } from './parse-jsonl';
export type { TurnContextComposition, TokenEstimator } from './compute-context';
export type { TimelineResult } from './compute-timeline';
export type { NormalizedCalibration, NormalizedCalibrationSummary } from './calibration-types';

// ---------------------------------------------------------------------------
// Primary pipeline function (synchronous)
// ---------------------------------------------------------------------------

/**
 * Run the full pipeline on a JSONL transcript string.
 *
 * @param jsonlText Raw newline-delimited JSON session transcript.
 * @param filename  Source filename (for metadata / provenance).
 * @returns         Parsed and processed session data.
 */
export function runPipeline(jsonlText: string, filename: string): {
  summary: SessionSummary;
  turns: TurnData[];
  errors: ParseError[];
} {
  // Stage 0: Parse JSONL
  const { lines, errors } = parseJsonl(jsonlText);

  // Stage 1: Group into turns
  const groups: TurnGroup[] = identifyTurns(lines);

  // Use the shared 3.0 chars/token estimator (see utils.ts for rationale)
  const estimator: TokenEstimator = { estimate: estimateTokens };

  // Stage 2: Compute cumulative context composition
  const compositions: TurnContextComposition[] = computeContext(groups, estimator);

  // Stage 3: Compute per-category deltas between consecutive turns
  const deltas: TurnDelta[] = computeDeltas(compositions);

  // Stage 4: Compute timeline segments per turn
  const timelines: TimelineResult[] = computeTimeline(groups, compositions);

  // Stage 5: Aggregate session-level summary
  const summary: SessionSummary = aggregateSession(
    groups,
    compositions,
    timelines,
    filename,
  );

  // Assemble TurnData[] by merging groups[i] + compositions[i] + deltas[i] + timelines[i]
  const turns: TurnData[] = assembleTurns(groups, compositions, deltas, timelines);

  return { summary, turns, errors };
}

// ---------------------------------------------------------------------------
// Assemble TurnData from parallel arrays
// ---------------------------------------------------------------------------

function assembleTurns(
  groups: TurnGroup[],
  compositions: TurnContextComposition[],
  deltas: TurnDelta[],
  timelines: TimelineResult[],
): TurnData[] {
  const turns: TurnData[] = [];

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i]!;
    const comp = compositions[i] ?? {};
    // deltas[i-1] covers the transition from turn i-1 to i; turn 0 has no delta
    const delta = i > 0 ? (deltas[i - 1] ?? {}) : {};
    const tl = timelines[i];

    // Extract user prompt text from the initiating user line
    const prompt = extractPromptText(group.userLine.message.content);

    // Tool usage: count tool_use blocks by name across all assistant lines
    const tools: Record<string, number> = {};
    for (const asst of group.asstLines) {
      for (const block of asst.message.content) {
        if (block.type === 'tool_use') {
          tools[block.name] = (tools[block.name] || 0) + 1;
        }
      }
    }

    // Use API actual total context from timeline, fall back to composition sum
    const cumTotal = tl?.cumTotal
      ? tl.cumTotal
      : Math.round(Object.values(comp).reduce((a, b) => a + b, 0));

    // Max input: use the actual per-request peak from timeline; 0 is valid (no API calls)
    const maxInput = tl != null ? Math.max(tl.maxInput, 0) : cumTotal;

    // Output tokens: use summary from timeline or fall back to composition
    const outTok = tl ? tl.outTok : Math.round((comp.thinking || 0) + (comp.asstText || 0));

    // Duration: use sum of segment durations from timeline (modelMs+toolMs+subMs),
    // which represents actual work time, not wall-clock gaps between turns
    const durMs = tl != null
      ? (tl.modelMs || 0) + (tl.toolMs || 0) + (tl.subMs || 0)
      : Math.max(0, new Date(group.endTs).getTime() - new Date(group.startTs).getTime());

    const turn: TurnData = {
      i,
      prompt,
      ts: group.startTs,
      asstReqs: group.asstLines.length,
      maxInput,
      maxCacheHit: tl?.maxCacheHit ?? 0,
      maxReqIdx: tl?.maxReqIdx ?? 0,
      maxReqStep: tl?.maxReqStep ?? 0,
      outTok,
      tools,
      delta,
      durMs,
      modelMs: tl?.modelMs ?? 0,
      toolMs: tl?.toolMs ?? 0,
      subMs: tl?.subMs ?? 0,
      stepCount: group.asstLines.length,
      longest: tl?.longest ?? { k: '', n: '', ms: 0 },
      segs: tl?.segs ?? [],
      comp: { ...comp },
      cumTotal,
      cumCacheHit: (tl as any)?.cumCacheHit ?? 0,
      cumTools: (tl as any)?.cumTools ?? {},
      compressionReset: (tl as any)?.compressionReset ?? false,
    };

    turns.push(turn);
  }

  return turns;
}
