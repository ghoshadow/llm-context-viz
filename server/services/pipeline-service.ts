import { existsSync, readFileSync } from 'fs';
import { access, readFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { getDb } from '../db';
import { runPipeline, setMemoryChars, loadCalibratedConstants } from '../../shared/pipeline/index';
import { runCodexPipeline } from '../../shared/pipeline/codex-jsonl';
import { runOpenCodePipeline } from '../../shared/pipeline/opencode-jsonl';
import { runOpenClawPipeline } from '../../shared/pipeline/openclaw-jsonl';
import { runPiPipeline } from '../../shared/pipeline/pi-jsonl';
import { detectSessionFormat } from '../../shared/pipeline/session-format';
import type { SessionSummary, TurnData } from '../../shared/types/session';
import type Database from 'better-sqlite3';
import { readCalibrationConstants } from './calibration-constants';
import { memoryCategoryChars } from '../../shared/pipeline/calibration-types';
import type { ParseError } from '../../shared/pipeline/parse-jsonl';
import { getSessionSource, type SessionSource } from '../../shared/session-source';

// ============================================================================
// Shared pipeline service — eliminates duplicated import/refresh logic across
// POST /scanner/import and POST /sessions/:id/refresh.
// ============================================================================

/**
 * Compute total memory character count from the global CLAUDE.md and,
 * optionally, a project-level `.claude/CLAUDE.md` derived from the first
 * JSONL line's `cwd` field.
 *
 * 使用异步 fs/promises API，避免阻塞事件循环。
 */
export async function computeMemoryChars(jsonlContent?: string): Promise<number> {
  if (jsonlContent && detectSessionFormat(jsonlContent) !== 'claude') return 0;

  let memChars = 0;
  const globalMd = join(homedir(), '.claude', 'CLAUDE.md');
  try {
    await access(globalMd);
    const data = await readFile(globalMd, 'utf-8');
    memChars += data.length;
  } catch { /* keep default */ }

  const cwd = extractCwdFromJsonl(jsonlContent);
  if (cwd) {
    const projMd = join(cwd, '.claude', 'CLAUDE.md');
    try {
      await access(projMd);
      const data = await readFile(projMd, 'utf-8');
      memChars += data.length;
    } catch { /* ignore fs errors */ }
  }
  return memChars;
}

/**
 * 同步版本：在 better-sqlite3 transaction 回调内部使用。
 * 仍使用同步 fs API，但在事务中无法避免。
 */
export function computeMemoryCharsSync(jsonlContent?: string): number {
  if (jsonlContent && detectSessionFormat(jsonlContent) !== 'claude') return 0;

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

/**
 * 从 JSONL 内容中提取 cwd 字段。
 *
 * 优化：cwd 通常在前几条记录中，限制最多扫描前 50 行，
 * 避免在大型 JSONL 文件上完整遍历。
 */
export function extractCwdFromJsonl(jsonlContent?: string): string {
  if (!jsonlContent) return '';
  const lines = jsonlContent.split('\n');
  const limit = Math.min(lines.length, 50);
  for (let i = 0; i < limit; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (typeof parsed.cwd === 'string' && parsed.cwd) return parsed.cwd;
      if (parsed.type === 'session_meta' && typeof parsed.payload?.cwd === 'string') return parsed.payload.cwd;
      if (parsed.type === 'header' && typeof parsed.workingDirectory === 'string') return parsed.workingDirectory;
      if (parsed.type === 'session' && typeof parsed.cwd === 'string') return parsed.cwd;
      if (parsed.type === 'openclaw_session' && typeof parsed.cwd === 'string') return parsed.cwd;
      if (typeof parsed.part?.cwd === 'string') return parsed.part.cwd;
    } catch { /* ignore parse errors */ }
  }
  return '';
}

/**
 * Run the full pipeline on raw JSONL content (异步版本)。
 *
 * Side effects:
 * - Applies project-scoped calibrated constants from `<cwd>/.claude-trace/system-constants.json`
 * - Sets the global memory character count for context estimation
 *
 * 使用异步 I/O 读取 CLAUDE.md 文件，避免阻塞事件循环。
 */
export async function runPipelineOnContent(
  jsonlContent: string,
  filename: string,
): Promise<{ summary: SessionSummary; turns: TurnData[]; errors: ParseError[] }> {
  const format = detectSessionFormat(jsonlContent);
  switch (format) {
    case 'codex': {
      const cwd = extractCwdFromJsonl(jsonlContent);
      const constants = cwd ? readCalibrationConstants(cwd, 'codex') : null;
      return runCodexPipeline(jsonlContent, filename, constants);
    }
    case 'opencode':
      return runOpenCodePipeline(jsonlContent, filename);
    case 'openclaw':
      return runOpenClawPipeline(jsonlContent, filename);
    case 'pi-session':
    case 'pi-event-stream':
      return runPiPipeline(jsonlContent, filename);
    case 'claude':
      break;
    case 'unknown':
      throw new Error('Unsupported JSONL session format');
  }

  const cwd = extractCwdFromJsonl(jsonlContent);
  const constants = cwd ? readCalibrationConstants(cwd, 'claude') : null;
  loadCalibratedConstants(constants);
  if (!memoryCategoryChars(constants)) {
    setMemoryChars(await computeMemoryChars(jsonlContent));
  }
  return runPipeline(jsonlContent, filename);
}

/**
 * 同步版本：供 better-sqlite3 transaction 回调内部使用。
 * 事务回调必须是同步的，因此 I/O 仍使用同步 API。
 */
export function runPipelineOnContentSync(
  jsonlContent: string,
  filename: string,
): { summary: SessionSummary; turns: TurnData[]; errors: ParseError[] } {
  const format = detectSessionFormat(jsonlContent);
  switch (format) {
    case 'codex': {
      const cwd = extractCwdFromJsonl(jsonlContent);
      const constants = cwd ? readCalibrationConstants(cwd, 'codex') : null;
      return runCodexPipeline(jsonlContent, filename, constants);
    }
    case 'opencode':
      return runOpenCodePipeline(jsonlContent, filename);
    case 'openclaw':
      return runOpenClawPipeline(jsonlContent, filename);
    case 'pi-session':
    case 'pi-event-stream':
      return runPiPipeline(jsonlContent, filename);
    case 'claude':
      break;
    case 'unknown':
      throw new Error('Unsupported JSONL session format');
  }

  const cwd = extractCwdFromJsonl(jsonlContent);
  const constants = cwd ? readCalibrationConstants(cwd, 'claude') : null;
  loadCalibratedConstants(constants);
  if (!memoryCategoryChars(constants)) {
    setMemoryChars(computeMemoryCharsSync(jsonlContent));
  }
  return runPipeline(jsonlContent, filename);
}

/**
 * Persist an array of TurnData rows to the turns table.
 *
 * The caller is responsible for wrapping this in a transaction alongside the
 * session INSERT or UPDATE.
 *
 * 优化：预序列化所有 JSON 字段，再逐条批量插入。
 * 每次 JSON.stringify 只执行一次，避免重复序列化。
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

  // 预序列化：每条 turn 的 JSON 字段只序列化一次，避免重复调用 JSON.stringify
  for (const turn of turns) {
    const cumTools = turn.cumTools;
    const cumToolsJson = cumTools && Object.keys(cumTools).length > 0 ? JSON.stringify(cumTools) : null;
    const compJson = JSON.stringify(turn.comp);
    const deltaJson = JSON.stringify(turn.delta);
    const toolsJson = JSON.stringify(turn.tools);
    const segsJson = JSON.stringify(turn.segs);
    const longestJson = JSON.stringify(turn.longest);

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
      turn.cumCacheHit ?? 0,
      cumToolsJson,
      turn.compressionReset ? 1 : 0,
      turn.durMs,
      turn.modelMs,
      turn.toolMs,
      turn.subMs,
      turn.stepCount,
      compJson,
      deltaJson,
      toolsJson,
      segsJson,
      longestJson,
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
  errors: ParseError[];
}

function sourceForSummary(summary: SessionSummary, filename: string, source?: SessionSource): SessionSource {
  return source ?? getSessionSource({
    model: summary.session.model,
    version: summary.session.version,
    filename,
  });
}

function summaryForSource(summary: SessionSummary, source: SessionSource): SessionSummary {
  if (source !== 'openclaw' || summary.session.model !== 'pi') return summary;
  return { ...summary, session: { ...summary.session, model: 'openclaw' } };
}

/**
 * Insert a new session record and its turns inside a single transaction.
 *
 * Used by POST /scanner/import to create a fresh session.
 * The caller is responsible for dedup checking.
 *
 * 异步版本：在事务之外预先计算管线结果和序列化 JSON，
 * 事务内部只做纯 DB 写入（better-sqlite3 要求同步）。
 */
export async function createSession(opts: {
  jsonlContent: string;
  filename: string;
  hash: string;
  aiTitle?: string;
  rawJsonl?: string | null;
  source?: SessionSource;
}): Promise<ImportSessionResult> {
  const db = getDb();
  const parsed = await runPipelineOnContent(opts.jsonlContent, opts.filename);
  const source = sourceForSummary(parsed.summary, opts.filename, opts.source);
  const summary = summaryForSource(parsed.summary, source);
  const { turns, errors } = parsed;
  const sessionId = opts.hash.substring(0, 16);

  // 在事务外预序列化 JSON 列
  const categoriesJson = JSON.stringify(summary.categories);
  const toolsJson = JSON.stringify(summary.tools);
  const seriesJson = JSON.stringify(summary.series);

  const insertSession = db.prepare(`
    INSERT INTO sessions (
      id, filename, file_hash, source, model, version, ai_title, cwd,
      total_requests, peak_index, peak_tokens, peak_cache_hit, peak_turn_idx, peak_step,
      total_output, context_limit,
      turn_count, raw_size, categories_json, tools_json, series_json, raw_jsonl
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.transaction(() => {
    insertSession.run(
      sessionId,
      opts.filename,
      opts.hash,
      source,
      summary.session.model,
      summary.session.version,
      opts.aiTitle ?? summary.session.aiTitle ?? null,
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
      categoriesJson,
      toolsJson,
      seriesJson,
      opts.rawJsonl ?? null,
    );
    persistTurns(sessionId, turns);
  })();

  return { sessionId, summary, turns, errors };
}

/**
 * Replace all turns for an existing session — used by POST /sessions/:id/refresh.
 *
 * Runs the pipeline on the provided content, deletes old turns, inserts new
 * ones, and updates session metadata in a single transaction.
 *
 * 异步版本：在事务之外预先计算管线结果和序列化 JSON，
 * 事务内部只做纯 DB 写入。
 */
export async function refreshSession(opts: {
  sessionId: string;
  jsonlContent: string;
  filename: string;
  source?: SessionSource;
}): Promise<ImportSessionResult> {
  const db = getDb();
  const parsed = await runPipelineOnContent(opts.jsonlContent, opts.filename);
  const source = sourceForSummary(parsed.summary, opts.filename, opts.source);
  const summary = summaryForSource(parsed.summary, source);
  const { turns, errors } = parsed;

  // 在事务外预序列化 JSON 列
  const categoriesJson = JSON.stringify(summary.categories);
  const toolsJson = JSON.stringify(summary.tools);
  const seriesJson = JSON.stringify(summary.series);

  const deleteTurns = db.prepare('DELETE FROM turns WHERE session_id = ?');
  const updateSession = db.prepare(`
    UPDATE sessions SET
      source = ?, model = ?, version = ?,
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
      source,
      summary.session.model,
      summary.session.version,
      turns.length,
      summary.session.requests,
      summary.session.peakTokens,
      summary.session.peakCacheHit ?? 0,
      summary.session.peakTurnIdx ?? 0,
      summary.session.peakStep ?? 0,
      summary.session.totalOutput,
      summary.session.contextLimit,
      categoriesJson,
      toolsJson,
      seriesJson,
      opts.sessionId,
    );
  })();

  return { sessionId: opts.sessionId, summary, turns, errors };
}
