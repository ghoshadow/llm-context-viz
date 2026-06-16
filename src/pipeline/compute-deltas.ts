// ============================================================================
// Stage 3: Compute context deltas between consecutive turns
// ============================================================================

import type { TurnDelta } from '../types/session';

/** One turn's context composition: category key -> cumulative tokens. */
export type TurnContextComposition = Record<string, number>;

/**
 * Compute per-category token deltas between consecutive turns.
 *
 * For each turn (except the first), delta[category] = current.tokens - previous.tokens.
 * Only positive deltas (new content added) are included; unchanged or decreased
 * categories are omitted from the result.
 */
export function computeDeltas(
  compositions: TurnContextComposition[]
): TurnDelta[] {
  const deltas: TurnDelta[] = [];

  for (let i = 1; i < compositions.length; i++) {
    const prev = compositions[i - 1]!;
    const curr = compositions[i]!;
    const delta: TurnDelta = {};

    for (const key of Object.keys(curr)) {
      const prevTokens = prev[key] ?? 0;
      const currTokens = curr[key] ?? 0;
      const diff = currTokens - prevTokens;

      // Only include positive deltas (new content added)
      if (diff > 0 && isTurnDeltaKey(key)) {
        delta[key] = diff;
      }
    }

    deltas.push(delta);
  }

  return deltas;
}

const TURN_DELTA_KEYS: ReadonlySet<string> = new Set([
  'thinking',
  'asstText',
  'toolCalls',
  'toolResults',
  'userMsgs',
  'subagent',
] satisfies (keyof TurnDelta)[]);

function isTurnDeltaKey(key: string): key is keyof TurnDelta {
  return TURN_DELTA_KEYS.has(key);
}
