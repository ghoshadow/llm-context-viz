/**
 * session-repository.ts — 会话数据访问层。
 *
 * 从 sessions.ts 和 scanner.ts 的路由中提取所有原始 SQL 查询，
 * 提供类型安全的函数式接口。
 */

import { getDb } from '../db';

// ── 轻量类型（只描述查询返回的列） ──────────────────────────────────────────

export interface SessionListItem {
  id: string;
  filename: string;
  cwd: string | null;
  model: string | null;
  version: string | null;
  ai_title: string | null;
  total_requests: number | null;
  peak_tokens: number | null;
  turn_count: number | null;
  created_at: string | null;
}

export interface SessionDetail {
  id: string;
  filename: string;
  file_hash: string;
  model: string | null;
  version: string | null;
  ai_title: string | null;
  cwd: string | null;
  total_requests: number | null;
  peak_index: number | null;
  peak_tokens: number | null;
  peak_cache_hit: number | null;
  peak_turn_idx: number | null;
  peak_step: number | null;
  total_output: number | null;
  context_limit: number | null;
  turn_count: number | null;
  raw_size: number | null;
  categories_json: string | null;
  tools_json: string | null;
  series_json: string | null;
  raw_jsonl: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface SessionBrief {
  id: string;
  cwd: string | null;
  model: string | null;
  filename: string | null;
  version: string | null;
}

export interface TurnListItem {
  id: string;
  turn_index: number;
  prompt: string | null;
  timestamp: string | null;
  asst_reqs: number | null;
  max_input: number | null;
  max_cache_hit: number | null;
  max_req_idx: number | null;
  max_req_step: number | null;
  out_tok: number | null;
  cum_total: number | null;
  cum_cache_hit: number | null;
  compression_reset: number | null;
  dur_ms: number | null;
  step_count: number | null;
}

export interface TurnDetail extends TurnListItem {
  session_id: string;
  cum_tools_json: string | null;
  comp_json: string | null;
  delta_json: string | null;
  tools_json: string | null;
  segs_json: string | null;
  longest_json: string | null;
}

export interface ScannedFileRow {
  path: string;
  title: string | null;
  model: string | null;
  requests: number;
  peak_tokens: number;
  turn_count: number;
  hash: string;
  modified: string;
}

export interface TranslationRow {
  step_index: number;
  section_index: number;
  translated_text: string;
}

export interface ProjectConstantTranslationRow {
  translated_text: string;
}

// ── Session CRUD ────────────────────────────────────────────────────────────

/** 获取所有会话列表（仅必要的列）。 */
export function getAllSessions(): SessionListItem[] {
  return getDb()
    .prepare(
      `SELECT id, filename, cwd, model, version, ai_title, total_requests, peak_tokens, turn_count, created_at
       FROM sessions
       ORDER BY created_at DESC`,
    )
    .all() as SessionListItem[];
}

/** 根据 ID 获取会话详情。不存在返回 undefined。 */
export function getSessionById(id: string): SessionDetail | undefined {
  return getDb()
    .prepare(
      `SELECT id, filename, file_hash, model, version, ai_title, cwd,
              total_requests, peak_index, peak_tokens, peak_cache_hit,
              peak_turn_idx, peak_step, total_output, context_limit,
              turn_count, raw_size, categories_json, tools_json, series_json,
              raw_jsonl, created_at, updated_at
       FROM sessions
       WHERE id = ?`,
    )
    .get(id) as SessionDetail | undefined;
}

/** 删除会话及其关联数据（CASCADE）。返回实际删除的行数。 */
export function deleteSession(id: string): number {
  const result = getDb().prepare('DELETE FROM sessions WHERE id = ?').run(id);
  return result.changes;
}

/** 根据文件哈希查找已导入的会话 ID。 */
export function findSessionByHash(hash: string): { id: string } | undefined {
  return getDb()
    .prepare('SELECT id FROM sessions WHERE file_hash = ?')
    .get(hash) as { id: string } | undefined;
}

/** 根据文件名查找已存在的会话。 */
export function findSessionByPath(filename: string): { filename: string } | undefined {
  return getDb()
    .prepare('SELECT filename FROM sessions WHERE filename = ?')
    .get(filename) as { filename: string } | undefined;
}

/** 检查会话是否存在。 */
export function sessionExists(id: string): boolean {
  const row = getDb().prepare('SELECT 1 FROM sessions WHERE id = ?').get(id);
  return !!row;
}

/** 获取会话简要信息（用于 translate 等需要 source/meta 的场景）。 */
export function getSessionBrief(id: string): SessionBrief | undefined {
  return getDb()
    .prepare('SELECT id, cwd, model, filename, version FROM sessions WHERE id = ?')
    .get(id) as SessionBrief | undefined;
}

/** 获取全部已导入的文件名列表（用于扫描去重）。 */
export function getAllImportedFilenames(): string[] {
  const rows = getDb()
    .prepare('SELECT filename FROM sessions')
    .all() as { filename: string }[];
  return rows.map((r) => r.filename);
}

/** 获取会话的 raw_jsonl 字段与文件名。 */
export function getSessionRawJsonlMeta(sessionId: string): { id: string; raw_jsonl: string | null; filename: string } | undefined {
  return getDb()
    .prepare('SELECT id, raw_jsonl, filename FROM sessions WHERE id = ?')
    .get(sessionId) as { id: string; raw_jsonl: string | null; filename: string } | undefined;
}

/** 获取刷新所需的会话元信息（含 file_hash 和 raw_jsonl）。 */
export function getSessionForRefresh(sessionId: string): { id: string; filename: string; file_hash: string; raw_jsonl: string | null } | undefined {
  return getDb()
    .prepare('SELECT id, filename, file_hash, raw_jsonl FROM sessions WHERE id = ?')
    .get(sessionId) as { id: string; filename: string; file_hash: string; raw_jsonl: string | null } | undefined;
}

// ── Turn 查询 ──────────────────────────────────────────────────────────────

/** 获取会话的所有轮次（仅列表字段）。支持 LIMIT/OFFSET 分页。 */
export function getSessionTurns(
  sessionId: string,
  options?: { limit?: number; offset?: number },
): TurnListItem[] {
  const sql = `SELECT id, turn_index, prompt, timestamp, asst_reqs, max_input, max_cache_hit, max_req_idx, max_req_step, out_tok, cum_total, cum_cache_hit, compression_reset, dur_ms, step_count
   FROM turns
   WHERE session_id = ?
   ORDER BY turn_index DESC`;
  if (options?.limit != null) {
    return getDb()
      .prepare(`${sql} LIMIT ? OFFSET ?`)
      .all(sessionId, options.limit, options.offset ?? 0) as TurnListItem[];
  }
  return getDb().prepare(sql).all(sessionId) as TurnListItem[];
}

/** 获取会话的轮次总数。 */
export function getTurnCount(sessionId: string): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS total FROM turns WHERE session_id = ?')
    .get(sessionId) as { total: number };
  return row.total;
}

/** 根据轮次索引获取单个轮次详情（所有列）。 */
export function getTurnByIndex(sessionId: string, turnIndex: number): TurnDetail | undefined {
  return getDb()
    .prepare('SELECT * FROM turns WHERE session_id = ? AND turn_index = ?')
    .get(sessionId, turnIndex) as TurnDetail | undefined;
}

// ── 扫描缓存 ───────────────────────────────────────────────────────────────

/** 获取全部扫描文件缓存记录。 */
export function getAllScannedFiles(): ScannedFileRow[] {
  return getDb().prepare('SELECT * FROM scanned_files').all() as ScannedFileRow[];
}

/** 写入或更新一条扫描文件缓存。 */
export function upsertScannedFile(record: {
  path: string;
  name: string;
  size: number;
  modified: string;
  hash: string;
  title: string | null;
  model: string | null;
  requests: number;
  peakTokens: number;
  turnCount: number;
}): void {
  getDb()
    .prepare(
      `INSERT INTO scanned_files (path, name, size, modified, hash, title, model, requests, peak_tokens, turn_count, last_seen)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(path) DO UPDATE SET
         size=excluded.size, modified=excluded.modified, hash=excluded.hash,
         title=excluded.title, model=excluded.model, requests=excluded.requests,
         peak_tokens=excluded.peak_tokens, turn_count=excluded.turn_count,
         last_seen=excluded.last_seen`,
    )
    .run(
      record.path,
      record.name,
      record.size,
      record.modified,
      record.hash,
      record.title,
      record.model,
      record.requests,
      record.peakTokens,
      record.turnCount,
    );
}

/** 清空扫描文件缓存。 */
export function clearScannedFiles(): void {
  getDb().prepare('DELETE FROM scanned_files').run();
}

// ── 翻译缓存 ───────────────────────────────────────────────────────────────

/** 查询轮次翻译缓存（按 session + turn + step + section）。 */
export function getCachedTranslation(
  sessionId: string,
  turnIndex: number,
  stepIndex: number,
  sectionIndex: number,
): { translated_text: string } | undefined {
  return getDb()
    .prepare(
      'SELECT translated_text FROM turn_translations WHERE session_id = ? AND turn_index = ? AND step_index = ? AND section_index = ?',
    )
    .get(sessionId, turnIndex, stepIndex, sectionIndex) as
    | { translated_text: string }
    | undefined;
}

/** 写入或替换一条轮次翻译缓存。 */
export function upsertTurnTranslation(
  sessionId: string,
  turnIndex: number,
  stepIndex: number,
  sectionIndex: number,
  translatedText: string,
): void {
  getDb()
    .prepare(
      'INSERT OR REPLACE INTO turn_translations (session_id, turn_index, step_index, section_index, translated_text) VALUES (?, ?, ?, ?, ?)',
    )
    .run(sessionId, turnIndex, stepIndex, sectionIndex, translatedText);
}

/** 查询项目级常量翻译缓存。 */
export function getProjectConstantTranslation(
  projectCwd: string,
  source: string,
  sectionIndex: number,
): { translated_text: string } | undefined {
  return getDb()
    .prepare(
      'SELECT translated_text FROM project_constant_translations WHERE project_cwd = ? AND source = ? AND section_index = ?',
    )
    .get(projectCwd, source, sectionIndex) as
    | { translated_text: string }
    | undefined;
}

/** 写入或更新项目级常量翻译缓存。 */
export function upsertProjectConstantTranslation(
  projectCwd: string,
  source: string,
  sectionIndex: number,
  translatedText: string,
): void {
  getDb()
    .prepare(
      `INSERT INTO project_constant_translations (project_cwd, source, section_index, translated_text, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(project_cwd, source, section_index)
       DO UPDATE SET translated_text = excluded.translated_text, updated_at = datetime('now')`,
    )
    .run(projectCwd, source, sectionIndex, translatedText);
}

/** 获取某个轮次的所有已缓存翻译。 */
export function getTurnTranslations(
  sessionId: string,
  turnIndex: number,
): TranslationRow[] {
  return getDb()
    .prepare(
      'SELECT step_index, section_index, translated_text FROM turn_translations WHERE session_id = ? AND turn_index = ?',
    )
    .all(sessionId, turnIndex) as TranslationRow[];
}

/** 批量获取项目常量翻译（按多个 section_index）。 */
export function getProjectConstantTranslationBatch(
  projectCwd: string,
  source: string,
  sectionIndices: number[],
): Array<{ section_index: number; translated_text: string }> {
  if (sectionIndices.length === 0) return [];
  const placeholders = sectionIndices.map(() => '?').join(',');
  const stmt = getDb().prepare(
    `SELECT section_index, translated_text FROM project_constant_translations WHERE project_cwd = ? AND source = ? AND section_index IN (${placeholders})`,
  );
  return stmt.all(projectCwd, source, ...sectionIndices) as Array<{
    section_index: number;
    translated_text: string;
  }>;
}
