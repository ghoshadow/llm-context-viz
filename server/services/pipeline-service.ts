import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { getDb } from '../db';
import { runPipeline, setMemoryChars, loadCalibratedConstants } from '../../src/pipeline/index';
import { isCodexJsonl, runCodexPipeline } from '../../src/pipeline/codex-jsonl';
import type { SessionSummary, TurnData } from '../../src/types/session';
import type Database from 'better-sqlite3';
import { readCalibrationConstants, readProjectConstants } from './calibration-constants';

// ============================================================================
// Shared pipeline service — eliminates duplicated import/refresh logic across
// POST /scanner/import and POST /sessions/:id/refresh.
// ============================================================================

/**
 * Compute total memory character count from the global CLAUDE.md and,
 * optionally, a project-level `.claude/CLAUDE.md` derived from the first
 * JSONL line's `cwd` field.
 */
export function computeMemoryChars(jsonlContent?: string): number {
  if (jsonlContent && isCodexJsonl(jsonlContent)) return 0;

  let memChars = 0;
  try {
    const globalMd = join(homedir(), '.claude', 'CLAUDE.md');
    if (existsSync(globalMd)) memChars += readFileSync(globalMd, 'utf-8').length;
  } catch { /* keep default */ }

  const cwd = extractCwdFromJsonl(jsonlContent);
  if (cwd) {
    try {
      const projMd = join(cwd, '.claude', 'CLAUDE.md');
      if (existsSync(projMd)) memChars += readFileSync(projMd, 'utf-8').length;
    } catch { /* ignore fs errors */ }
  }
  return memChars;
}

export function extractCwdFromJsonl(jsonlContent?: string): string {
  if (!jsonlContent) return '';
  for (const line of jsonlContent.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (typeof parsed.cwd === 'string' && parsed.cwd) return parsed.cwd;
      if (parsed.type === 'session_meta' && typeof parsed.payload?.cwd === 'string') return parsed.payload.cwd;
    } catch { /* ignore parse errors */ }
  }
  return '';
}

/**
 * Run the full pipeline on raw JSONL content.
 *
 * Side effects:
 * - Applies project-scoped calibrated constants from `<cwd>/.claude-trace/system-constants.json`
 * - Sets the global memory character count for context estimation
 */
export function runPipelineOnContent(
  jsonlContent: string,
  filename: string,
): { summary: SessionSummary; turns: TurnData[] } {
  if (isCodexJsonl(jsonlContent)) {
    const cwd = extractCwdFromJsonl(jsonlContent);
    const constants = cwd ? readCalibrationConstants(cwd, 'codex') : null;
    return runCodexPipeline(jsonlContent, filename, constants);
  }

  const cwd = extractCwdFromJsonl(jsonlContent);
  const constants = cwd ? readProjectConstants(cwd) : null;
  loadCalibratedConstants(constants);
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

// ============================================================================
// Unified import-and-persist helper
// ============================================================================

export interface ImportSessionResult {
  sessionId: string;
  summary: SessionSummary;
  turns: TurnData[];
}

/**
 * Insert a new session record and its turns inside a single transaction.
 *
 * Used by POST /scanner/import to create a fresh session.
 * The caller is responsible for dedup checking.
 */
export function createSession(opts: {
  jsonlContent: string;
  filename: string;
  hash: string;
  aiTitle?: string;
  rawJsonl?: string | null;
}): ImportSessionResult {
  const db = getDb();
  const { summary, turns } = runPipelineOnContent(opts.jsonlContent, opts.filename);
  const sessionId = opts.hash.substring(0, 16);

  const insertSession = db.prepare(`
    INSERT INTO sessions (
      id, filename, file_hash, model, version, ai_title, cwd,
      total_requests, peak_index, peak_tokens, peak_cache_hit, peak_turn_idx, peak_step,
      total_output, context_limit,
      turn_count, raw_size, categories_json, tools_json, series_json, raw_jsonl
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.transaction(() => {
    insertSession.run(
      sessionId,
      opts.filename,
      opts.hash,
      summary.session.model,
      summary.session.version,
      opts.aiTitle ?? null,
      summary.session.cwd,
      summary.session.requests,
      summary.session.peakIndex,
      summary.session.peakTokens,
      summary.session.peakCacheHit ?? 0,
      summary.session.peakTurnIdx ?? 0,
      summary.session.peakStep ?? 0,
      summary.session.totalOutput,
      summary.session.contextLimit,
      turns.length,
      Buffer.byteLength(opts.jsonlContent, 'utf-8'),
      JSON.stringify(summary.categories),
      JSON.stringify(summary.tools),
      JSON.stringify(summary.series),
      opts.rawJsonl ?? null,
    );
    persistTurns(sessionId, turns);
  })();

  return { sessionId, summary, turns };
}

/**
 * Replace all turns for an existing session — used by POST /sessions/:id/refresh.
 *
 * Runs the pipeline on the provided content, deletes old turns, inserts new
 * ones, and updates session metadata in a single transaction.
 */
export function refreshSession(opts: {
  sessionId: string;
  jsonlContent: string;
  filename: string;
}): ImportSessionResult {
  const db = getDb();
  const { summary, turns } = runPipelineOnContent(opts.jsonlContent, opts.filename);

  const deleteTurns = db.prepare('DELETE FROM turns WHERE session_id = ?');
  const updateSession = db.prepare(`
    UPDATE sessions SET
      turn_count = ?, total_requests = ?, peak_tokens = ?,
      peak_cache_hit = ?, peak_turn_idx = ?, peak_step = ?,
      total_output = ?, context_limit = ?,
      categories_json = ?, tools_json = ?, series_json = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `);

  db.transaction(() => {
    deleteTurns.run(opts.sessionId);
    persistTurns(opts.sessionId, turns);
    updateSession.run(
      turns.length,
      summary.session.requests,
      summary.session.peakTokens,
      summary.session.peakCacheHit ?? 0,
      summary.session.peakTurnIdx ?? 0,
      summary.session.peakStep ?? 0,
      summary.session.totalOutput,
      summary.session.contextLimit,
      JSON.stringify(summary.categories),
      JSON.stringify(summary.tools),
      JSON.stringify(summary.series),
      opts.sessionId,
    );
  })();

  return { sessionId: opts.sessionId, summary, turns };
}
