import { Router } from 'express';
import { getDb } from '../db';
import { existsSync, readFileSync, realpathSync } from 'fs';
import { getKnowledgeCardContext, type ObsidianOntologyDataLike } from '../obsidian/card-context';
import { rejectUntrustedLocalRequest } from '../obsidian/local-request';
import { resolveObsidianNotePath, validateConfig, writeObsidianCard } from '../obsidian/sync';
import { getObsidianConfig } from './obsidian';
import { findJsonlFile } from './shared';
import {
  type OntologyDataLike,
  buildKnowledgeCardSummaryPrompt,
  getCardSummaryStatus,
  startCardSummaryJob,
} from '../services/card-summary';
import {
  type OntologyShardMeta,
  getExtractJob,
  upsertOntologyShard,
  loadOntologyShardCache,
  loadOntologyShardProgress,
  isExtractActive,
  updateExtractJob,
} from '../services/extraction-job';

const router = Router({ mergeParams: true });

function params(req: any): { id: string } { return req.params; }
function cardParams(req: any): { id: string; topicId: string } { return req.params; }

function getSavedCardSummary(sessionId: string, topicId: string): string | null {
  const row = getDb().prepare(
    `SELECT summary FROM ontology_card_summaries WHERE session_id = ? AND topic_id = ? AND status = 'done'`
  ).get(sessionId, topicId) as { summary: string | null } | undefined;
  return row?.summary || null;
}

interface ObsidianSyncRecord {
  topic_id: string; vault_path: string; note_path: string;
  content_hash: string | null; status: string; error: string | null;
  last_synced_at: string | null; updated_at: string | null;
}

function getObsidianSyncRecord(sessionId: string, topicId: string): ObsidianSyncRecord | undefined {
  return getDb().prepare(
    `SELECT topic_id, vault_path, note_path, content_hash, status, error, last_synced_at, updated_at
     FROM ontology_obsidian_syncs WHERE session_id = ? AND topic_id = ?`
  ).get(sessionId, topicId) as ObsidianSyncRecord | undefined;
}

function syncRecordMatchesCurrentVault(row: ObsidianSyncRecord | undefined, config: ReturnType<typeof getObsidianConfig>): boolean {
  if (!row || !config.vaultPath) return false;
  try { return realpathSync(row.vault_path) === realpathSync(config.vaultPath); }
  catch { return false; }
}

// ── Shared DB helpers (eliminates repeated query patterns) ────────────────

/** Retrieve and parse the ontology JSON for a session, or null. */
function getOntologyData(sessionId: string): OntologyDataLike | null {
  const row = getDb().prepare(
    'SELECT ontology_json FROM ontology WHERE session_id = ?'
  ).get(sessionId) as { ontology_json: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.ontology_json);
}

/** Retrieve a session's raw JSONL, falling back to disk search. */
function getSessionRawJsonl(sessionId: string): string | null {
  const row = getDb().prepare(
    'SELECT id, raw_jsonl, filename FROM sessions WHERE id = ?'
  ).get(sessionId) as { id: string; raw_jsonl: string | null; filename: string } | undefined;
  if (!row) return null;
  if (row.raw_jsonl) return row.raw_jsonl;
  const filePath = findJsonlFile(row.filename);
  if (filePath && existsSync(filePath)) return readFileSync(filePath, 'utf-8');
  return null;
}

/** Upsert ontology data for a session. */
function saveOntology(sessionId: string, data: unknown, maxTurn: number): void {
  getDb().prepare(
    `INSERT OR REPLACE INTO ontology (session_id, ontology_json, max_turn, updated_at) VALUES (?, ?, ?, datetime('now'))`
  ).run(sessionId, JSON.stringify(data), maxTurn);
}

// ============================================================================
// GET / — get ontology data
// ============================================================================

router.get('/', (req, res) => {
  try {
    const db = getDb();
    const row = db.prepare('SELECT ontology_json, max_turn FROM ontology WHERE session_id = ?')
      .get(params(req).id) as { ontology_json: string; max_turn: number } | undefined;

    if (!row) return res.json({ data: null });

    const data = JSON.parse(row.ontology_json);
    // 动态补全 aggregates（旧数据兼容）
    if (!data.aggregates && data.nodes?.some((n: any) => n.aggregateId)) {
      const aggMap = new Map<string, any>();
      for (const n of data.nodes) {
        if (!n.aggregateId) continue;
        if (!aggMap.has(n.aggregateId)) {
          aggMap.set(n.aggregateId, { id: n.aggregateId, label: n.aggregateId, startTurn: n.firstTurn, endTurn: n.firstTurn, nodeIds: [] });
        }
        const a = aggMap.get(n.aggregateId)!;
        a.nodeIds.push(n.id); a.startTurn = Math.min(a.startTurn, n.firstTurn); a.endTurn = Math.max(a.endTurn, n.firstTurn);
      }
      if (data.phaseThemes) {
        for (const pt of data.phaseThemes) {
          for (const a of aggMap.values()) {
            if (pt.startTurn >= a.startTurn && pt.startTurn <= a.endTurn) a.label = pt.theme;
          }
        }
      }
      data.aggregates = Array.from(aggMap.values());
    }
    return res.json({ sessionId: params(req).id, maxTurn: row.max_turn, data });
  } catch (err) {
    console.error('GET /ontology error:', err);
    return res.status(500).json({ error: '获取本体数据时出错' });
  }
});

// ============================================================================
// POST / — save ontology JSON
// ============================================================================

router.post('/', (req, res) => {
  try {
    const db = getDb();
    const { data } = req.body;
    if (!data || !Array.isArray(data.types) || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
      return res.status(400).json({ error: '请求体格式错误: 需要 { data: { types, nodes, edges } }' });
    }
    const nodeIds = new Set(data.nodes.map((n: { id: string }) => n.id));
    for (const edge of data.edges) {
      if (!nodeIds.has(edge.s)) return res.status(400).json({ error: `边引用未知源节点: ${edge.s}` });
      if (!nodeIds.has(edge.t)) return res.status(400).json({ error: `边引用未知目标节点: ${edge.t}` });
    }
    if (!db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(params(req).id)) {
      return res.status(404).json({ error: '会话不存在' });
    }
    const maxTurn = Math.max(...data.nodes.map((n: { firstTurn: number }) => n.firstTurn), 1);
    saveOntology(params(req).id, data, maxTurn);
    return res.json({ sessionId: params(req).id, maxTurn, data });
  } catch (err) {
    console.error('POST /ontology error:', err);
    return res.status(500).json({ error: '保存本体数据时出错' });
  }
});

// ============================================================================
// DELETE /
// ============================================================================

router.delete('/', (req, res) => {
  try {
    const result = getDb().prepare('DELETE FROM ontology WHERE session_id = ?').run(params(req).id);
    if (result.changes === 0) return res.status(404).json({ error: '本体数据不存在' });
    return res.json({ deleted: true });
  } catch (err) {
    console.error('DELETE /ontology error:', err);
    return res.status(500).json({ error: '删除本体数据时出错' });
  }
});

// ============================================================================
// GET /summarize-card/:topicId
// ============================================================================

router.get('/summarize-card/:topicId', (req, res) => {
  try {
    const { id, topicId } = cardParams(req);
    return res.json(getCardSummaryStatus(id, topicId));
  } catch (err) {
    console.error('GET /summarize-card error:', err);
    return res.status(500).json({ error: '获取知识总结状态时出错' });
  }
});

// ============================================================================
// PUT /summarize-card/:topicId — save manual card summary
// ============================================================================

router.put('/summarize-card/:topicId', (req, res) => {
  try {
    const { summary } = req.body || {};
    const { id, topicId } = cardParams(req);
    if (typeof summary !== 'string' || !summary.trim()) {
      return res.status(400).json({ error: '知识总结内容不能为空' });
    }
    const data = getOntologyData(id);
    if (!data) return res.status(404).json({ error: '该会话尚无本体数据' });

    const topic = Array.isArray(data.nodes) ? data.nodes.find((n) => n.id === topicId) : undefined;
    if (!topic) return res.status(400).json({ error: '主题节点不存在' });
    if (topic.type !== 'topic') return res.status(400).json({ error: '只有问题/主题节点可以保存知识总结' });

    db.prepare(`INSERT INTO ontology_card_summaries (session_id, topic_id, status, summary, error, model, prompt_hash, completed_at, updated_at)
      VALUES (?, ?, 'done', ?, NULL, 'manual_edit', NULL, datetime('now'), datetime('now'))
      ON CONFLICT(session_id, topic_id) DO UPDATE SET status = 'done', summary = excluded.summary, error = NULL,
        model = COALESCE(ontology_card_summaries.model, excluded.model), completed_at = datetime('now'), updated_at = datetime('now')`)
      .run(id, topicId, summary.trim());
    return res.json(getCardSummaryStatus(id, topicId));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: '保存知识总结时出错: ' + message });
  }
});

// ============================================================================
// POST /summarize-card — start LLM card summary
// ============================================================================

router.post('/summarize-card', (req, res) => {
  try {
    const { topicId } = req.body || {};
    const id = params(req).id;
    if (typeof topicId !== 'string' || !topicId.trim()) {
      return res.status(400).json({ error: 'topicId 不能为空' });
    }
    const existing = getCardSummaryStatus(id, topicId);
    if (existing.status === 'done' && existing.summary) return res.json(existing);
    if (existing.status === 'running') return res.json(existing);

    const row = getDb().prepare('SELECT ontology_json FROM ontology WHERE session_id = ?')
      .get(id) as { ontology_json: string } | undefined;
    if (!row) return res.status(404).json({ error: '该会话尚无本体数据' });

    const data = JSON.parse(row.ontology_json) as OntologyDataLike;
    if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
      return res.status(400).json({ error: '本体数据结构不完整' });
    }
    const prompt = buildKnowledgeCardSummaryPrompt(data, topicId);
    startCardSummaryJob(id, topicId, prompt);
    return res.json(getCardSummaryStatus(id, topicId));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('主题节点') || message.includes('问题/主题')) {
      return res.status(400).json({ error: message });
    }
    return res.status(500).json({ error: '生成知识总结时出错: ' + message });
  }
});

// ============================================================================
// GET /obsidian-card/:topicId
// ============================================================================

router.get('/obsidian-card/:topicId', (req, res) => {
  try {
    if (rejectUntrustedLocalRequest(req, res)) return;
    const { id, topicId } = cardParams(req);
    const row = getObsidianSyncRecord(id, topicId);
    const config = getObsidianConfig();
    const validation = validateConfig(config);
    let status = row?.status || 'not_synced';
    let notePath = row?.note_path || null;
    let error = row?.error || (validation.ok ? null : validation.error);

    if (row && validation.ok) {
      if (!syncRecordMatchesCurrentVault(row, config)) {
        status = 'not_synced'; notePath = null; error = '当前 Obsidian Vault 与上次同步记录不一致';
      } else if (row.note_path) {
        const resolved = resolveObsidianNotePath(config, row.note_path);
        if (!resolved.ok || !existsSync(resolved.absolutePath)) {
          status = 'not_synced'; notePath = row.note_path;
          error = resolved.ok ? '上次同步的 Obsidian 笔记文件不存在' : resolved.error;
        }
      }
    }
    return res.json({ topicId, configured: validation.ok, status, notePath, error, lastSyncedAt: row?.last_synced_at || null, updatedAt: row?.updated_at || null });
  } catch (err) {
    return res.status(500).json({ error: '获取 Obsidian 同步状态失败: ' + (err instanceof Error ? err.message : String(err)) });
  }
});

// ============================================================================
// POST /obsidian-card/:topicId
// ============================================================================

router.post('/obsidian-card/:topicId', (req, res) => {
  const { id: sessionId, topicId } = cardParams(req);
  try {
    if (rejectUntrustedLocalRequest(req, res)) return;
    const row = getDb().prepare('SELECT ontology_json FROM ontology WHERE session_id = ?')
      .get(sessionId) as { ontology_json: string } | undefined;
    if (!row) return res.status(404).json({ error: '该会话尚无本体数据' });

    const data = JSON.parse(row.ontology_json) as ObsidianOntologyDataLike;
    const context = getKnowledgeCardContext(data, topicId);
    const config = getObsidianConfig();
    const summary = getSavedCardSummary(sessionId, topicId);
    const previousSync = getObsidianSyncRecord(sessionId, topicId);
    const previousRelativePath = syncRecordMatchesCurrentVault(previousSync, config) ? previousSync?.note_path : null;
    const result = writeObsidianCard({ config, sessionId, topicId, context, summary, previousRelativePath });

    getDb().prepare(`INSERT INTO ontology_obsidian_syncs (session_id, topic_id, vault_path, note_path, content_hash, status, error, last_synced_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'synced', NULL, datetime('now'), datetime('now'))
      ON CONFLICT(session_id, topic_id) DO UPDATE SET vault_path = excluded.vault_path, note_path = excluded.note_path,
        content_hash = excluded.content_hash, status = 'synced', error = NULL, last_synced_at = datetime('now'), updated_at = datetime('now')`)
      .run(sessionId, topicId, config.vaultPath, result.relativePath, result.hash);

    return res.json({ topicId, configured: true, status: 'synced', notePath: result.relativePath, skipped: result.skipped, error: null, lastSyncedAt: new Date().toISOString() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      const config = getObsidianConfig();
      if (config.vaultPath) {
        getDb().prepare(`INSERT INTO ontology_obsidian_syncs (session_id, topic_id, vault_path, note_path, status, error, updated_at)
          VALUES (?, ?, ?, '', 'error', ?, datetime('now'))
          ON CONFLICT(session_id, topic_id) DO UPDATE SET status = 'error', error = excluded.error, updated_at = datetime('now')`)
          .run(sessionId, topicId, config.vaultPath, message);
      }
    } catch { /* preserve original error */ }
    return res.status(500).json({ error: '同步到 Obsidian 失败: ' + message });
  }
});

// ============================================================================
// GET /content-status
// ============================================================================

router.get('/content-status', async (req, res) => {
  const { loadExistingManifest } = await import('../content/extract-to-files.js');
  const manifest = loadExistingManifest(params(req).id);
  return res.json(manifest ? { extracted: true, manifest } : { extracted: false });
});

// ============================================================================
// POST /content-extract
// ============================================================================

router.post('/content-extract', async (req, res) => {
  try {
    const sessionId = params(req).id;
    const rawJsonl = getSessionRawJsonl(sessionId);
    if (rawJsonl === null) {
      // null means session not found
      const exists = getDb().prepare('SELECT 1 FROM sessions WHERE id = ?').get(sessionId);
      if (!exists) return res.status(404).json({ error: '会话不存在' });
      return res.status(400).json({ error: '该会话的原始 JSONL 数据不可用' });
    }

    const { extractToFiles } = await import('../content/extract-to-files.js');
    const { shardSize, maxShardChars, force } = req.body || {};
    const manifest = extractToFiles(rawJsonl, sessionId, { shardSize: shardSize ?? 30, maxShardChars: maxShardChars ?? 45000, force: force ?? false });
    return res.json({ success: true, manifest });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : '提取内容时出错' });
  }
});

// ============================================================================
// GET /extract/status
// ============================================================================

router.get('/extract/status', (req, res) => {
  const job = getExtractJob(params(req).id);
  if (!job) {
    const progress = loadOntologyShardProgress(params(req).id);
    return res.json(progress || { active: false, phase: 'idle' });
  }
  return res.json({ active: isExtractActive(job), ...job });
});

// ============================================================================
// POST /extract — SSE streaming extraction
// ============================================================================

router.post('/extract', async (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });

  const shardMeta = new Map<number, OntologyShardMeta>();
  const send = (event: string, data: Record<string, unknown>) => {
    const requestShardSize = Number(req.body?.shardSize);
    const requestMaxShardChars = Number(req.body?.maxShardChars);
    const eventData = {
      ...data,
      extractionDepth: data.extractionDepth === 'deep' || req.body?.extractionDepth === 'deep' ? 'deep' : 'refined',
      shardSize: typeof data.shardSize === 'number' ? data.shardSize : Number.isFinite(requestShardSize) ? requestShardSize : 30,
      maxShardChars: typeof data.maxShardChars === 'number' ? data.maxShardChars : Number.isFinite(requestMaxShardChars) ? requestMaxShardChars : 45000,
    };

    if (event === 'extracted') {
      const shards = Array.isArray(eventData.shards) ? eventData.shards as Array<{ index: number; turnRange: string; startTurn?: number; endTurn?: number }> : [];
      shardMeta.clear();
      for (const shard of shards) shardMeta.set(shard.index, { index: shard.index, turnRange: shard.turnRange, startTurn: shard.startTurn, endTurn: shard.endTurn });
    } else if (event === 'shard-done') {
      upsertOntologyShard(params(req).id, eventData, 'done', shardMeta.get(eventData.shardIndex as number));
    } else if (event === 'shard-error') {
      upsertOntologyShard(params(req).id, eventData, 'error', shardMeta.get(eventData.shardIndex as number));
    }
    updateExtractJob(params(req).id, event, eventData);
    if (!res.destroyed && !res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(eventData)}\n\n`);
  };

  try {
    const sessionId = params(req).id;
    const db = getDb();
    updateExtractJob(sessionId, 'start', { shards: 0, totalTurns: 0 });

    const rawJsonl = getSessionRawJsonl(sessionId);
    if (rawJsonl === null) {
      const exists = db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(sessionId);
      if (!exists) { send('error', { message: '会话不存在' }); return; }
      send('error', { message: '该会话的原始 JSONL 数据不可用' }); return;
    }

    const { extractAndBuild } = await import('../llm/extract-ontology.js');
    const { shardSize, maxShardChars, force, incremental, retryFailedOnly, extractionDepth } = req.body || {};
    const depth = extractionDepth === 'deep' ? 'deep' : 'refined';
    const resolvedShardSize = typeof shardSize === 'number' ? shardSize : 30;
    const resolvedMaxShardChars = typeof maxShardChars === 'number' ? maxShardChars : 45000;
    const shardCache = loadOntologyShardCache(sessionId, depth, resolvedShardSize, resolvedMaxShardChars);
    if (retryFailedOnly === true && shardCache.failedShardIndices.length === 0) {
      send('error', { message: '没有找到可重跑的失败分片，请先执行一次完整提取' }); return;
    }

    const result = await extractAndBuild(rawJsonl, sessionId, send, {
      shardSize: resolvedShardSize, maxShardChars: resolvedMaxShardChars,
      force: force ?? false, incremental: incremental ?? false,
      retryFailedOnly: retryFailedOnly === true, extractionDepth: depth,
      previousShardResults: retryFailedOnly === true ? shardCache.previousShardResults : [],
      failedShardIndices: retryFailedOnly === true ? shardCache.failedShardIndices : [],
    });

    if (result.success) {
      if (!result.buildOutput) {
        send('complete', { sessionId, maxTurn: 0, stats: { total: 0, succeeded: 0, failed: 0 }, noChange: true }); return;
      }
      const { data, meta } = result.buildOutput;
      if ((result.buildOutput as any).aggregates) (data as any).aggregates = (result.buildOutput as any).aggregates;
      if ((result.buildOutput as any).phaseThemes) (data as any).phaseThemes = (result.buildOutput as any).phaseThemes;
      if (incremental) {
        const existing = db.prepare('SELECT ontology_json FROM ontology WHERE session_id = ?').get(sessionId) as { ontology_json: string } | undefined;
        if (existing) {
          try {
            const prev = JSON.parse(existing.ontology_json);
            const nodeMap = new Map((prev.nodes || []).map((n: any) => [n.id, n]));
            for (const n of data.nodes) nodeMap.set(n.id, n);
            const edgeMap = new Map((prev.edges || []).map((e: any) => [`${e.s}::${e.t}::${e.label}`, e]));
            for (const e of data.edges) edgeMap.set(`${e.s}::${e.t}::${e.label}`, e);
            (data as any).nodes = Array.from(nodeMap.values());
            (data as any).edges = Array.from(edgeMap.values());
            if ((result.buildOutput as any).aggregates) {
              const aggMap = new Map((prev.aggregates || []).map((a: any) => [a.id, a]));
              for (const a of (result.buildOutput as any).aggregates) aggMap.set(a.id, a);
              (data as any).aggregates = Array.from(aggMap.values());
            }
          } catch { /* fall through */ }
        }
      }
      saveOntology(sessionId, data, meta.maxTurn);
      send('complete', { sessionId, maxTurn: meta.maxTurn, stats: result.shardStats });
    } else {
      send('error', { message: result.message, detail: result.detail, stage: result.stage });
    }
  } catch (err) {
    send('error', { message: '提取本体数据时出错: ' + (err instanceof Error ? err.message : String(err)) });
  } finally {
    if (!res.destroyed && !res.writableEnded) res.end();
  }
});

export default router;
