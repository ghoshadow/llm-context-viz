import { Router, type Request } from 'express';
import { existsSync, realpathSync } from 'fs';
import { readFile } from 'fs/promises';
import { getKnowledgeCardContext, type ObsidianOntologyDataLike } from '../obsidian/card-context';
import { rejectUntrustedLocalRequest } from '../obsidian/local-request';
import { resolveObsidianNotePath, validateConfig, writeObsidianCard } from '../obsidian/sync';
import { getObsidianConfig } from './obsidian';
import { findJsonlFile } from './shared';
import {
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
import { sanitizeForLog } from '../utils/log-sanitizer.js';
import type { OntologyData } from '../../src/types/ontology';
import { validateBody, OntologyDataSchema } from '../middleware/validate.js';
import {
  getOntologyData,
  getOntologyRow,
  saveOntology,
  deleteOntology,
  getOntologyJsonRaw,
  getSavedCardSummary,
  upsertCardSummary,
  getObsidianSyncRecord,
  upsertObsidianSync,
} from '../repositories/ontology-repository';
import {
  getSessionRawJsonlMeta,
  sessionExists,
} from '../repositories/session-repository';
const router = Router({ mergeParams: true });

function params(req: Request): { id: string } { return req.params as { id: string }; }
function cardParams(req: Request): { id: string; topicId: string } { return req.params as { id: string; topicId: string }; }

interface ObsidianSyncRecordLocal {
  topic_id: string; vault_path: string; note_path: string;
  content_hash: string | null; status: string; error: string | null;
  last_synced_at: string | null; updated_at: string | null;
}

function syncRecordMatchesCurrentVault(row: ObsidianSyncRecordLocal | undefined, config: ReturnType<typeof getObsidianConfig>): boolean {
  if (!row || !config.vaultPath) return false;
  try { return realpathSync(row.vault_path) === realpathSync(config.vaultPath); }
  catch { return false; }
}

// ── Shared DB helpers (eliminates repeated query patterns) ────────────────

/** Retrieve a session's raw JSONL, falling back to disk search. */
async function getSessionRawJsonl(sessionId: string): Promise<string | null> {
  const row = getSessionRawJsonlMeta(sessionId);
  if (!row) return null;
  if (row.raw_jsonl) return row.raw_jsonl;
  const filePath = await findJsonlFile(row.filename);
  if (filePath && existsSync(filePath)) return await readFile(filePath, 'utf-8');
  return null;
}

// ============================================================================
// GET / — get ontology data
// ============================================================================

router.get('/', (req, res) => {
  try {
    const row = getOntologyRow(params(req).id);

    if (!row) return res.json({ data: null });

    const data = JSON.parse(row.ontology_json) as OntologyData;
    // 动态补全 aggregates（旧数据兼容）
    if (!data.aggregates && data.nodes?.some((n) => n.aggregateId != null)) {
      const aggMap = new Map<string, { id: string; label: string; startTurn: number; endTurn: number; shardIndices: number[]; nodeIds: string[] }>();
      for (const n of data.nodes) {
        if (!n.aggregateId) continue;
        if (!aggMap.has(n.aggregateId)) {
          aggMap.set(n.aggregateId, { id: n.aggregateId, label: n.aggregateId, startTurn: n.firstTurn, endTurn: n.firstTurn, shardIndices: [], nodeIds: [] });
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
    console.error('GET /ontology error:', sanitizeForLog(err instanceof Error ? err.message : String(err)));
    return res.status(500).json({ error: '获取本体数据时出错' });
  }
});

// ============================================================================
// POST / — save ontology JSON
// ============================================================================

router.post('/', validateBody(OntologyDataSchema), (req, res) => {
  try {
    const { data } = req.body;
    // 业务校验：边引用的节点必须存在
    const nodeIds = new Set(data.nodes.map((n: { id: string }) => n.id));
    for (const edge of data.edges) {
      if (!nodeIds.has(edge.s)) return res.status(400).json({ error: `边引用未知源节点: ${edge.s}` });
      if (!nodeIds.has(edge.t)) return res.status(400).json({ error: `边引用未知目标节点: ${edge.t}` });
    }
    if (!sessionExists(params(req).id)) {
      return res.status(404).json({ error: '会话不存在' });
    }
    const maxTurn = Math.max(...data.nodes.map((n: { firstTurn: number }) => n.firstTurn), 1);
    saveOntology(params(req).id, data, maxTurn);
    return res.json({ sessionId: params(req).id, maxTurn, data });
  } catch (err) {
    console.error('POST /ontology error:', sanitizeForLog(err instanceof Error ? err.message : String(err)));
    return res.status(500).json({ error: '保存本体数据时出错' });
  }
});

// ============================================================================
// DELETE /
// ============================================================================

router.delete('/', (req, res) => {
  try {
    const result = deleteOntology(params(req).id);
    if (result === 0) return res.status(404).json({ error: '本体数据不存在' });
    return res.json({ deleted: true });
  } catch (err) {
    console.error('DELETE /ontology error:', sanitizeForLog(err instanceof Error ? err.message : String(err)));
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
    console.error('GET /summarize-card error:', sanitizeForLog(err instanceof Error ? err.message : String(err)));
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
    const data: OntologyData | null = getOntologyData(id);
    if (!data) return res.status(404).json({ error: '该会话尚无本体数据' });

    const topic = Array.isArray(data.nodes) ? data.nodes.find((n) => n.id === topicId) : undefined;
    if (!topic) return res.status(400).json({ error: '主题节点不存在' });
    if (topic.type !== 'topic') return res.status(400).json({ error: '只有问题/主题节点可以保存知识总结' });

    upsertCardSummary({
      sessionId: id,
      topicId,
      status: 'done',
      summary: summary.trim(),
      error: null,
      model: 'manual_edit',
      promptHash: null,
    });
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

    const rawJson = getOntologyJsonRaw(id);
    if (!rawJson) return res.status(404).json({ error: '该会话尚无本体数据' });

    const data = JSON.parse(rawJson) as ObsidianOntologyDataLike;
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
    let error = row?.error || (validation.ok === true ? null : validation.error);

    if (row && validation.ok) {
      if (!syncRecordMatchesCurrentVault(row, config)) {
        status = 'not_synced'; notePath = null; error = '当前 Obsidian Vault 与上次同步记录不一致';
      } else if (row.note_path) {
        const resolved = resolveObsidianNotePath(config, row.note_path);
        if (!resolved.ok || !existsSync(resolved.absolutePath)) {
          status = 'not_synced'; notePath = row.note_path;
          error = resolved.ok === true ? '上次同步的 Obsidian 笔记文件不存在' : resolved.error;
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
    const jsonRaw = getOntologyJsonRaw(sessionId);
    if (!jsonRaw) return res.status(404).json({ error: '该会话尚无本体数据' });

    const data = JSON.parse(jsonRaw) as ObsidianOntologyDataLike;
    const context = getKnowledgeCardContext(data, topicId);
    const config = getObsidianConfig();
    const summary = getSavedCardSummary(sessionId, topicId);
    const previousSync = getObsidianSyncRecord(sessionId, topicId);
    const previousRelativePath = syncRecordMatchesCurrentVault(previousSync, config) ? previousSync?.note_path : null;
    const result = writeObsidianCard({ config, sessionId, topicId, context, summary, previousRelativePath });

    upsertObsidianSync({
      sessionId,
      topicId,
      vaultPath: config.vaultPath,
      notePath: result.relativePath,
      contentHash: result.hash,
      status: 'synced',
      error: null,
    });

    return res.json({ topicId, configured: true, status: 'synced', notePath: result.relativePath, skipped: result.skipped, error: null, lastSyncedAt: new Date().toISOString() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      const config = getObsidianConfig();
      if (config.vaultPath) {
        upsertObsidianSync({
          sessionId,
          topicId,
          vaultPath: config.vaultPath,
          notePath: '',
          contentHash: null,
          status: 'error',
          error: message,
        });
      }
    } catch { /* preserve original error */ }
    return res.status(500).json({ error: '同步到 Obsidian 失败: ' + message });
  }
});

// ============================================================================
// GET /content-status
// ============================================================================

router.get('/content-status', async (req, res) => {
  try {
    const { loadExistingManifest } = await import('../content/extract-to-files.js');
    const manifest = await loadExistingManifest(params(req).id);
    return res.json(manifest ? { extracted: true, manifest } : { extracted: false });
  } catch (err) {
    console.error('GET /content-status error:', sanitizeForLog(err instanceof Error ? err.message : String(err)));
    return res.status(500).json({ error: '获取内容状态失败' });
  }
});

// ============================================================================
// POST /content-extract
// ============================================================================

router.post('/content-extract', async (req, res) => {
  try {
    const sessionId = params(req).id;
        const rawJsonl = await getSessionRawJsonl(sessionId);
    if (rawJsonl === null) {
      // null means session not found
      if (!sessionExists(sessionId)) return res.status(404).json({ error: '会话不存在' });
      return res.status(400).json({ error: '该会话的原始 JSONL 数据不可用' });
    }

    const { extractToFiles } = await import('../content/extract-to-files.js');
    const { shardSize, maxShardChars, force } = req.body || {};
    const manifest = await extractToFiles(rawJsonl, sessionId, { shardSize: shardSize ?? 30, maxShardChars: maxShardChars ?? 45000, force: force ?? false });
    return res.json({ success: true, manifest });
  } catch (err) {
    console.error('POST /content-extract error:', sanitizeForLog(err instanceof Error ? err.message : String(err)));
    return res.status(500).json({ error: err instanceof Error ? err.message : '提取内容时出错' });
  }
});

// ============================================================================
// GET /extract/status
// ============================================================================

router.get('/extract/status', (req, res) => {
  try {
    const job = getExtractJob(params(req).id);
    if (!job) {
      const progress = loadOntologyShardProgress(params(req).id);
      return res.json(progress || { active: false, phase: 'idle' });
    }
    return res.json({ active: isExtractActive(job), ...job });
  } catch (err) {
    console.error('GET /extract/status error:', sanitizeForLog(err instanceof Error ? err.message : String(err)));
    return res.status(500).json({ error: '获取提取状态失败' });
  }
});

// ============================================================================
// POST /extract — SSE streaming extraction
// ============================================================================

router.post('/extract', async (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });

  const sessionId = params(req).id;
  const existingJob = getExtractJob(sessionId);
  if (isExtractActive(existingJob)) {
    res.write(`id: busy\nevent: error\ndata: ${JSON.stringify({ message: '本体提取任务已在运行，请稍后查看状态', stage: 'busy' })}\n\n`);
    res.end();
    return;
  }

  const shardMeta = new Map<number, OntologyShardMeta>();
  let eventId = 0;
  const send = (event: string, data: Record<string, unknown>) => {
    const requestShardSize = Number(req.body?.shardSize);
    const requestMaxShardChars = Number(req.body?.maxShardChars);
    const eventData: Record<string, unknown> & {
      extractionDepth: 'refined' | 'deep';
      shardSize: number;
      maxShardChars: number;
    } = {
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
    if (!res.destroyed && !res.writableEnded) {
      eventId++;
      res.write(`id: ${eventId}\nevent: ${event}\ndata: ${JSON.stringify(eventData)}\n\n`);
    }
  };

  try {
    updateExtractJob(sessionId, 'start', { shards: 0, totalTurns: 0 });

    const rawJsonl = await getSessionRawJsonl(sessionId);
    if (rawJsonl === null) {
      if (!sessionExists(sessionId)) { send('error', { message: '会话不存在' }); return; }
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
      // 复制可选聚合与阶段主题到 data（OntologyData 已声明这些可选字段）
      if (result.buildOutput.aggregates) data.aggregates = result.buildOutput.aggregates;
      if (result.buildOutput.phaseThemes) data.phaseThemes = result.buildOutput.phaseThemes;
      if (incremental) {
        const existingJson = getOntologyJsonRaw(sessionId);
        if (existingJson) {
          try {
            const prev = JSON.parse(existingJson) as OntologyData;
            const nodeMap = new Map(prev.nodes.map((n) => [n.id, n]));
            for (const n of data.nodes) nodeMap.set(n.id, n);
            const edgeMap = new Map(prev.edges.map((e) => [`${e.s}::${e.t}::${e.label}`, e]));
            for (const e of data.edges) edgeMap.set(`${e.s}::${e.t}::${e.label}`, e);
            data.nodes = Array.from(nodeMap.values());
            data.edges = Array.from(edgeMap.values());
            if (result.buildOutput.aggregates) {
              const aggMap = new Map((prev.aggregates || []).map((a) => [a.id, a]));
              for (const a of result.buildOutput.aggregates) aggMap.set(a.id, a);
              data.aggregates = Array.from(aggMap.values());
            }
          } catch (mergeErr) {
            console.error('增量合并 ontology 失败:', sanitizeForLog(mergeErr instanceof Error ? mergeErr.message : String(mergeErr)));
          }
        }
      }
      saveOntology(sessionId, data, meta.maxTurn);
      send('complete', { sessionId, maxTurn: meta.maxTurn, stats: result.shardStats });
    } else if (result.success === false) {
      send('error', { message: result.message, detail: result.detail, stage: result.stage });
    }
  } catch (err) {
    send('error', { message: '提取本体数据时出错: ' + (err instanceof Error ? err.message : String(err)) });
  } finally {
    if (!res.destroyed && !res.writableEnded) res.end();
  }
});

export default router;
