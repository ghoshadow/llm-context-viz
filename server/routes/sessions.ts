import { Router } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { getDb } from '../db';
import { runPipelineOnContent, persistTurns } from '../services/pipeline-service';
import { buildOntology } from '../../src/pipeline/build-ontology';
import { enrichWithSubAgents } from './scanner';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync, realpathSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getKnowledgeCardContext, type ObsidianOntologyDataLike } from '../obsidian/card-context';
import { rejectUntrustedLocalRequest } from '../obsidian/local-request';
import { resolveObsidianNotePath, validateConfig, writeObsidianCard } from '../obsidian/sync';

const router = Router();

type ExtractPhase = 'idle' | 'extracting' | 'merging' | 'building' | 'complete' | 'error';
type CardSummaryStatus = 'not_started' | 'running' | 'done' | 'error';

interface CardSummaryRecord {
  session_id: string;
  topic_id: string;
  status: CardSummaryStatus;
  summary: string | null;
  error: string | null;
  model: string | null;
  prompt_hash: string | null;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
}

interface OntologyNodeLike {
  id: string;
  label: string;
  type: string;
  firstTurn: number;
  turns?: number[];
  claim?: string;
  snippet?: string;
  aggregateId?: string;
  evidence?: Array<{ turn: number; source: string; text: string; weight: number }>;
}

interface OntologyEdgeLike {
  s: string;
  t: string;
  label: string;
  direction?: 'directed' | 'undirected' | 'bidirectional';
  firstTurn: number;
  conf?: number;
}

interface OntologyDataLike {
  nodes: OntologyNodeLike[];
  edges: OntologyEdgeLike[];
  types?: Array<{ key: string; label: string }>;
  aggregates?: Array<{ id: string; label: string; startTurn: number; endTurn: number; nodeIds?: string[] }>;
}

function ontologyNodeText(node: OntologyNodeLike): string {
  return (node.claim || node.snippet || node.label || '').trim();
}

function ontologyTypeLabel(data: OntologyDataLike, type: string): string {
  return data.types?.find((t) => t.key === type)?.label || type;
}

function getOntologyCardNodes(topic: OntologyNodeLike, data: OntologyDataLike): OntologyNodeLike[] {
  const aggregateNodes = topic.aggregateId
    ? data.nodes.filter((n) => n.aggregateId === topic.aggregateId)
    : [];
  if (aggregateNodes.length > 0) return aggregateNodes;

  const relatedIds = new Set<string>([topic.id]);
  data.edges.forEach((edge) => {
    if (edge.s === topic.id) relatedIds.add(edge.t);
    if (edge.t === topic.id) relatedIds.add(edge.s);
  });
  return data.nodes.filter((n) => relatedIds.has(n.id));
}

function buildKnowledgeCardSummaryPrompt(data: OntologyDataLike, topicId: string): string {
  const topic = data.nodes.find((n) => n.id === topicId);
  if (!topic) throw new Error('主题节点不存在');
  if (topic.type !== 'topic') throw new Error('只有问题/主题节点可以生成知识总结');

  const aggregate = topic.aggregateId ? data.aggregates?.find((a) => a.id === topic.aggregateId) : undefined;
  const cardNodes = getOntologyCardNodes(topic, data);
  const cardNodeIds = new Set(cardNodes.map((n) => n.id));
  const cardEdges = data.edges.filter((e) => cardNodeIds.has(e.s) && cardNodeIds.has(e.t));
  const nodeById = new Map(cardNodes.map((n) => [n.id, n]));

  const orderedNodes = [...cardNodes].sort((a, b) => {
    const typeOrder = ['topic', 'why', 'how_to', 'pitfall', 'heuristic', 'technique'];
    return (typeOrder.indexOf(a.type) === -1 ? 99 : typeOrder.indexOf(a.type))
      - (typeOrder.indexOf(b.type) === -1 ? 99 : typeOrder.indexOf(b.type))
      || a.firstTurn - b.firstTurn
      || a.label.localeCompare(b.label);
  });

  const nodesText = orderedNodes.map((node) => {
    const evidence = (node.evidence || [])
      .slice()
      .sort((a, b) => a.turn - b.turn || b.weight - a.weight)
      .slice(0, 3)
      .map((ev) => `    - 第${ev.turn}轮/${ev.source}/${Math.round(ev.weight * 100)}%：${ev.text}`)
      .join('\n');
    return [
      `- [${ontologyTypeLabel(data, node.type)}] ${node.label}`,
      `  id: ${node.id}`,
      `  首现: 第${node.firstTurn}轮；出现轮次: ${(node.turns || [node.firstTurn]).join(', ')}`,
      `  知识内容: ${ontologyNodeText(node)}`,
      evidence ? `  证据:\n${evidence}` : '',
    ].filter(Boolean).join('\n');
  }).join('\n\n');

  const edgesText = cardEdges.map((edge) => {
    const source = nodeById.get(edge.s);
    const target = nodeById.get(edge.t);
    const dir = edge.direction === 'undirected' ? `--${edge.label}--`
      : edge.direction === 'bidirectional' ? `<--${edge.label}-->`
        : `--${edge.label}-->`;
    return `- ${source?.label || edge.s} ${dir} ${target?.label || edge.t}（第${edge.firstTurn}轮）`;
  }).join('\n');

  return `你是一个负责把对话本体沉淀整理成知识卡片总结的中文知识工程助手。

请基于下面给出的「一个知识卡片」内的主题、节点、关系和证据，生成一段面向用户复盘的知识总结。

要求：
1. 不要只是罗列节点，要把节点内容串成完整理解链路。
2. 必须以「问题/主题」为核心，按照「为什么 → 怎么做 → 坑/教训 → 经验法则 → 工具/技巧」的逻辑组织。
3. 只使用给定节点、关系和证据中的信息，不要编造外部事实。
4. 如果某一类信息缺失，可以自然跳过，不要写“暂无”。
5. 总结要具体、可读，适合放在右侧详情面板，控制在 500-900 字。
6. 末尾给出 3-5 条“可复用要点”，每条一句话。

知识卡片：
标题：${aggregate?.label || topic.label}
轮次范围：${aggregate ? `第${aggregate.startTurn}-${aggregate.endTurn}轮` : `围绕第${topic.firstTurn}轮`}

节点：
${nodesText}

关系：
${edgesText || '无显式关系'}

请直接输出总结正文，不要输出 JSON，不要解释你的生成过程。`;
}

async function runKnowledgeSummaryLLM(prompt: string): Promise<string> {
  const model = process.env.LLM_MODEL || 'deepseek-v4-pro';
  const apiKey = process.env.LLM_API_KEY;
  const baseUrl = process.env.LLM_BASE_URL || 'https://api.deepseek.com/anthropic';

  if (!apiKey) throw new Error('未设置 LLM_API_KEY 环境变量');

  const q = query({
    prompt,
    options: {
      model,
      maxTurns: 1,
      thinking: { type: 'disabled' as const },
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      env: { ...process.env, ANTHROPIC_API_KEY: apiKey, ANTHROPIC_BASE_URL: baseUrl } as Record<string, string>,
    },
  });

  const chunks: string[] = [];
  for await (const msg of q) {
    if (msg.type !== 'assistant') continue;
    const am = msg as SDKMessage & { type: 'assistant'; message?: { content?: unknown[] } };
    for (const block of am.message?.content || []) {
      const b = block as { type?: string; text?: string };
      if (b.type === 'text' && b.text) chunks.push(b.text);
    }
  }

  const summary = chunks.join('\n').trim();
  if (!summary) throw new Error('LLM 未返回知识总结');
  return summary;
}

function getCardSummaryStatus(sessionId: string, topicId: string): {
  topicId: string;
  status: CardSummaryStatus;
  summary: string | null;
  error: string | null;
  updatedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
} {
  const db = getDb();
  const row = db.prepare(`
    SELECT session_id, topic_id, status, summary, error, model, prompt_hash, updated_at, started_at, completed_at
    FROM ontology_card_summaries
    WHERE session_id = ? AND topic_id = ?
  `).get(sessionId, topicId) as CardSummaryRecord | undefined;

  if (!row) {
    return { topicId, status: 'not_started', summary: null, error: null, updatedAt: null, startedAt: null, completedAt: null };
  }

  if (row.status === 'running' && !cardSummaryJobs.has(`${sessionId}:${topicId}`)) {
    const interrupted = '总结任务已中断，请重新生成';
    db.prepare(`
      UPDATE ontology_card_summaries
      SET status = 'error',
          error = ?,
          completed_at = datetime('now'),
          updated_at = datetime('now')
      WHERE session_id = ? AND topic_id = ?
    `).run(interrupted, sessionId, topicId);
    return {
      topicId,
      status: 'error',
      summary: row.summary,
      error: interrupted,
      updatedAt: new Date().toISOString(),
      startedAt: row.started_at,
      completedAt: new Date().toISOString(),
    };
  }

  return {
    topicId,
    status: row.status,
    summary: row.summary,
    error: row.error,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

function getObsidianConfig(): { vaultPath: string | null; notesDir: string; filenameTemplate: string } {
  const row = getDb().prepare(`
    SELECT vault_path, notes_dir, filename_template
    FROM obsidian_config
    WHERE id = 1
  `).get() as { vault_path: string | null; notes_dir: string; filename_template: string } | undefined;

  return {
    vaultPath: row?.vault_path || null,
    notesDir: row?.notes_dir || 'LLM知识卡片',
    filenameTemplate: row?.filename_template || '第{{startTurn}}-{{endTurn}}轮 - {{title}} - {{topicHash}}.md',
  };
}

function getSavedCardSummary(sessionId: string, topicId: string): string | null {
  const row = getDb().prepare(`
    SELECT summary
    FROM ontology_card_summaries
    WHERE session_id = ? AND topic_id = ? AND status = 'done'
  `).get(sessionId, topicId) as { summary: string | null } | undefined;

  return row?.summary || null;
}

interface ObsidianSyncRecord {
  topic_id: string;
  vault_path: string;
  note_path: string;
  content_hash: string | null;
  status: string;
  error: string | null;
  last_synced_at: string | null;
  updated_at: string | null;
}

function getObsidianSyncRecord(sessionId: string, topicId: string): ObsidianSyncRecord | undefined {
  return getDb().prepare(`
    SELECT topic_id, vault_path, note_path, content_hash, status, error, last_synced_at, updated_at
    FROM ontology_obsidian_syncs
    WHERE session_id = ? AND topic_id = ?
  `).get(sessionId, topicId) as ObsidianSyncRecord | undefined;
}

function syncRecordMatchesCurrentVault(row: ObsidianSyncRecord | undefined, config: ReturnType<typeof getObsidianConfig>): boolean {
  if (!row || !config.vaultPath) return false;
  try {
    return realpathSync(row.vault_path) === realpathSync(config.vaultPath);
  } catch {
    return false;
  }
}

const cardSummaryJobs = new Set<string>();

function startCardSummaryJob(sessionId: string, topicId: string, prompt: string): void {
  const jobKey = `${sessionId}:${topicId}`;
  if (cardSummaryJobs.has(jobKey)) return;

  cardSummaryJobs.add(jobKey);
  const model = process.env.LLM_MODEL || 'deepseek-v4-pro';
  const promptHash = crypto.createHash('sha1').update(prompt).digest('hex');
  const db = getDb();
  db.prepare(`
    INSERT INTO ontology_card_summaries (
      session_id, topic_id, status, summary, error, model, prompt_hash,
      started_at, updated_at
    )
    VALUES (?, ?, 'running', NULL, NULL, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(session_id, topic_id) DO UPDATE SET
      status = 'running',
      summary = NULL,
      error = NULL,
      model = excluded.model,
      prompt_hash = excluded.prompt_hash,
      started_at = datetime('now'),
      completed_at = NULL,
      updated_at = datetime('now')
  `).run(sessionId, topicId, model, promptHash);

  void (async () => {
    try {
      const summary = await runKnowledgeSummaryLLM(prompt);
      getDb().prepare(`
        UPDATE ontology_card_summaries
        SET status = 'done',
            summary = ?,
            error = NULL,
            completed_at = datetime('now'),
            updated_at = datetime('now')
        WHERE session_id = ? AND topic_id = ?
      `).run(summary, sessionId, topicId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      getDb().prepare(`
        UPDATE ontology_card_summaries
        SET status = 'error',
            error = ?,
            completed_at = datetime('now'),
            updated_at = datetime('now')
        WHERE session_id = ? AND topic_id = ?
      `).run(message, sessionId, topicId);
    } finally {
      cardSummaryJobs.delete(jobKey);
    }
  })();
}

interface ExtractShardStatus {
  index: number;
  status: 'pending' | 'running' | 'done' | 'error';
  candidates?: number;
  relations?: number;
  error?: string;
}

interface ExtractJobStatus {
  sessionId: string;
  phase: ExtractPhase;
  rootDir: string | null;
  totalTurns: number;
  shardCount: number;
  shardsCompleted: number;
  shardDetails: ExtractShardStatus[];
  error: string | null;
  extractionDepth: 'refined' | 'deep';
  shardSize: number | null;
  maxShardChars: number | null;
  startedAt: string;
  updatedAt: string;
}

const extractJobs = new Map<string, ExtractJobStatus>();

interface OntologyShardMeta {
  index: number;
  turnRange: string;
  startTurn?: number;
  endTurn?: number;
}

function upsertOntologyShard(
  sessionId: string,
  data: Record<string, unknown>,
  status: 'done' | 'error',
  fallback?: OntologyShardMeta,
): void {
  const db = getDb();
  const shardIndex = typeof data.shardIndex === 'number' ? data.shardIndex : fallback?.index;
  if (typeof shardIndex !== 'number' || shardIndex < 0) return;
  const depth = data.extractionDepth === 'deep' ? 'deep' : 'refined';
  const turnRange = typeof data.turnRange === 'string' ? data.turnRange : fallback?.turnRange || '';
  const startTurn = typeof data.startTurn === 'number' ? data.startTurn : fallback?.startTurn ?? null;
  const endTurn = typeof data.endTurn === 'number' ? data.endTurn : fallback?.endTurn ?? null;
  const candidates = Array.isArray(data.candidates) ? data.candidates : null;
  const relations = Array.isArray(data.relations) ? data.relations : null;

  db.prepare(`
    INSERT INTO ontology_shards (
      session_id, shard_index, turn_range, start_turn, end_turn, status,
      phase_theme, candidates_json, relations_json, config_json, error,
      extraction_depth, shard_size, max_shard_chars, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(session_id, shard_index, extraction_depth) DO UPDATE SET
      turn_range = excluded.turn_range,
      start_turn = excluded.start_turn,
      end_turn = excluded.end_turn,
      status = excluded.status,
      phase_theme = excluded.phase_theme,
      candidates_json = excluded.candidates_json,
      relations_json = excluded.relations_json,
      config_json = excluded.config_json,
      error = excluded.error,
      shard_size = excluded.shard_size,
      max_shard_chars = excluded.max_shard_chars,
      updated_at = datetime('now')
  `).run(
    sessionId,
    shardIndex,
    turnRange,
    startTurn,
    endTurn,
    status,
    typeof data.phaseTheme === 'string' ? data.phaseTheme : null,
    candidates ? JSON.stringify(candidates) : null,
    relations ? JSON.stringify(relations) : null,
    data.config && typeof data.config === 'object' ? JSON.stringify(data.config) : null,
    typeof data.error === 'string' ? data.error : null,
    depth,
    typeof data.shardSize === 'number' ? data.shardSize : null,
    typeof data.maxShardChars === 'number' ? data.maxShardChars : null,
  );
}

function loadOntologyShardCache(
  sessionId: string,
  extractionDepth: 'refined' | 'deep',
  shardSize: number,
  maxShardChars: number,
): {
  previousShardResults: Array<{
    shardIndex: number;
    phaseTheme?: string;
    candidates: any[];
    relations: any[];
    config?: Record<string, unknown>;
  }>;
  failedShardIndices: number[];
} {
  const db = getDb();
  const rows = db.prepare(`
    SELECT shard_index, status, phase_theme, candidates_json, relations_json, config_json
    FROM ontology_shards
    WHERE session_id = ? AND extraction_depth = ?
      AND COALESCE(shard_size, -1) = COALESCE(?, -1)
      AND COALESCE(max_shard_chars, -1) = COALESCE(?, -1)
    ORDER BY shard_index ASC
  `).all(sessionId, extractionDepth, shardSize, maxShardChars) as Array<{
    shard_index: number;
    status: string;
    phase_theme: string | null;
    candidates_json: string | null;
    relations_json: string | null;
    config_json: string | null;
  }>;

  const previousShardResults = rows
    .filter((row) => row.status === 'done' && row.candidates_json && row.relations_json)
    .map((row) => ({
      shardIndex: row.shard_index,
      phaseTheme: row.phase_theme || undefined,
      candidates: JSON.parse(row.candidates_json || '[]'),
      relations: JSON.parse(row.relations_json || '[]'),
      config: row.config_json ? JSON.parse(row.config_json) : undefined,
    }));

  const failedShardIndices = rows
    .filter((row) => row.status === 'error')
    .map((row) => row.shard_index);

  return { previousShardResults, failedShardIndices };
}

function parseJsonArrayLength(raw: string | null): number | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.length : undefined;
  } catch {
    return undefined;
  }
}

function loadOntologyShardProgress(sessionId: string): (Partial<ExtractJobStatus> & { active: false }) | null {
  const db = getDb();
  const latest = db.prepare(`
    SELECT extraction_depth, shard_size, max_shard_chars
    FROM ontology_shards
    WHERE session_id = ?
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(sessionId) as { extraction_depth: 'refined' | 'deep'; shard_size: number | null; max_shard_chars: number | null } | undefined;

  if (!latest) return null;

  const rows = db.prepare(`
    SELECT shard_index, status, candidates_json, relations_json, error,
           extraction_depth, shard_size, max_shard_chars, updated_at
    FROM ontology_shards
    WHERE session_id = ? AND extraction_depth = ?
      AND COALESCE(shard_size, -1) = COALESCE(?, -1)
      AND COALESCE(max_shard_chars, -1) = COALESCE(?, -1)
    ORDER BY shard_index ASC
  `).all(sessionId, latest.extraction_depth, latest.shard_size, latest.max_shard_chars) as Array<{
    shard_index: number;
    status: string;
    candidates_json: string | null;
    relations_json: string | null;
    error: string | null;
    extraction_depth: 'refined' | 'deep';
    shard_size: number | null;
    max_shard_chars: number | null;
    updated_at: string;
  }>;

  if (rows.length === 0) return null;

  const shardDetails = rows.map((row) => ({
    index: row.shard_index,
    status: row.status === 'done' ? 'done' as const : 'error' as const,
    candidates: parseJsonArrayLength(row.candidates_json),
    relations: parseJsonArrayLength(row.relations_json),
    error: row.error || undefined,
  }));
  const failed = shardDetails.filter((s) => s.status === 'error').length;

  return {
    active: false,
    phase: failed > 0 ? 'error' : 'complete',
    rootDir: null,
    totalTurns: 0,
    shardCount: shardDetails.length,
    shardsCompleted: shardDetails.length - failed,
    shardDetails,
    error: failed > 0 ? `有 ${failed} 个分片未完成，可只重跑失败分片` : null,
    extractionDepth: latest.extraction_depth,
    shardSize: rows[0]?.shard_size ?? null,
    maxShardChars: rows[0]?.max_shard_chars ?? null,
    updatedAt: rows[rows.length - 1]?.updated_at,
  };
}

function isExtractActive(job: ExtractJobStatus | undefined): boolean {
  return Boolean(job && job.phase !== 'complete' && job.phase !== 'error' && job.phase !== 'idle');
}

function updateExtractJob(sessionId: string, event: string, data: Record<string, unknown>): ExtractJobStatus {
  const now = new Date().toISOString();
  let job = extractJobs.get(sessionId);
  if (!job) {
    job = {
      sessionId,
      phase: 'extracting',
      rootDir: null,
      totalTurns: 0,
      shardCount: 0,
      shardsCompleted: 0,
      shardDetails: [],
      error: null,
      extractionDepth: 'refined',
      shardSize: null,
      maxShardChars: null,
      startedAt: now,
      updatedAt: now,
    };
  }

  if (event === 'extracted') {
    const shards = (Array.isArray(data.shards) ? data.shards : []) as Array<{ index: number }>;
    job.phase = 'extracting';
    job.rootDir = typeof data.rootDir === 'string' ? data.rootDir : job.rootDir;
    job.totalTurns = typeof data.totalTurns === 'number' ? data.totalTurns : job.totalTurns;
    job.extractionDepth = data.extractionDepth === 'deep' ? 'deep' : 'refined';
    job.shardSize = typeof data.shardSize === 'number' ? data.shardSize : job.shardSize;
    job.maxShardChars = typeof data.maxShardChars === 'number' ? data.maxShardChars : job.maxShardChars;
    job.shardCount = typeof data.activeShards === 'number'
      ? data.activeShards
      : typeof data.shardCount === 'number' ? data.shardCount : job.shardCount;
    job.shardDetails = shards.map((s) => ({ index: s.index, status: 'pending' }));
    job.shardsCompleted = 0;
    job.error = null;
  } else if (event === 'start') {
    const shardCount = typeof data.shards === 'number' ? data.shards : job.shardCount;
    job.phase = 'extracting';
    job.totalTurns = typeof data.totalTurns === 'number' ? data.totalTurns : job.totalTurns;
    job.extractionDepth = data.extractionDepth === 'deep' ? 'deep' : job.extractionDepth;
    job.shardCount = shardCount;
    if (job.shardDetails.length === 0 || job.shardDetails.length !== shardCount) {
      job.shardDetails = Array.from({ length: shardCount }, (_, index) => ({ index, status: 'pending' as const }));
    }
    job.shardsCompleted = job.shardDetails.filter((s) => s.status === 'done').length;
  } else if (event === 'shard-start') {
    const shardIndex = data.shardIndex as number;
    job.phase = 'extracting';
    job.shardDetails = job.shardDetails.map((s) => s.index === shardIndex ? { ...s, status: 'running' } : s);
  } else if (event === 'shard-retry') {
    const shardIndex = data.shardIndex as number;
    const attempt = typeof data.attempt === 'number' ? data.attempt : 2;
    job.phase = 'extracting';
    job.shardDetails = job.shardDetails.map((s) => s.index === shardIndex
      ? { ...s, status: 'running', error: `第 ${attempt} 次尝试` }
      : s);
  } else if (event === 'shard-done') {
    const shardIndex = data.shardIndex as number;
    job.shardDetails = job.shardDetails.map((s) => s.index === shardIndex
      ? {
          ...s,
          status: 'done',
          error: undefined,
          candidates: Array.isArray(data.candidates) ? data.candidates.length : s.candidates,
          relations: Array.isArray(data.relations) ? data.relations.length : s.relations,
        }
      : s);
    job.shardsCompleted = job.shardDetails.filter((s) => s.status === 'done').length;
  } else if (event === 'shard-error') {
    const shardIndex = data.shardIndex as number;
    job.shardDetails = job.shardDetails.map((s) => s.index === shardIndex
      ? { ...s, status: 'error', error: typeof data.error === 'string' ? data.error : '失败' }
      : s);
  } else if (event === 'merge') {
    job.phase = 'merging';
  } else if (event === 'build') {
    job.phase = 'building';
  } else if (event === 'complete') {
    const failed = job.shardDetails.filter((s) => s.status === 'error').length;
    job.phase = failed > 0 ? 'error' : 'complete';
    job.error = failed > 0 ? `已保存部分结果，仍有 ${failed} 个分片未完成` : null;
    job.shardsCompleted = job.shardDetails.filter((s) => s.status === 'done').length || job.shardsCompleted;
  } else if (event === 'error') {
    job.phase = 'error';
    job.error = typeof data.message === 'string' ? data.message : '提取失败';
  }

  job.updatedAt = now;
  extractJobs.set(sessionId, job);
  return job;
}

// ---------------------------------------------------------------------------
// Multer setup: accept single file upload, max 50 MB
// ---------------------------------------------------------------------------

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// ---------------------------------------------------------------------------
// POST /upload
// ---------------------------------------------------------------------------

router.post('/upload', upload.single('file'), (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: '未上传文件' });
    }

    const content = file.buffer.toString('utf-8');
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    const originalFilename = file.originalname;

    const db = getDb();

    // Check for duplicate by file_hash
    const existing = db.prepare('SELECT id FROM sessions WHERE file_hash = ?').get(hash) as
      | { id: string }
      | undefined;
    if (existing) {
      return res.status(409).json({ error: '文件已存在', sessionId: existing.id });
    }

    // Run the full pipeline
    const { summary, turns } = runPipelineOnContent(content, originalFilename);

    const sessionId = hash.substring(0, 16);

    // Enrich with sub-agent data via temp file
    try {
      const tmpDir = mkdtempSync(join(tmpdir(), 'llm-viz-upload-'));
      writeFileSync(join(tmpDir, sessionId + '.jsonl'), content);
      enrichWithSubAgents(turns as any, tmpDir);
      rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* enrichment is best-effort */ }

    // Use a transaction for all inserts
    const insertSession = db.prepare(`
      INSERT INTO sessions (
        id, filename, file_hash, model, version, cwd,
        total_requests, peak_index, peak_tokens, peak_cache_hit, peak_turn_idx, peak_step, total_output, context_limit,
        turn_count, raw_size, categories_json, tools_json, series_json, raw_jsonl
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?
      )
    `);

    const txn = db.transaction(() => {
      insertSession.run(
        sessionId, originalFilename, hash,
        summary.session.model, summary.session.version, summary.session.cwd,
        summary.session.requests, summary.session.peakIndex,
        summary.session.peakTokens, summary.session.peakCacheHit ?? 0,
        summary.session.peakTurnIdx ?? 0, summary.session.peakStep ?? 0,
        summary.session.totalOutput, summary.session.contextLimit,
        turns.length, Buffer.byteLength(content, 'utf-8'),
        JSON.stringify(summary.categories), JSON.stringify(summary.tools), JSON.stringify(summary.series),
        content,
      );
      persistTurns(sessionId, turns);
    });

    txn();

    return res.status(201).json({
      id: sessionId,
      filename: originalFilename,
      model: summary.session.model,
      version: summary.session.version,
      total_requests: summary.session.requests,
      peak_tokens: summary.session.peakTokens,
      turn_count: turns.length,
    });
  } catch (err) {
    console.error('POST /upload error:', err);
    return res.status(500).json({ error: '处理上传文件时出错' });
  }
});

// ---------------------------------------------------------------------------
// GET /
// ---------------------------------------------------------------------------

router.get('/', (_req, res) => {
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, filename, model, version, ai_title, total_requests, peak_tokens, turn_count, created_at
         FROM sessions
         ORDER BY created_at DESC`,
      )
      .all();

    return res.json(rows);
  } catch (err) {
    console.error('GET / error:', err);
    return res.status(500).json({ error: '获取会话列表时出错' });
  }
});

// ---------------------------------------------------------------------------
// GET /:id
// ---------------------------------------------------------------------------

router.get('/:id', (req, res) => {
  try {
    const db = getDb();
    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id) as
      | Record<string, unknown>
      | undefined;

    if (!row) {
      return res.status(404).json({ error: '会话不存在' });
    }

    // Parse JSON string columns back to objects
    const {
      categories_json,
      tools_json,
      series_json,
      raw_jsonl,
      ...rest
    } = row as Record<string, unknown> & {
      categories_json?: string;
      tools_json?: string;
      series_json?: string;
      raw_jsonl?: string;
    };

    const detail = {
      ...rest,
      categories: categories_json ? JSON.parse(categories_json) : [],
      tools: tools_json ? JSON.parse(tools_json) : [],
      series: series_json ? JSON.parse(series_json) : [],
    };

    return res.json(detail);
  } catch (err) {
    console.error('GET /:id error:', err);
    return res.status(500).json({ error: '获取会话详情时出错' });
  }
});

// ---------------------------------------------------------------------------
// POST /:id/refresh — re-parse the original JSONL and update DB turns
// ---------------------------------------------------------------------------

import { readdirSync, statSync } from 'fs';
import { homedir } from 'os';

function findJsonlFile(filename: string): string | null {
  const dirs = [join(homedir(), '.claude', 'projects')];
  for (const dir of dirs) {
    try {
      const queue = [dir];
      while (queue.length > 0) {
        const d = queue.shift()!;
        for (const entry of readdirSync(d)) {
          const full = join(d, entry);
          try {
            const st = statSync(full);
            if (st.isDirectory() && !entry.startsWith('.') && entry !== 'subagents') {
              if (queue.length < 50) queue.push(full);
            } else if (st.isFile() && entry === filename) {
              return full;
            }
          } catch {}
        }
      }
    } catch {}
  }
  return null;
}

router.post('/:id/refresh', (req, res) => {
  try {
    const db = getDb();
    const session = db.prepare('SELECT id, filename, file_hash, raw_jsonl FROM sessions WHERE id = ?').get(req.params.id) as { id: string; filename: string; file_hash: string; raw_jsonl?: string } | undefined;
    if (!session) return res.status(404).json({ error: '会话不存在' });

    let content: string;
    let sessDir: string;
    const filePath = findJsonlFile(session.filename);
    if (filePath) {
      content = readFileSync(filePath, 'utf-8');
      sessDir = filePath.replace(/\.jsonl$/, '');
    } else if (session.raw_jsonl) {
      content = session.raw_jsonl;
      sessDir = ''; // sub-agents not available for uploaded sessions
    } else {
      return res.status(404).json({ error: '找不到原始 JSONL 数据' });
    }
    const sids = req.params.id;

    // Re-run pipeline
    const { summary, turns } = runPipelineOnContent(content, session.filename);
    if (sessDir) enrichWithSubAgents(turns, sessDir);

    // Replace turns in a transaction
    const deleteTurns = db.prepare('DELETE FROM turns WHERE session_id = ?');
    const updateSession = db.prepare('UPDATE sessions SET turn_count = ?, total_requests = ?, peak_tokens = ?, peak_cache_hit = ?, peak_turn_idx = ?, peak_step = ?, total_output = ?, context_limit = ?, categories_json = ?, tools_json = ?, series_json = ?, updated_at = datetime(\'now\') WHERE id = ?');

    db.transaction(() => {
      deleteTurns.run(sids);
      persistTurns(sids, turns);
      updateSession.run(
        turns.length, summary.session.requests, summary.session.peakTokens,
        summary.session.peakCacheHit, summary.session.peakTurnIdx, summary.session.peakStep,
        summary.session.totalOutput, summary.session.contextLimit,
        JSON.stringify(summary.categories), JSON.stringify(summary.tools), JSON.stringify(summary.series),
        sids,
      );
    })();

    res.json({ ok: true, turnCount: turns.length });
  } catch (err) {
    res.status(500).json({ error: '刷新失败: ' + (err as Error).message });
  }
});

// GET /:id/turns
// ---------------------------------------------------------------------------

router.get('/:id/turns', (req, res) => {
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, turn_index, prompt, timestamp, asst_reqs, max_input, max_cache_hit, max_req_idx, max_req_step, out_tok, cum_total, cum_cache_hit, compression_reset, dur_ms, step_count
         FROM turns
         WHERE session_id = ?
         ORDER BY turn_index DESC`,
      )
      .all(req.params.id);

    return res.json(rows);
  } catch (err) {
    console.error('GET /:id/turns error:', err);
    return res.status(500).json({ error: '获取轮次列表时出错' });
  }
});

// ---------------------------------------------------------------------------
// GET /:id/turns/:turnIndex
// ---------------------------------------------------------------------------

router.get('/:id/turns/:turnIndex', (req, res) => {
  try {
    const db = getDb();
    const turnIndex = parseInt(req.params.turnIndex, 10);
    if (isNaN(turnIndex)) {
      return res.status(400).json({ error: '无效的轮次索引' });
    }

    const row = db
      .prepare('SELECT * FROM turns WHERE session_id = ? AND turn_index = ?')
      .get(req.params.id, turnIndex) as Record<string, unknown> | undefined;

    if (!row) {
      return res.status(404).json({ error: '轮次不存在' });
    }

    // Parse all JSON string columns
    const {
      comp_json,
      delta_json,
      tools_json: turnToolsJson,
      segs_json,
      longest_json,
      ...rest
    } = row as Record<string, unknown> & {
      comp_json?: string;
      delta_json?: string;
      tools_json?: string;
      segs_json?: string;
      longest_json?: string;
    };

    const detail = {
      ...rest,
      comp: comp_json ? JSON.parse(comp_json) : {},
      delta: delta_json ? JSON.parse(delta_json) : {},
      tools: turnToolsJson ? JSON.parse(turnToolsJson) : {},
      segs: segs_json ? JSON.parse(segs_json) : [],
      longest: longest_json ? JSON.parse(longest_json) : null,
    };

    return res.json(detail);
  } catch (err) {
    console.error('GET /:id/turns/:turnIndex error:', err);
    return res.status(500).json({ error: '获取轮次详情时出错' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /:id
// ---------------------------------------------------------------------------

router.delete('/:id', (req, res) => {
  try {
    const db = getDb();
    const result = db.prepare('DELETE FROM sessions WHERE id = ?').run(req.params.id);

    if (result.changes === 0) {
      return res.status(404).json({ error: '会话不存在' });
    }

    return res.status(204).send();
  } catch (err) {
    console.error('DELETE /:id error:', err);
    return res.status(500).json({ error: '删除会话时出错' });
  }
});

// ---------------------------------------------------------------------------
// GET /:id/ontology
// ---------------------------------------------------------------------------

router.get('/:id/ontology', (req, res) => {
  try {
    const db = getDb();
    const row = db
      .prepare('SELECT ontology_json, max_turn FROM ontology WHERE session_id = ?')
      .get(req.params.id) as { ontology_json: string; max_turn: number } | undefined;

    if (!row) {
      return res.status(404).json({ error: '该会话尚无本体数据。请通过 POST 上传本体 JSON。' });
    }

    const data = JSON.parse(row.ontology_json);
    // 动态补全 aggregates（旧数据没有，但节点有 aggregateId）
    if (!data.aggregates && data.nodes?.some((n: any) => n.aggregateId)) {
      const aggMap = new Map<string, { id: string; label: string; startTurn: number; endTurn: number; shardIndices: number[]; nodeIds: string[] }>();
      for (const n of data.nodes) {
        if (!n.aggregateId) continue;
        let a = aggMap.get(n.aggregateId);
        if (!a) {
          a = { id: n.aggregateId, label: n.aggregateId, startTurn: n.firstTurn, endTurn: n.firstTurn, shardIndices: [], nodeIds: [] };
          aggMap.set(n.aggregateId, a);
        }
        a.nodeIds.push(n.id);
        a.startTurn = Math.min(a.startTurn, n.firstTurn);
        a.endTurn = Math.max(a.endTurn, n.firstTurn);
      }
      // 尝试从 phaseThemes 读取真实标签
      if (data.phaseThemes) {
        for (const pt of data.phaseThemes) {
          for (const a of aggMap.values()) {
            if (pt.startTurn >= a.startTurn && pt.startTurn <= a.endTurn) {
              a.label = pt.theme;
            }
          }
        }
      }
      data.aggregates = Array.from(aggMap.values());
    }
    return res.json({ sessionId: req.params.id, maxTurn: row.max_turn, data });
  } catch (err) {
    console.error('GET /:id/ontology error:', err);
    return res.status(500).json({ error: '获取本体数据时出错' });
  }
});

// ---------------------------------------------------------------------------
// POST /:id/ontology
// ---------------------------------------------------------------------------

router.post('/:id/ontology', (req, res) => {
  try {
    const db = getDb();
    const { data } = req.body;

    // Validate structure
    if (!data || !Array.isArray(data.types) || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
      return res.status(400).json({ error: '请求体格式错误: 需要 { data: { types, nodes, edges } }' });
    }

    // Validate edge endpoints exist in nodes
    const nodeIds = new Set(data.nodes.map((n: { id: string }) => n.id));
    for (const edge of data.edges) {
      if (!nodeIds.has(edge.s)) {
        return res.status(400).json({ error: `边引用未知源节点: ${edge.s}` });
      }
      if (!nodeIds.has(edge.t)) {
        return res.status(400).json({ error: `边引用未知目标节点: ${edge.t}` });
      }
    }

    // Verify session exists
    const session = db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(req.params.id);
    if (!session) {
      return res.status(404).json({ error: '会话不存在' });
    }

    // Compute maxTurn from nodes
    const maxTurn = Math.max(...data.nodes.map((n: { firstTurn: number }) => n.firstTurn), 1);

    // Upsert
    db.prepare(
      `INSERT OR REPLACE INTO ontology (session_id, ontology_json, max_turn, updated_at)
       VALUES (?, ?, ?, datetime('now'))`,
    ).run(req.params.id, JSON.stringify(data), maxTurn);

    return res.json({ sessionId: req.params.id, maxTurn, data });
  } catch (err) {
    console.error('POST /:id/ontology error:', err);
    return res.status(500).json({ error: '保存本体数据时出错' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /:id/ontology
// ---------------------------------------------------------------------------

router.delete('/:id/ontology', (req, res) => {
  try {
    const db = getDb();
    const result = db.prepare('DELETE FROM ontology WHERE session_id = ?').run(req.params.id);

    if (result.changes === 0) {
      return res.status(404).json({ error: '本体数据不存在' });
    }

    return res.json({ deleted: true });
  } catch (err) {
    console.error('DELETE /:id/ontology error:', err);
    return res.status(500).json({ error: '删除本体数据时出错' });
  }
});

// ---------------------------------------------------------------------------
// GET /:id/ontology/summarize-card/:topicId — recover LLM summary status
// ---------------------------------------------------------------------------

router.get('/:id/ontology/summarize-card/:topicId', (req, res) => {
  try {
    return res.json(getCardSummaryStatus(req.params.id, req.params.topicId));
  } catch (err) {
    console.error('GET /:id/ontology/summarize-card/:topicId error:', err);
    return res.status(500).json({ error: '获取知识总结状态时出错' });
  }
});

// ---------------------------------------------------------------------------
// PUT /:id/ontology/summarize-card/:topicId — save manually edited card summary
// ---------------------------------------------------------------------------

router.put('/:id/ontology/summarize-card/:topicId', (req, res) => {
  try {
    const { summary } = req.body || {};
    const topicId = req.params.topicId;
    if (typeof summary !== 'string' || !summary.trim()) {
      return res.status(400).json({ error: '知识总结内容不能为空' });
    }

    const db = getDb();
    const row = db
      .prepare('SELECT ontology_json FROM ontology WHERE session_id = ?')
      .get(req.params.id) as { ontology_json: string } | undefined;

    if (!row) {
      return res.status(404).json({ error: '该会话尚无本体数据' });
    }

    const data = JSON.parse(row.ontology_json) as OntologyDataLike;
    const topic = Array.isArray(data.nodes) ? data.nodes.find((n) => n.id === topicId) : undefined;
    if (!topic) {
      return res.status(400).json({ error: '主题节点不存在' });
    }
    if (topic.type !== 'topic') {
      return res.status(400).json({ error: '只有问题/主题节点可以保存知识总结' });
    }

    db.prepare(`
      INSERT INTO ontology_card_summaries (
        session_id, topic_id, status, summary, error, model, prompt_hash,
        completed_at, updated_at
      )
      VALUES (?, ?, 'done', ?, NULL, 'manual_edit', NULL, datetime('now'), datetime('now'))
      ON CONFLICT(session_id, topic_id) DO UPDATE SET
        status = 'done',
        summary = excluded.summary,
        error = NULL,
        model = COALESCE(ontology_card_summaries.model, excluded.model),
        completed_at = datetime('now'),
        updated_at = datetime('now')
    `).run(req.params.id, topicId, summary.trim());

    return res.json(getCardSummaryStatus(req.params.id, topicId));
  } catch (err) {
    console.error('PUT /:id/ontology/summarize-card/:topicId error:', err);
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: '保存知识总结时出错: ' + message });
  }
});

// ---------------------------------------------------------------------------
// POST /:id/ontology/summarize-card — start LLM summary task for one topic card
// ---------------------------------------------------------------------------

router.post('/:id/ontology/summarize-card', (req, res) => {
  try {
    const { topicId } = req.body || {};
    if (typeof topicId !== 'string' || !topicId.trim()) {
      return res.status(400).json({ error: 'topicId 不能为空' });
    }

    const existing = getCardSummaryStatus(req.params.id, topicId);
    if (existing.status === 'done' && existing.summary) {
      return res.json(existing);
    }
    if (existing.status === 'running') {
      return res.json(existing);
    }

    const db = getDb();
    const row = db
      .prepare('SELECT ontology_json FROM ontology WHERE session_id = ?')
      .get(req.params.id) as { ontology_json: string } | undefined;

    if (!row) {
      return res.status(404).json({ error: '该会话尚无本体数据' });
    }

    const data = JSON.parse(row.ontology_json) as OntologyDataLike;
    if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
      return res.status(400).json({ error: '本体数据结构不完整' });
    }

    const prompt = buildKnowledgeCardSummaryPrompt(data, topicId);
    startCardSummaryJob(req.params.id, topicId, prompt);
    return res.json(getCardSummaryStatus(req.params.id, topicId));
  } catch (err) {
    console.error('POST /:id/ontology/summarize-card error:', err);
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('主题节点') || message.includes('问题/主题')) {
      return res.status(400).json({ error: message });
    }
    return res.status(500).json({ error: '生成知识总结时出错: ' + message });
  }
});

// ---------------------------------------------------------------------------
// GET /:id/ontology/obsidian-card/:topicId — recover Obsidian sync status
// ---------------------------------------------------------------------------

router.get('/:id/ontology/obsidian-card/:topicId', (req, res) => {
  try {
    if (rejectUntrustedLocalRequest(req, res)) return;
    const row = getObsidianSyncRecord(req.params.id, req.params.topicId);
    const config = getObsidianConfig();
    const validation = validateConfig(config);
    let status = row?.status || 'not_synced';
    let notePath = row?.note_path || null;
    let error = row?.error || (validation.ok ? null : validation.error);

    if (row && validation.ok) {
      if (!syncRecordMatchesCurrentVault(row, config)) {
        status = 'not_synced';
        notePath = null;
        error = '当前 Obsidian Vault 与上次同步记录不一致';
      } else if (row.note_path) {
        const resolved = resolveObsidianNotePath(config, row.note_path);
        if (!resolved.ok || !existsSync(resolved.absolutePath)) {
          status = 'not_synced';
          notePath = row.note_path;
          error = resolved.ok ? '上次同步的 Obsidian 笔记文件不存在' : resolved.error;
        }
      }
    }

    return res.json({
      topicId: req.params.topicId,
      configured: validation.ok,
      status,
      notePath,
      error,
      lastSyncedAt: row?.last_synced_at || null,
      updatedAt: row?.updated_at || null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('GET /:id/ontology/obsidian-card/:topicId error:', err);
    return res.status(500).json({ error: '获取 Obsidian 同步状态失败: ' + message });
  }
});

// ---------------------------------------------------------------------------
// POST /:id/ontology/obsidian-card/:topicId — sync one topic card to Obsidian
// ---------------------------------------------------------------------------

router.post('/:id/ontology/obsidian-card/:topicId', (req, res) => {
  const sessionId = req.params.id;
  const topicId = req.params.topicId;

  try {
    if (rejectUntrustedLocalRequest(req, res)) return;
    const row = getDb()
      .prepare('SELECT ontology_json FROM ontology WHERE session_id = ?')
      .get(sessionId) as { ontology_json: string } | undefined;
    if (!row) return res.status(404).json({ error: '该会话尚无本体数据' });

    const data = JSON.parse(row.ontology_json) as ObsidianOntologyDataLike;
    const context = getKnowledgeCardContext(data, topicId);
    const config = getObsidianConfig();
    const summary = getSavedCardSummary(sessionId, topicId);
    const previousSync = getObsidianSyncRecord(sessionId, topicId);
    const previousRelativePath = syncRecordMatchesCurrentVault(previousSync, config)
      ? previousSync?.note_path
      : null;
    const result = writeObsidianCard({ config, sessionId, topicId, context, summary, previousRelativePath });

    getDb().prepare(`
      INSERT INTO ontology_obsidian_syncs (
        session_id, topic_id, vault_path, note_path, content_hash, status, error,
        last_synced_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, 'synced', NULL, datetime('now'), datetime('now'))
      ON CONFLICT(session_id, topic_id) DO UPDATE SET
        vault_path = excluded.vault_path,
        note_path = excluded.note_path,
        content_hash = excluded.content_hash,
        status = 'synced',
        error = NULL,
        last_synced_at = datetime('now'),
        updated_at = datetime('now')
    `).run(sessionId, topicId, config.vaultPath, result.relativePath, result.hash);

    return res.json({
      topicId,
      configured: true,
      status: 'synced',
      notePath: result.relativePath,
      skipped: result.skipped,
      error: null,
      lastSyncedAt: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      const config = getObsidianConfig();
      if (config.vaultPath) {
        getDb().prepare(`
          INSERT INTO ontology_obsidian_syncs (
            session_id, topic_id, vault_path, note_path, status, error, updated_at
          )
          VALUES (?, ?, ?, '', 'error', ?, datetime('now'))
          ON CONFLICT(session_id, topic_id) DO UPDATE SET
            status = 'error',
            error = excluded.error,
            updated_at = datetime('now')
        `).run(sessionId, topicId, config.vaultPath, message);
      }
    } catch {
      // Preserve the original sync error for the response.
    }

    console.error('POST /:id/ontology/obsidian-card/:topicId error:', err);
    return res.status(500).json({ error: '同步到 Obsidian 失败: ' + message });
  }
});

// ---------------------------------------------------------------------------
// POST /:id/ontology/build — run the 5-stage ontology build pipeline
// ---------------------------------------------------------------------------

router.post('/:id/ontology/build', (req, res) => {
  try {
    const db = getDb();
    const { candidates, relations, config } = req.body;

    // Validate required fields
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return res.status(400).json({ error: 'candidates 数组不能为空' });
    }
    if (!Array.isArray(relations)) {
      return res.status(400).json({ error: 'relations 数组不能为空' });
    }

    // Verify session exists
    const session = db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(req.params.id);
    if (!session) {
      return res.status(404).json({ error: '会话不存在' });
    }

    // Run the ontology build pipeline
    const result = buildOntology({ candidates, relations, config });
    const { data, meta, stats } = result;

    // Store built ontology in DB
    db.prepare(
      `INSERT OR REPLACE INTO ontology (session_id, ontology_json, max_turn, updated_at)
       VALUES (?, ?, ?, datetime('now'))`,
    ).run(req.params.id, JSON.stringify(data), meta.maxTurn);

    return res.status(201).json({ sessionId: req.params.id, ...result });
  } catch (err) {
    console.error('POST /:id/ontology/build error:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : '构建本体数据时出错',
    });
  }
});

// ---------------------------------------------------------------------------
// GET /:id/ontology/content-status — 检查提取文件树状态
// ---------------------------------------------------------------------------

router.get('/:id/ontology/content-status', async (req, res) => {
  const sessionId = req.params.id;
  const { loadExistingManifest } = await import('../content/extract-to-files.js');
  const manifest = loadExistingManifest(sessionId);
  if (manifest) {
    return res.json({ extracted: true, manifest });
  }
  return res.json({ extracted: false });
});

// ---------------------------------------------------------------------------
// POST /:id/ontology/content-extract — 仅提取内容到文件树（不调用 LLM）
// ---------------------------------------------------------------------------

router.post('/:id/ontology/content-extract', async (req, res) => {
  try {
    const db = getDb();
    const sessionId = req.params.id;

    const session = db.prepare('SELECT id, raw_jsonl, filename FROM sessions WHERE id = ?').get(sessionId) as
      | { id: string; raw_jsonl: string | null; filename: string }
      | undefined;
    if (!session) return res.status(404).json({ error: '会话不存在' });

    let rawJsonl = session.raw_jsonl;
    if (!rawJsonl) {
      const filePath = findJsonlFile(session.filename);
      if (filePath && existsSync(filePath)) {
        rawJsonl = readFileSync(filePath, 'utf-8');
      }
    }

    if (!rawJsonl) {
      return res.status(400).json({ error: '该会话的原始 JSONL 数据不可用' });
    }

    const { extractToFiles } = await import('../content/extract-to-files.js');
    const { shardSize, maxShardChars, force } = req.body || {};

    const manifest = extractToFiles(rawJsonl, sessionId, {
      shardSize: shardSize ?? 30,
      maxShardChars: maxShardChars ?? 45000,
      force: force ?? false,
    });

    return res.json({ success: true, manifest });
  } catch (err) {
    console.error('POST /:id/ontology/content-extract error:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : '提取内容时出错',
    });
  }
});

// ---------------------------------------------------------------------------
// POST /:id/ontology/extract — SSE 流式执行 LLM 本体提取
// ---------------------------------------------------------------------------

router.get('/:id/ontology/extract/status', (req, res) => {
  const job = extractJobs.get(req.params.id);
  if (!job) {
    const shardProgress = loadOntologyShardProgress(req.params.id);
    return res.json(shardProgress || { active: false, phase: 'idle' });
  }
  return res.json({ active: isExtractActive(job), ...job });
});

router.post('/:id/ontology/extract', async (req, res) => {
  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

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
      const shards = Array.isArray(eventData.shards)
        ? eventData.shards as Array<{ index: number; turnRange: string; startTurn?: number; endTurn?: number }>
        : [];
      shardMeta.clear();
      for (const shard of shards) {
        shardMeta.set(shard.index, {
          index: shard.index,
          turnRange: shard.turnRange,
          startTurn: shard.startTurn,
          endTurn: shard.endTurn,
        });
      }
    } else if (event === 'shard-done') {
      const shardIndex = eventData.shardIndex as number;
      upsertOntologyShard(req.params.id, eventData, 'done', shardMeta.get(shardIndex));
    } else if (event === 'shard-error') {
      const shardIndex = eventData.shardIndex as number;
      upsertOntologyShard(req.params.id, eventData, 'error', shardMeta.get(shardIndex));
    }
    updateExtractJob(req.params.id, event, eventData);
    if (!res.destroyed && !res.writableEnded) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(eventData)}\n\n`);
    }
  };

  try {
    const db = getDb();
    const sessionId = req.params.id;
    updateExtractJob(sessionId, 'start', { shards: 0, totalTurns: 0 });

    // 验证会话存在并获取 raw_jsonl
    const session = db.prepare('SELECT id, raw_jsonl, filename FROM sessions WHERE id = ?').get(sessionId) as
      | { id: string; raw_jsonl: string | null; filename: string }
      | undefined;
    if (!session) {
      send('error', { message: '会话不存在' });
      return;
    }

    // 优先使用 DB 中的 raw_jsonl，否则尝试从磁盘读取
    let rawJsonl = session.raw_jsonl;
    if (!rawJsonl) {
      const filePath = findJsonlFile(session.filename);
      if (filePath && existsSync(filePath)) {
        rawJsonl = readFileSync(filePath, 'utf-8');
      }
    }

    if (!rawJsonl) {
      send('error', { message: '该会话的原始 JSONL 数据不可用' });
      return;
    }

    // 动态导入 LLM 提取模块
    const { extractAndBuild } = await import('../llm/extract-ontology.js');
    const { shardSize, maxShardChars, force, incremental, retryFailedOnly, extractionDepth } = req.body || {};
    const depth = extractionDepth === 'deep' ? 'deep' : 'refined';
    const resolvedShardSize = typeof shardSize === 'number' ? shardSize : 30;
    const resolvedMaxShardChars = typeof maxShardChars === 'number' ? maxShardChars : 45000;
    const shardCache = loadOntologyShardCache(sessionId, depth, resolvedShardSize, resolvedMaxShardChars);
    if (retryFailedOnly === true && shardCache.failedShardIndices.length === 0) {
      send('error', { message: '没有找到可重跑的失败分片，请先执行一次完整提取' });
      return;
    }

    const result = await extractAndBuild(rawJsonl, sessionId, send, {
      shardSize: resolvedShardSize,
      maxShardChars: resolvedMaxShardChars,
      force: force ?? false,
      incremental: incremental ?? false,
      retryFailedOnly: retryFailedOnly === true,
      extractionDepth: depth,
      previousShardResults: retryFailedOnly === true ? shardCache.previousShardResults : [],
      failedShardIndices: retryFailedOnly === true ? shardCache.failedShardIndices : [],
    });

    if (result.success) {
      // 增量无新轮次：直接返回
      if (!result.buildOutput) {
        send('complete', { sessionId, maxTurn: 0, stats: { total: 0, succeeded: 0, failed: 0 }, noChange: true });
        return;
      }

      const { data, meta } = result.buildOutput;
      // 注入 aggregates 和 phaseThemes 到 data 中（buildOutput.data 不含它们）
      if ((result.buildOutput as any).aggregates) {
        (data as any).aggregates = (result.buildOutput as any).aggregates;
      }
      if ((result.buildOutput as any).phaseThemes) {
        (data as any).phaseThemes = (result.buildOutput as any).phaseThemes;
      }
      // 增量模式：合并到已有本体数据
      if (incremental) {
        const existing = db.prepare('SELECT ontology_json FROM ontology WHERE session_id = ?').get(sessionId) as { ontology_json: string } | undefined;
        if (existing) {
          try {
            const prev = JSON.parse(existing.ontology_json);
            const prevNodes = prev.nodes || [];
            const prevEdges = prev.edges || [];
            // 按 id 去重合并，新数据覆盖旧数据
            const nodeMap = new Map(prevNodes.map((n: { id: string }) => [n.id, n]));
            for (const n of data.nodes) nodeMap.set(n.id, n);
            const edgeMap = new Map(prevEdges.map((e: { s: string; t: string; label: string }) => [`${e.s}::${e.t}::${e.label}`, e]));
            for (const e of data.edges) edgeMap.set(`${e.s}::${e.t}::${e.label}`, e);
            data.nodes = Array.from(nodeMap.values());
            data.edges = Array.from(edgeMap.values());
            // 合并 aggregates
            if ((result.buildOutput as any).aggregates) {
              const prevAggs = prev.aggregates || [];
              const aggMap = new Map(prevAggs.map((a: { id: string }) => [a.id, a]));
              for (const a of (result.buildOutput as any).aggregates) aggMap.set(a.id, a);
              (data as any).aggregates = Array.from(aggMap.values());
            }
          } catch { /* 解析失败则用新数据覆盖 */ }
        }
      }
      db.prepare(
        `INSERT OR REPLACE INTO ontology (session_id, ontology_json, max_turn, updated_at)
         VALUES (?, ?, ?, datetime('now'))`,
      ).run(sessionId, JSON.stringify(data), meta.maxTurn);
      send('complete', { sessionId, maxTurn: meta.maxTurn, stats: result.shardStats });
    } else {
      send('error', { message: result.message, detail: result.detail, stage: result.stage });
    }
  } catch (err) {
    console.error('POST /:id/ontology/extract error:', err);
    send('error', { message: '提取本体数据时出错: ' + (err instanceof Error ? err.message : String(err)) });
  } finally {
    if (!res.destroyed && !res.writableEnded) {
      res.end();
    }
  }
});

export default router;
