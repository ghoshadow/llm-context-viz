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
  TimelineSegment,
  TurnDelta,
} from '../types/session';

import { parseJsonl } from './parse-jsonl';
import { identifyTurns } from './identify-turns';
import { computeContext } from './compute-context';
import { computeDeltas } from './compute-deltas';
import { computeTimeline } from './compute-timeline';
import { aggregateSession } from './aggregate-session';

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

export type { ParseError } from './parse-jsonl';
export type { TurnContextComposition, TokenEstimator } from './compute-context';
export type { TimelineResult } from './compute-timeline';

/**
 * Calibrate chars-per-token ratio from the first assistant message's usage data.
 *
 * The first request carries the full system scaffolding plus the first user message.
 * `usage.input_tokens` is the ground truth for how many tokens that content consumed.
 * Dividing the raw character count by the actual token count gives a per-session ratio
 * that accounts for language mix (Chinese/English/code) and model-specific tokenization.
 */
/**
 * Return a calibrated token estimator if API usage data is available;
 * otherwise fall back to a sensible default.
 *
 * The hardcoded system-module character counts used previously turned out to
 * be unreliable — the actual system prompt varies by CLI version, enabled
 * skills, MCP servers, etc.  Instead we use a fixed 3.5 chars/token ratio
 * that sits between ~4 (prose) and ~2.5 (code/JSON), giving reasonable
 * estimates for mixed-content Claude Code sessions.
 */
function calibrateEstimator(_groups: TurnGroup[]): TokenEstimator {
  return { estimate(text: string): number { return text.length / 3.5; } };
}

/** Default token estimator: ~4 chars per token (English text heuristic). */
const defaultEstimator: TokenEstimator = {
  estimate(text: string): number {
    return text.length / 4;
  },
};

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

  // Calibrate token estimator from actual API usage data
  const estimator = calibrateEstimator(groups);

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
    const prompt = extractPromptText(group.userLine);

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractPromptText(userLine: TurnGroup['userLine']): string {
  const content = userLine.message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const texts = content
      .filter((b) => b.type === 'text')
      .map((b) => b.text);
    return texts.join('\n');
  }
  return '';
}

// ---------------------------------------------------------------------------
// Progress-reporting variant (async)
// ---------------------------------------------------------------------------

/**
 * Run the full pipeline with progress callbacks.
 *
 * Useful for UI integration where each stage can update a progress bar.
 * The pipeline runs synchronously (no async work), but the Promise wrapper
 * allows the caller to `await` for completion and receive progress updates.
 *
 * @param jsonlText  Raw JSONL transcript string.
 * @param filename   Source filename.
 * @param onProgress Callback invoked at each stage boundary.
 * @returns          Promise resolving to the pipeline output.
 */
export function runPipelineWithProgress(
  jsonlText: string,
  filename: string,
  onProgress: (stage: string, percent: number) => void,
): Promise<{ summary: SessionSummary; turns: TurnData[]; errors: ParseError[] }> {
  return new Promise((resolve) => {
    // Stage 0
    onProgress('Parsing JSONL...', 0);
    const { lines, errors } = parseJsonl(jsonlText);

    // Yield to the event loop so UI can update between stages.
    setTimeout(() => {
      // Stage 1
      onProgress('Grouping turns...', 20);
      const groups = identifyTurns(lines);

      setTimeout(() => {
        // Stage 2
        onProgress('Computing context...', 30);
        const estimator = calibrateEstimator(groups);
        const compositions = computeContext(groups, estimator);

        setTimeout(() => {
          // Stage 3
          onProgress('Computing deltas...', 50);
          const deltas = computeDeltas(compositions);

          setTimeout(() => {
            // Stage 4
            onProgress('Computing timeline...', 65);
            const timelines = computeTimeline(groups, compositions);

            setTimeout(() => {
              // Stage 5
              onProgress('Aggregating session...', 85);
              const summary = aggregateSession(
                groups,
                compositions,
                timelines,
                filename,
              );

              // Assemble
              onProgress('Assembling result...', 95);
              const turns = assembleTurns(groups, compositions, deltas, timelines);

              onProgress('Done', 100);
              resolve({ summary, turns, errors });
            }, 0);
          }, 0);
        }, 0);
      }, 0);
    }, 0);
  });
}
