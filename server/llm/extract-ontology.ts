/**
 * extract-ontology.ts
 *
 * 主编排器：从 JSONL 会话转录中自动提取上下文本体。
 *
 * 流水线：
 *   1. Extract      — extractToFiles() 写入持久化文件树
 *   2. Orchestrate  — Agent SDK query() 派发子 Agent 并行提取
 *   3. Collect      — 从子 Agent tool_result 中解析 JSON 结果
 *   4. Merge        — 合并多个分片的结果（去重、择优）
 *   5. Build        — buildOntology() 构建最终图谱
 *   6. Return       — 返回成功结果或失败信息
 */

import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { extractToFiles, extractIncremental, type ExtractionManifest, type ShardFile } from '../content/extract-to-files.js';
import { buildOntology, type OntologyBuildOutput } from '../../shared/pipeline/build-ontology.js';
import type { CandidateEntity, SemanticRelation, OntologyBuildConfig } from '../../shared/pipeline/build-ontology.js';
import type { OntologyEvidence } from '../../shared/types/ontology.js';
import { buildEntityExtractorDef, buildOrchestratorPrompt, type ExtractionDepth } from './orchestrator-prompt.js';
import { SubmitExtractionSchema } from './schema.js';
import { sanitizeForLog } from '../utils/log-sanitizer.js';
import { DEFAULT_MODEL, DEFAULT_BASE_URL, buildSafeEnv } from './config.js';

// ── 类型 ──────────────────────────────────────────────────────────────────

export interface ShardResult {
  shardIndex: number;
  phaseTheme?: string;
  candidates: CandidateEntity[];
  relations: SemanticRelation[];
  config?: OntologyBuildConfig;
}

interface MissingShard {
  index: number;
  turnRange: string;
  startTurn: number;
  endTurn: number;
  reason: string;
}

/** 分片收集的结构化错误 — 区分致命错误和可恢复错误 */
export interface ShardError {
  type: 'fatal' | 'recoverable';
  detail: string;
  /** 致命错误时标识是否应终止整个提取流程 */
  shouldAbort?: boolean;
}

const LLM_EXTRACTION_BATCH_SIZE = 8;
const LLM_EXTRACTION_MAX_ATTEMPTS = 3;
/** Agent SDK 最大连续失败次数，超过则熔断跳过剩余分片 */
const LLM_EXTRACTION_MAX_CONSECUTIVE_FAILURES = 3;
/** Agent SDK 超时时间（毫秒），单次 query 最长等待 */
const LLM_EXTRACTION_TIMEOUT_MS = 10 * 60 * 1000; // 10 分钟

export interface ExtractSuccess {
  success: true;
  buildOutput: OntologyBuildOutput | null; // 增量无变化时为 null
  shardStats: { total: number; succeeded: number; failed: number };
}

export interface ExtractFailure {
  success: false;
  stage: 'content' | 'llm' | 'build' | 'store';
  message: string;
  detail?: string;
}

export type ExtractResult = ExtractSuccess | ExtractFailure;

// ── JSON 解析 ────────────────────────────────────────────────────────────

function parseJsonFromText(text: string): unknown | null {
  // 1. 直接解析
  try { return JSON.parse(text); } catch {}

  // 2. ```json ... ``` 包裹
  const m = text.match(/```json\s*([\s\S]*?)```/);
  if (m?.[1]) try { return JSON.parse(m[1]); } catch {}

  // 3. ``` ... ``` 包裹
  const m2 = text.match(/```\s*([\s\S]*?)```/);
  if (m2?.[1]) try { return JSON.parse(m2[1]); } catch {}

  // 4. 第一个 { 到最后一个 }
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a !== -1 && b > a) try { return JSON.parse(text.slice(a, b + 1)); } catch {}

  return null;
}

function formatValidationError(err: unknown): string {
  if (err && typeof err === 'object' && 'issues' in err) {
    const issues = (err as { issues?: Array<{ path?: Array<string | number>; message: string }> }).issues || [];
    return issues
      .slice(0, 3)
      .map((i) => `${i.path?.join('.') || '<root>'}: ${i.message}`)
      .join('; ');
  }
  return err instanceof Error ? err.message : String(err);
}

function toOntologyEvidence(evidence: Array<OntologyEvidence | (Omit<OntologyEvidence, 'source'> & { source?: OntologyEvidence['source'] })>): OntologyEvidence[] {
  return evidence.map((e) => ({
    ...e,
    source: e.source ?? 'reasoning_summary',
  }));
}

function collectParsedItems(parsed: unknown): unknown[] {
  if (!parsed || typeof parsed !== 'object') return [];
  const single = parsed as Record<string, unknown>;
  return Array.isArray(parsed)
    ? parsed
    : Array.isArray(single.results)
      ? single.results
      : [parsed];
}

function textFromToolResultContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return (content as Array<{ type: string; text?: string }>)
      .filter((c) => c.type === 'text' && c.text)
      .map((c) => c.text!)
      .join('\n');
  }
  if (content && typeof content === 'object') return JSON.stringify(content);
  return '';
}

async function collectShardTextResults(params: {
  manifest: ExtractionManifest;
  shards: ShardFile[];
  model: string;
  apiKey: string;
  baseUrl: string;
  depth: ExtractionDepth;
  onEvent: (event: string, data: Record<string, unknown>) => void;
  attempt: number;
}): Promise<{ results: Map<number, string>; errors: ShardError[] }> {
  const { manifest, shards, model, apiKey, baseUrl, depth, onEvent, attempt } = params;
  const shardTextResults: Map<number, string> = new Map();
  const errors: ShardError[] = [];
  if (shards.length === 0) return { results: shardTextResults, errors };

  const abort = new AbortController();
  const expectedShards = shards.length;

  if (attempt === 1) {
    for (const shard of shards) onEvent('shard-start', { shardIndex: shard.index });
  } else {
    for (const shard of shards) onEvent('shard-retry', { shardIndex: shard.index, attempt });
  }

  // 超时保护：防止 Agent SDK 永久挂起
  const timeoutId = setTimeout(() => {
    console.error('[extract-ontology] Agent SDK 超时（%d ms），中止', LLM_EXTRACTION_TIMEOUT_MS);
    abort.abort();
  }, LLM_EXTRACTION_TIMEOUT_MS);

  try {
    const q = query({
      prompt: '请开始提取。',
      options: {
        abortController: abort,
        systemPrompt: buildOrchestratorPrompt(manifest, shards, depth),
        model,
        agents: { 'entity-extractor': buildEntityExtractorDef(depth) },
        allowedTools: ['Read', 'Task'],
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        maxTurns: Math.max(shards.length + 5, 5),
        thinking: { type: 'disabled' as const },
        cwd: manifest.rootDir.replace(/\/data\/extractions\/.*$/, ''),
        env: { ...buildSafeEnv({}), ANTHROPIC_API_KEY: apiKey, ANTHROPIC_BASE_URL: baseUrl },
      },
    });

    for await (const msg of q) {
      const mtype = (msg as Record<string, unknown>).type as string;
      const msubtype = (msg as Record<string, unknown>).subtype as string || '';
      console.error('[msg]', sanitizeForLog(mtype), sanitizeForLog(msubtype));

      if (msg.type === 'system' && msubtype === 'init') {
        onEvent('agent-start', { sessionId: (msg as SDKMessage & { session_id: string }).session_id });
      }

      if (msg.type === 'assistant') {
        const am = msg as SDKMessage & { type: 'assistant'; message?: { content?: unknown[] } };
        if (am.message?.content) {
          for (const block of am.message.content as Array<{ type: string; text?: string; name?: string }>) {
            if (block.type === 'text') console.error('  [asst text]', sanitizeForLog((block.text || '').substring(0, 120)));
            if (block.type === 'tool_use') console.error('  [asst tool]', block.name);
          }
        }
      }

      if (msg.type === 'user') {
        const um = msg as SDKMessage & { type: 'user'; message?: { role: string; content?: unknown[] } };
        const blocks = (um.message?.content && Array.isArray(um.message.content))
          ? um.message.content
          : (um.message?.content ? [um.message.content] : []);

        for (const block of blocks as Array<{ type: string; tool_use_id?: string; content?: unknown; text?: string; name?: string }>) {
          if (block.type !== 'tool_result') continue;

          const text = textFromToolResultContent(block.content);
          if (!text) continue;

          console.error('  [tool_result]', sanitizeForLog(text.substring(0, 200)));
          const parsed = parseJsonFromText(text);
          for (const item of collectParsedItems(parsed)) {
            const validation = SubmitExtractionSchema.safeParse(item);
            if (validation.success) {
              const r = validation.data;
              shardTextResults.set(r.shardIndex, JSON.stringify(r));
              console.error('  [parsed shard]', r.shardIndex, 'theme:', sanitizeForLog(r.phaseTheme || ''));
              const shard = manifest.shards.find((s) => s.index === r.shardIndex);
              onEvent('shard-done', {
                shardIndex: r.shardIndex,
                phaseTheme: r.phaseTheme,
                candidates: r.candidates,
                relations: r.relations,
                config: r.config,
                turnRange: shard?.turnRange,
                startTurn: shard?.startTurn,
                endTurn: shard?.endTurn,
                extractionDepth: depth,
              });
            } else {
              const candidate = item as Record<string, unknown>;
              const shardIndex = typeof candidate?.shardIndex === 'number' ? candidate.shardIndex : -1;
              const error = formatValidationError(validation.error);
              console.error('  [validation error]', shardIndex, sanitizeForLog(error));
              const shard = manifest.shards.find((s) => s.index === shardIndex);
              onEvent('shard-error', {
                shardIndex,
                error,
                turnRange: shard?.turnRange,
                startTurn: shard?.startTurn,
                endTurn: shard?.endTurn,
                extractionDepth: depth,
              });
            }
          }
        }
      }

      if (shardTextResults.size >= expectedShards) {
        console.error('[extract-ontology] All', expectedShards, 'shards collected, aborting Agent SDK...');
        abort.abort();
        break;
      }

      if (msg.type === 'result') {
        const resultStr = JSON.stringify(msg);
        console.error('  [result]', sanitizeForLog(resultStr.substring(0, 400)));
      }
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      // 区分超时中止和正常中止
      if (shardTextResults.size === 0) {
        const errorDetail = 'Agent SDK 请求超时，所有分片均未返回结果';
        console.error('[extract-ontology]', errorDetail);
        errors.push({ type: 'fatal', detail: errorDetail, shouldAbort: true });
      } else {
        console.error('[extract-ontology] Agent SDK aborted (expected)');
      }
    } else {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('[extract-ontology] Agent SDK error:', sanitizeForLog(errorMsg));
      onEvent('agent-error', { message: errorMsg });

      // SDK 层面的网络/认证错误视为可恢复（允许重试），SDK 内部崩溃视为致命
      const isFatal = errorMsg.includes('ENOENT') || errorMsg.includes('EACCES') || errorMsg.includes('cwd');
      errors.push({
        type: isFatal ? 'fatal' : 'recoverable',
        detail: errorMsg,
        shouldAbort: isFatal,
      });
    }
  } finally {
    clearTimeout(timeoutId);
  }

  return { results: shardTextResults, errors };
}

// ── 聚合生成 ────────────────────────────────────────────────────────────

interface Aggregate {
  id: string;
  label: string;
  startTurn: number;
  endTurn: number;
  shardIndices: number[];
  nodeIds: string[];
}

function buildAggregates(
  themes: Array<{ shardIndex: number; startTurn: number; theme: string }>,
  manifest: ExtractionManifest,
): Aggregate[] {
  if (themes.length === 0) return [];
  const sorted = [...themes].sort((a, b) => a.shardIndex - b.shardIndex);
  const aggregates: Aggregate[] = [];
  let current: Aggregate | null = null;

  for (const t of sorted) {
    if (current && current.label === t.theme) {
      // 相同主题：扩展当前聚合
      current.endTurn = manifest.shards.find((s) => s.index === t.shardIndex)?.endTurn ?? t.startTurn;
      current.shardIndices.push(t.shardIndex);
    } else {
      if (current) aggregates.push(current);
      current = {
        id: `agg_${String(aggregates.length).padStart(3, '0')}`,
        label: t.theme,
        startTurn: t.startTurn,
        endTurn: manifest.shards.find((s) => s.index === t.shardIndex)?.endTurn ?? t.startTurn,
        shardIndices: [t.shardIndex],
        nodeIds: [],
      };
    }
  }
  if (current) aggregates.push(current);

  // 合并相似标签的相邻聚合
  return mergeSimilarAggregates(aggregates);
}

function mergeSimilarAggregates(aggs: Aggregate[]): Aggregate[] {
  if (aggs.length <= 1) return aggs;
  const result: Aggregate[] = [aggs[0]!];
  for (let i = 1; i < aggs.length; i++) {
    const prev = result[result.length - 1]!;
    const curr = aggs[i]!;
    if (jaccardSimilarity(prev.label, curr.label) > 0.5) {
      prev.label = prev.label.length <= curr.label.length ? prev.label : curr.label;
      prev.endTurn = curr.endTurn;
      prev.shardIndices = [...new Set([...prev.shardIndices, ...curr.shardIndices])];
      prev.nodeIds = [...new Set([...prev.nodeIds, ...curr.nodeIds])];
    } else {
      result.push(curr);
    }
  }
  return result;
}

// ── 合并 ──────────────────────────────────────────────────────────────────

function mergeResults(results: ShardResult[], maxTurn: number): {
  candidates: CandidateEntity[];
  relations: SemanticRelation[];
  config: OntologyBuildConfig;
} {
  const candidateMap = new Map<string, CandidateEntity>();
  for (const shard of results) {
    for (const c of shard.candidates) {
      const existing = candidateMap.get(c.id);
      if (!existing || c.conf > existing.conf) {
        candidateMap.set(c.id, {
          ...c,
          turns: [...new Set([...(existing?.turns || []), ...c.turns])].sort((a, b) => a - b),
          aliases: [...new Set([...(existing?.aliases || []), ...(c.aliases || [])])],
          evidence: [...(existing?.evidence || []), ...(c.evidence || [])],
          firstTurn: existing ? Math.min(existing.firstTurn, c.firstTurn) : c.firstTurn,
        });
      } else {
        candidateMap.set(c.id, {
          ...existing,
          turns: [...new Set([...existing.turns, ...c.turns])].sort((a, b) => a - b),
          aliases: [...new Set([...(existing.aliases || []), ...(c.aliases || [])])],
          evidence: [...(existing.evidence || []), ...(c.evidence || [])],
        });
      }
    }
  }

  // 边方向保留：不排序 s,t
  const relationMap = new Map<string, SemanticRelation>();
  for (const shard of results) {
    for (const r of shard.relations) {
      const key = [r.s, r.t, r.label].join('::');
      const existing = relationMap.get(key);
      if (!existing || r.conf > existing.conf) {
        relationMap.set(key, {
          ...r,
          firstTurn: existing ? Math.min(existing.firstTurn, r.firstTurn) : r.firstTurn,
          evidence: [...(existing?.evidence || []), ...(r.evidence || [])],
        });
      } else {
        relationMap.set(key, {
          ...existing,
          firstTurn: Math.min(existing.firstTurn, r.firstTurn),
          evidence: [...(existing.evidence || []), ...(r.evidence || [])],
        });
      }
    }
  }

  const mergedConfig: OntologyBuildConfig = {};
  for (const shard of results) {
    if (shard.config) {
      Object.assign(mergedConfig, shard.config);
      if (shard.config.reclassify) {
        mergedConfig.reclassify = { ...(mergedConfig.reclassify || {}), ...shard.config.reclassify };
      }
    }
  }

  return { candidates: Array.from(candidateMap.values()), relations: Array.from(relationMap.values()), config: mergedConfig };
}

// ── 质量改进 ──────────────────────────────────────────────────────────────

const EVIDENCE_WEIGHT_CAP = {
  user: 1.0,
  reply: 0.9,
  tool_summary: 0.6,
  reasoning_summary: 0.45,
} as const;

function evidenceWeight(source: string, weight: number): number {
  const cap = EVIDENCE_WEIGHT_CAP[source as keyof typeof EVIDENCE_WEIGHT_CAP] ?? 0.45;
  const value = Number.isFinite(weight) ? weight : cap;
  return Math.max(0, Math.min(cap, value));
}

function evidenceScore(node: CandidateEntity): {
  score: number;
  hasPrimary: boolean;
  hasReasoningOnly: boolean;
  hasToolOnly: boolean;
  hasEvidence: boolean;
} {
  const evidence = node.evidence || [];
  if (evidence.length === 0) {
    return { score: 0.35, hasPrimary: false, hasReasoningOnly: false, hasToolOnly: false, hasEvidence: false };
  }
  const normalized = evidence.map((e) => evidenceWeight(e.source, e.weight));
  const top = Math.max(...normalized);
  const diversity = new Set(evidence.map((e) => e.source)).size;
  const repeatBonus = Math.min(0.16, Math.log1p(Math.max(0, evidence.length - 1)) * 0.06);
  const diversityBonus = Math.min(0.10, (diversity - 1) * 0.04);
  const score = Math.min(1, top + repeatBonus + diversityBonus);
  const hasPrimary = evidence.some((e) => e.source === 'user' || e.source === 'reply');
  const hasReasoningOnly = !hasPrimary && evidence.length > 0 && evidence.every((e) => e.source === 'reasoning_summary');
  const hasToolOnly = !hasPrimary && evidence.length > 0 && evidence.every((e) => e.source === 'tool_summary');
  return { score, hasPrimary, hasReasoningOnly, hasToolOnly, hasEvidence: true };
}

function inferStatus(node: CandidateEntity): 'confirmed' | 'inferred' | 'needs_confirmation' {
  const ev = evidenceScore(node);
  if (ev.hasReasoningOnly) return 'needs_confirmation';
  if (ev.hasPrimary) return node.status === 'needs_confirmation' ? 'needs_confirmation' : 'confirmed';
  return 'inferred';
}

function normalizeEvidence(node: CandidateEntity): void {
  const seen = new Set<string>();
  node.evidence = (node.evidence || [])
    .map((e) => ({
      ...e,
      text: e.text.length > 220 ? e.text.slice(0, 217) + '...' : e.text,
      weight: evidenceWeight(e.source, e.weight),
    }))
    .filter((e) => {
      const key = `${e.turn}:${e.source}:${e.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.turn - b.turn || b.weight - a.weight || a.source.localeCompare(b.source))
    .slice(0, 8);
}

function nodeShardCount(node: CandidateEntity, shards: ShardFile[]): number {
  const turns = new Set([
    node.firstTurn,
    ...(node.turns || []),
    ...(node.evidence || []).map((e) => e.turn),
  ].filter((turn) => Number.isFinite(turn)));
  const shardIds = new Set<number>();
  for (const turn of turns) {
    const shard = shards.find((s) => turn >= s.startTurn && turn <= s.endTurn);
    if (shard) shardIds.add(shard.index);
  }
  return Math.max(1, shardIds.size);
}

function snippetSupportsLabel(node: CandidateEntity): boolean {
  const snippet = (node.snippet || '').toLocaleLowerCase();
  if (!snippet) return false;
  const label = node.label.toLocaleLowerCase();
  const terms = [
    label,
    label.slice(0, 2),
    ...(node.aliases || []).map((alias) => alias.toLocaleLowerCase()),
  ].filter((term) => term.length >= 2);
  return terms.some((term) => snippet.includes(term));
}

/** 计算客观置信度 */
function computeConf(node: CandidateEntity, shards: ShardFile[]): number {
  const ev = evidenceScore(node);
  const turnCount = new Set(node.turns || []).size;
  const turnSupport = Math.min(0.18, Math.log1p(Math.max(1, turnCount)) * 0.075);
  const rawConf = Math.max(0, Math.min(1, node.rawConf ?? node.conf ?? 0.5));
  const base = ev.score * 0.62 + turnSupport + rawConf * 0.12;
  const crossShardBonus = 1 + 0.06 * Math.min(nodeShardCount(node, shards) - 1, 3);
  const snippetMult = snippetSupportsLabel(node) ? 1.0 : 0.9;
  let conf = base * crossShardBonus * snippetMult;

  if (ev.hasReasoningOnly) {
    conf = Math.min(conf, 0.55);
  } else if (!ev.hasPrimary && ev.hasToolOnly) {
    conf = Math.min(conf, 0.65);
  } else if (!ev.hasPrimary) {
    conf = Math.min(conf, ev.hasEvidence ? 0.60 : 0.50);
  }

  return Math.min(0.95, Math.max(0.25, conf));
}

/** 跨分片语义去重：label Jaccard 相似度 > 0.7 的实体对合并 */
function dedupByLabel(nodes: CandidateEntity[]): CandidateEntity[] {
  const result: CandidateEntity[] = [];
  const used = new Set<number>();

  for (let i = 0; i < nodes.length; i++) {
    if (used.has(i)) continue;
    let merged = { ...nodes[i]! };
    for (let j = i + 1; j < nodes.length; j++) {
      if (used.has(j)) continue;
      const sim = jaccardSimilarity(merged.label, nodes[j]!.label);
      if (sim > 0.7) {
        merged = {
          ...merged,
          turns: [...new Set([...merged.turns, ...nodes[j]!.turns])].sort((a, b) => a - b),
          aliases: [...new Set([...(merged.aliases || []), ...(nodes[j]!.aliases || [])])],
          evidence: [...(merged.evidence || []), ...(nodes[j]!.evidence || [])],
          firstTurn: Math.min(merged.firstTurn, nodes[j]!.firstTurn),
          conf: Math.max(merged.conf, nodes[j]!.conf),
          note: (merged.note || '') + ` 与「${nodes[j]!.label}」语义合并`,
        };
        used.add(j);
      }
    }
    result.push(merged);
  }
  return result;
}

function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

/** snippet 质量检测 */
function checkSnippetQuality(snippet: string, label: string): 'ok' | 'low' {
  for (let i = 0; i <= label.length - 2; i++) {
    if (snippet.includes(label.substring(i, i + 2))) return 'ok';
  }
  return 'low';
}

// ── 主入口 ────────────────────────────────────────────────────────────────

export async function extractAndBuild(
  rawJsonl: string,
  sessionId: string,
  onEvent: (event: string, data: Record<string, unknown>) => void,
  options?: {
    shardSize?: number;
    maxShardChars?: number;
    force?: boolean;
    incremental?: boolean;
    retryFailedOnly?: boolean;
    extractionDepth?: ExtractionDepth;
    previousShardResults?: ShardResult[];
    failedShardIndices?: number[];
  },
): Promise<ExtractResult> {
  const shardSize = options?.shardSize ?? 30;
  const maxShardChars = options?.maxShardChars ?? 45_000;
  const force = options?.force ?? false;
  const incremental = options?.incremental ?? false;
  const retryFailedOnly = options?.retryFailedOnly ?? false;
  const extractionDepth: ExtractionDepth = options?.extractionDepth === 'deep' ? 'deep' : 'refined';

  // Step 1: Extract to file tree
  let manifest: ExtractionManifest;
  let processShardIndices: number[] | undefined; // 仅增量模式：需要 LLM 处理的分片

  try {
    if (incremental) {
      const incResult = await extractIncremental(rawJsonl, sessionId, { shardSize, maxShardChars });
      manifest = incResult.manifest;
      if (!incResult.hasNewTurns) {
        onEvent('extracted', {
          totalTurns: manifest.totalTurns, shardCount: manifest.shardCount, rootDir: manifest.rootDir,
          shards: manifest.shards.map((s) => ({
            index: s.index,
            filename: s.filename,
            turnRange: s.turnRange,
            turnCount: s.turnCount,
            startTurn: s.startTurn,
            endTurn: s.endTurn,
          })),
          incremental: true, newTurns: false,
        });
        return { success: true, buildOutput: null, shardStats: { total: 0, succeeded: 0, failed: 0 } };
      }
      processShardIndices = incResult.newShardIndices;
    } else {
      manifest = await extractToFiles(rawJsonl, sessionId, { shardSize, maxShardChars, force });
    }
  } catch (err) {
    return { success: false, stage: 'content', message: '内容提取失败: ' + (err instanceof Error ? err.message : String(err)) };
  }

  if (manifest.totalTurns === 0) {
    return { success: false, stage: 'content', message: '未从 JSONL 中提取到任何用户 turn 内容' };
  }

  let activeShards = processShardIndices
    ? manifest.shards.filter((s) => processShardIndices!.includes(s.index))
    : manifest.shards;

  if (retryFailedOnly) {
    const failedSet = new Set(options?.failedShardIndices || []);
    activeShards = manifest.shards.filter((s) => failedSet.has(s.index));
  }

  if (activeShards.length === 0) {
    onEvent('extracted', {
      totalTurns: manifest.totalTurns,
      shardCount: manifest.shardCount,
      activeShards: 0,
      incremental: incremental && processShardIndices != null,
      retryFailedOnly,
      extractionDepth,
      rootDir: manifest.rootDir,
      shards: activeShards.map((s) => ({
        index: s.index,
        filename: s.filename,
        turnRange: s.turnRange,
        turnCount: s.turnCount,
        startTurn: s.startTurn,
        endTurn: s.endTurn,
      })),
    });
    return { success: true, buildOutput: null, shardStats: { total: 0, succeeded: 0, failed: 0 } };
  }

  onEvent('extracted', {
    totalTurns: manifest.totalTurns, shardCount: manifest.shardCount,
    activeShards: activeShards.length, incremental: incremental && processShardIndices != null,
    retryFailedOnly,
    extractionDepth,
    rootDir: manifest.rootDir,
    shards: activeShards.map((s) => ({
      index: s.index,
      filename: s.filename,
      turnRange: s.turnRange,
      turnCount: s.turnCount,
      startTurn: s.startTurn,
      endTurn: s.endTurn,
    })),
  });

  // Step 2: Agent SDK orchestration
  const model = process.env.LLM_MODEL || DEFAULT_MODEL;
  const apiKey = process.env.LLM_API_KEY;
  const baseUrl = process.env.LLM_BASE_URL || DEFAULT_BASE_URL;

  if (!apiKey) {
    return { success: false, stage: 'llm', message: '未设置 LLM_API_KEY 环境变量' };
  }

  onEvent('start', { shards: activeShards.length, totalTurns: manifest.totalTurns, extractionDepth });

  const shardTextResults: Map<number, string> = new Map();
  const activeShardIndexSet = new Set(activeShards.map((s) => s.index));
  let pendingShards = activeShards;
  let consecutiveFailures = 0;
  let globalAbort = false;

  for (let attempt = 1; attempt <= LLM_EXTRACTION_MAX_ATTEMPTS && pendingShards.length > 0 && !globalAbort; attempt++) {
    const retryLabel = attempt === 1 ? 'initial' : `retry ${attempt - 1}`;
    console.error('[extract-ontology] Starting', retryLabel, 'for shards:', pendingShards.map((s) => s.index).join(','));

    for (let i = 0; i < pendingShards.length; i += LLM_EXTRACTION_BATCH_SIZE) {
      if (globalAbort) break;

      const batch = pendingShards.slice(i, i + LLM_EXTRACTION_BATCH_SIZE);
      const { results: batchResults, errors: batchErrors } = await collectShardTextResults({
        manifest,
        shards: batch,
        model,
        apiKey,
        baseUrl,
        depth: extractionDepth,
        onEvent,
        attempt,
      });

      for (const [shardIndex, text] of batchResults) {
        if (activeShardIndexSet.has(shardIndex)) {
          shardTextResults.set(shardIndex, text);
        }
      }

      // 处理错误：致命错误终止流程，可恢复错误计入熔断计数
      for (const err of batchErrors) {
        if (err.type === 'fatal' && err.shouldAbort) {
          globalAbort = true;
          console.error('[extract-ontology] 致命错误，终止提取:', sanitizeForLog(err.detail));
          break;
        }
        if (err.type === 'fatal') {
          globalAbort = true;
          console.error('[extract-ontology] 致命错误，终止提取:', sanitizeForLog(err.detail));
          break;
        }
      }

      // 熔断判断：连续失败超过阈值则跳过剩余分片
      if (batchResults.size === 0 && batchErrors.length > 0 && batchErrors.every((e) => e.type === 'recoverable')) {
        consecutiveFailures++;
      } else {
        consecutiveFailures = 0;
      }

      if (consecutiveFailures >= LLM_EXTRACTION_MAX_CONSECUTIVE_FAILURES) {
        console.error('[extract-ontology] 连续 %d 批失败，触发熔断，跳过剩余分片', consecutiveFailures);
        globalAbort = true;
        break;
      }
    }

    if (globalAbort) break;
    pendingShards = activeShards.filter((s) => !shardTextResults.has(s.index));
  }

  const missingShards: MissingShard[] = pendingShards.map((shard) => ({
    index: shard.index,
    turnRange: shard.turnRange,
    startTurn: shard.startTurn,
    endTurn: shard.endTurn,
    reason: '多次重试后未返回有效抽取结果',
  }));

  for (const shard of missingShards) {
    onEvent('shard-error', {
      shardIndex: shard.index,
      error: shard.reason,
      turnRange: shard.turnRange,
      startTurn: shard.startTurn,
      endTurn: shard.endTurn,
      extractionDepth,
    });
  }

  // Step 3: Parse collected results
  const shardResults: ShardResult[] = [...(options?.previousShardResults || [])];
  const phaseThemes: Array<{ shardIndex: number; startTurn: number; theme: string }> = [];
  for (const previous of options?.previousShardResults || []) {
    const shard = manifest.shards.find((s) => s.index === previous.shardIndex);
    if (previous.phaseTheme && shard) {
      phaseThemes.push({ shardIndex: previous.shardIndex, startTurn: shard.startTurn, theme: previous.phaseTheme });
    }
  }
  for (const [, text] of shardTextResults) {
    const parsed = parseJsonFromText(text);
    const validation = SubmitExtractionSchema.safeParse(parsed);
    if (validation.success) {
      const r = validation.data;
      const shardIdx = r.shardIndex;
      const theme = r.phaseTheme;
      // turns 校验：过滤掉不在当前分片轮次范围内的值
      const shard = manifest.shards.find((s) => s.index === shardIdx);
      const shardStart = shard?.startTurn ?? 1;
      const shardEnd = shard?.endTurn ?? manifest.totalTurns;
      const validatedCandidates = r.candidates.map((c) => ({
        ...c,
        evidence: toOntologyEvidence(c.evidence),
        turns: c.turns.filter((t) => t >= shardStart && t <= shardEnd),
      }));
      const validatedRelations = r.relations.map((relation) => ({
        ...relation,
        evidence: toOntologyEvidence(relation.evidence),
      }));
      const withoutPrevious = shardResults.filter((x) => x.shardIndex !== shardIdx);
      shardResults.length = 0;
      shardResults.push(...withoutPrevious, {
        shardIndex: shardIdx,
        phaseTheme: theme,
        candidates: validatedCandidates,
        relations: validatedRelations,
        config: r.config,
      });
      phaseThemes.push({ shardIndex: shardIdx, startTurn: shardStart, theme });
    } else {
      onEvent('shard-error', { shardIndex: -1, error: formatValidationError(validation.error) });
    }
  }

  if (shardResults.length === 0) {
    return { success: false, stage: 'llm', message: '未能从子 Agent 输出中解析出任何结果' };
  }

  // Step 4: Merge + 质量改进
  const merged = mergeResults(shardResults, manifest.totalTurns);
  merged.config.maxTurn = manifest.totalTurns;

  // 语义去重
  merged.candidates = dedupByLabel(merged.candidates);

  // 生成聚合
  const aggregates = buildAggregates(phaseThemes, manifest);

  // 为每个 entity 计算客观 conf、snippet 质量、聚合归属
  const aggTopicId = new Map<string, string>(); // 每个聚合只保留一个 topic
  const mergedTopicIds = new Set<string>();
  for (const c of merged.candidates) {
    normalizeEvidence(c);
    c.status = inferStatus(c);
    c.rawConf = c.conf;
    c.conf = computeConf(c, manifest.shards);
    c.snippetQuality = checkSnippetQuality(c.snippet, c.label);
    const agg = aggregates.find((a) => c.firstTurn >= a.startTurn && c.firstTurn <= a.endTurn);
    if (agg) {
      if (c.type === 'topic') {
        const existingId = aggTopicId.get(agg.id);
        if (existingId) {
          const prev = merged.candidates.find((x) => x.id === existingId);
          if (prev) {
            prev.turns = [...new Set([...prev.turns, ...c.turns])].sort((a, b) => a - b);
            prev.aliases = [...new Set([...(prev.aliases || []), ...(c.aliases || [])])];
            prev.evidence = [...(prev.evidence || []), ...(c.evidence || [])];
            normalizeEvidence(prev);
            prev.status = inferStatus(prev);
            prev.conf = Math.max(prev.conf, c.conf);
            prev.firstTurn = Math.min(prev.firstTurn, c.firstTurn);
          }
          mergedTopicIds.add(c.id);
          continue;
        }
        aggTopicId.set(agg.id, c.id);
      }
      c.aggregateId = agg.id;
      agg.nodeIds.push(c.id);
    }
  }
  merged.candidates = merged.candidates.filter((c) => !mergedTopicIds.has(c.id));

  onEvent('merge', { candidates: merged.candidates, relations: merged.relations, aggregates });

  // Step 5: Build
  onEvent('build', {});
  let buildOutput: OntologyBuildOutput;
  try {
    buildOutput = buildOntology({
      candidates: merged.candidates,
      relations: merged.relations,
      config: { ...merged.config, maxTurn: manifest.totalTurns, pruneOrphans: false },
    });
  } catch (err) {
    return { success: false, stage: 'build', message: '本体构建失败: ' + (err instanceof Error ? err.message : String(err)) };
  }

  buildOutput.aggregates = aggregates;
  if (phaseThemes.length > 0) {
    buildOutput.phaseThemes = phaseThemes;
  }
  if (missingShards.length > 0) {
    buildOutput.data.incomplete = true;
    buildOutput.data.missingShards = missingShards;
  }

  return {
    success: true,
    buildOutput,
    shardStats: {
      total: activeShards.length,
      succeeded: shardResults.length,
      failed: missingShards.length,
    },
  };
}
