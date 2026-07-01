/**
 * ontology-repository.ts — 本体数据访问层。
 *
 * 从 ontology.ts 路由中提取所有原始 SQL 查询，
 * 提供类型安全的函数式接口。
 */

import { getDb } from '../db';
import type { OntologyData } from '../../shared/types/ontology';

// ── 类型 ────────────────────────────────────────────────────────────────────

/** ontology 表的原始行结构。 */
export interface OntologyRow {
  ontology_json: string;
  max_turn: number;
}

export interface ObsidianSyncRecord {
  topic_id: string;
  vault_path: string;
  note_path: string;
  content_hash: string | null;
  status: string;
  error: string | null;
  last_synced_at: string | null;
  updated_at: string | null;
}

export interface CardSummaryRow {
  summary: string | null;
}

// ── 本体 JSON 存取 ──────────────────────────────────────────────────────────

/** 获取会话的本体 JSON 原始行。 */
export function getOntologyRow(sessionId: string): OntologyRow | undefined {
  return getDb()
    .prepare('SELECT ontology_json, max_turn FROM ontology WHERE session_id = ?')
    .get(sessionId) as OntologyRow | undefined;
}

/** 获取并解析会话的本体数据。不存在返回 null。 */
export function getOntologyData(sessionId: string): OntologyData | null {
  const row = getOntologyRow(sessionId);
  if (!row) return null;
  return JSON.parse(row.ontology_json) as OntologyData;
}

/** 写入或替换会话的本体数据。 */
export function saveOntology(sessionId: string, data: unknown, maxTurn: number): void {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO ontology (session_id, ontology_json, max_turn, updated_at) VALUES (?, ?, ?, datetime('now'))`,
    )
    .run(sessionId, JSON.stringify(data), maxTurn);
}

/** 删除会话的本体数据。 */
export function deleteOntology(sessionId: string): number {
  const result = getDb()
    .prepare('DELETE FROM ontology WHERE session_id = ?')
    .run(sessionId);
  return result.changes;
}

/** 获取 ontology_json 列的原始字符串（避免重复解析）。 */
export function getOntologyJsonRaw(sessionId: string): string | undefined {
  const row = getDb()
    .prepare('SELECT ontology_json FROM ontology WHERE session_id = ?')
    .get(sessionId) as { ontology_json: string } | undefined;
  return row?.ontology_json;
}

// ── 知识卡片总结 ────────────────────────────────────────────────────────────

/** 获取已完成的卡片总结文本。 */
export function getSavedCardSummary(sessionId: string, topicId: string): string | null {
  const row = getDb()
    .prepare(
      `SELECT summary FROM ontology_card_summaries WHERE session_id = ? AND topic_id = ? AND status = 'done'`,
    )
    .get(sessionId, topicId) as CardSummaryRow | undefined;
  return row?.summary || null;
}

/** 写入或更新知识卡片总结记录。 */
export function upsertCardSummary(params: {
  sessionId: string;
  topicId: string;
  status: string;
  summary: string | null;
  error: string | null;
  model: string;
  promptHash: string | null;
}): void {
  getDb()
    .prepare(
      `INSERT INTO ontology_card_summaries (session_id, topic_id, status, summary, error, model, prompt_hash, completed_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
       ON CONFLICT(session_id, topic_id) DO UPDATE SET
         status = excluded.status,
         summary = excluded.summary,
         error = excluded.error,
         model = COALESCE(ontology_card_summaries.model, excluded.model),
         completed_at = CASE WHEN excluded.status = 'done' OR excluded.status = 'error' THEN datetime('now') ELSE ontology_card_summaries.completed_at END,
         updated_at = datetime('now')`,
    )
    .run(
      params.sessionId,
      params.topicId,
      params.status,
      params.summary,
      params.error,
      params.model,
      params.promptHash,
    );
}

/** 更新知识卡片状态（running/done/error）。 */
export function updateCardSummaryStatus(
  sessionId: string,
  topicId: string,
  status: string,
  summary: string | null,
  error: string | null,
): void {
  getDb()
    .prepare(
      `INSERT INTO ontology_card_summaries (session_id, topic_id, status, summary, error, model, prompt_hash, started_at, updated_at)
       VALUES (?, ?, 'running', NULL, NULL, ?, ?, datetime('now'), datetime('now'))
       ON CONFLICT(session_id, topic_id) DO UPDATE SET
         status = 'running', summary = NULL, error = NULL,
         model = excluded.model, prompt_hash = excluded.prompt_hash,
         started_at = datetime('now'), completed_at = NULL, updated_at = datetime('now')`,
    )
    .run(sessionId, topicId, '', '');
}

export function finishCardSummarySuccess(sessionId: string, topicId: string, summary: string): void {
  getDb()
    .prepare(
      `UPDATE ontology_card_summaries
       SET status = 'done', summary = ?, error = NULL,
           completed_at = datetime('now'), updated_at = datetime('now')
       WHERE session_id = ? AND topic_id = ?`,
    )
    .run(summary, sessionId, topicId);
}

export function finishCardSummaryError(sessionId: string, topicId: string, error: string): void {
  getDb()
    .prepare(
      `UPDATE ontology_card_summaries
       SET status = 'error', error = ?,
           completed_at = datetime('now'), updated_at = datetime('now')
       WHERE session_id = ? AND topic_id = ?`,
    )
    .run(error, sessionId, topicId);
}

// ── Obsidian 同步记录 ──────────────────────────────────────────────────────

/** 获取指定主题的 Obsidian 同步记录。 */
export function getObsidianSyncRecord(
  sessionId: string,
  topicId: string,
): ObsidianSyncRecord | undefined {
  return getDb()
    .prepare(
      `SELECT topic_id, vault_path, note_path, content_hash, status, error, last_synced_at, updated_at
       FROM ontology_obsidian_syncs WHERE session_id = ? AND topic_id = ?`,
    )
    .get(sessionId, topicId) as ObsidianSyncRecord | undefined;
}

/** 写入或更新 Obsidian 同步记录。 */
export function upsertObsidianSync(params: {
  sessionId: string;
  topicId: string;
  vaultPath: string;
  notePath: string;
  contentHash: string | null;
  status: string;
  error: string | null;
}): void {
  const stmt =
    params.status === 'error'
      ? getDb().prepare(
          `INSERT INTO ontology_obsidian_syncs (session_id, topic_id, vault_path, note_path, status, error, updated_at)
           VALUES (?, ?, ?, '', 'error', ?, datetime('now'))
           ON CONFLICT(session_id, topic_id) DO UPDATE SET status = 'error', error = excluded.error, updated_at = datetime('now')`,
        )
      : getDb().prepare(
          `INSERT INTO ontology_obsidian_syncs (session_id, topic_id, vault_path, note_path, content_hash, status, error, last_synced_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'synced', NULL, datetime('now'), datetime('now'))
           ON CONFLICT(session_id, topic_id) DO UPDATE SET
             vault_path = excluded.vault_path, note_path = excluded.note_path,
             content_hash = excluded.content_hash, status = 'synced', error = NULL,
             last_synced_at = datetime('now'), updated_at = datetime('now')`,
        );

  stmt.run(
    params.sessionId,
    params.topicId,
    params.vaultPath,
    params.notePath,
    params.contentHash,
    params.error,
  );
}
