import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { getDb } from '../db';
import { runPipeline, setMemoryChars, loadCalibratedConstants } from '../../src/pipeline/index';
import type { SessionSummary, TurnData } from '../../src/types/session';

// ============================================================================
// Shared pipeline service — eliminates duplicated import/refresh logic across
// POST /upload, POST /scanner/import, and POST /sessions/:id/refresh.
// ============================================================================

/**
 * Compute total memory character count from the global CLAUDE.md and,
 * optionally, a project-level `.claude/CLAUDE.md` derived from the first
 * JSONL line's `cwd` field.
 */
export function computeMemoryChars(jsonlContent?: string): number {
  let memChars = 0;
  try {
    const globalMd = join(homedir(), '.claude', 'CLAUDE.md');
    if (existsSync(globalMd)) memChars += readFileSync(globalMd, 'utf-8').length;
  } catch { /* keep default */ }

  // Project-level CLAUDE.md via cwd from the first line
  if (jsonlContent) {
    try {
      const firstLine = JSON.parse(jsonlContent.split('\n')[0]!);
      const cwd = firstLine.cwd;
      if (cwd) {
        const projMd = join(cwd, '.claude', 'CLAUDE.md');
        if (existsSync(projMd)) memChars += readFileSync(projMd, 'utf-8').length;
      }
    } catch { /* ignore parse errors */ }
  }
  return memChars;
}

/**
 * Run the full pipeline on raw JSONL content.
 *
 * Side effects:
 * - Reloads calibrated system constants from disk (system-constants.json)
 * - Sets the global memory character count for context estimation
 */
export function runPipelineOnContent(
  jsonlContent: string,
  filename: string,
): { summary: SessionSummary; turns: TurnData[] } {
  loadCalibratedConstants();
  setMemoryChars(computeMemoryChars(jsonlContent));
  return runPipeline(jsonlContent, filename);
}

/**
 * Persist an array of TurnData rows to the turns table.
 *
 * The caller is responsible for wrapping this in a transaction alongside the
 * session INSERT or UPDATE.
 */
export function persistTurns(sessionId: string, turns: TurnData[]): void {
  const stmt = getDb().prepare(`
    INSERT INTO turns (
      id, session_id, turn_index, prompt, timestamp, asst_reqs,
      max_input, max_cache_hit, max_req_idx, max_req_step, out_tok,
      cum_total, cum_cache_hit, cum_tools_json, compression_reset,
      dur_ms, model_ms, tool_ms, sub_ms,
      step_count, comp_json, delta_json, tools_json, segs_json, longest_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const turn of turns) {
    stmt.run(
      `${sessionId}_${turn.i}`,
      sessionId,
      turn.i,
      turn.prompt,
      turn.ts,
      turn.asstReqs,
      turn.maxInput,
      turn.maxCacheHit ?? 0,
      turn.maxReqIdx ?? 0,
      turn.maxReqStep ?? 0,
      turn.outTok,
      turn.cumTotal,
      (turn as any).cumCacheHit ?? 0,
      JSON.stringify((turn as any).cumTools ?? {}),
      (turn as any).compressionReset ? 1 : 0,
      turn.durMs,
      turn.modelMs,
      turn.toolMs,
      turn.subMs,
      turn.stepCount,
      JSON.stringify(turn.comp),
      JSON.stringify(turn.delta),
      JSON.stringify(turn.tools),
      JSON.stringify(turn.segs),
      JSON.stringify(turn.longest),
    );
  }
}
