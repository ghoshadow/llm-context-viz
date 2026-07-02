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

import { extractToFiles, extractIncremental, type ExtractionManifest } from '../content/extract-to-files.js';
import { buildOntology, type OntologyBuildOutput } from '../../shared/pipeline/build-ontology.js';
import type { CandidateEntity, SemanticRelation, OntologyBuildConfig } from '../../shared/pipeline/build-ontology.js';
import type { ExtractionDepth } from './orchestrator-prompt.js';
import { SubmitExtractionSchema } from './schema.js';
import { sanitizeForLog } from '../utils/log-sanitizer.js';
import { DEFAULT_MODEL, DEFAULT_BASE_URL } from './config.js';
import { collectShardTextResults } from './ontology-shard-collector.js';
import { buildAggregates, mergeResults } from './ontology-merge.js';
import { computeConf, dedupByLabel, inferStatus, normalizeEvidence, checkSnippetQuality } from './ontology-confidence.js';
import { formatValidationError, parseJsonFromText, toOntologyEvidence } from './ontology-response-parser.js';

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

export type { ShardError } from './ontology-shard-collector.js';

const LLM_EXTRACTION_BATCH_SIZE = 8;
const LLM_EXTRACTION_MAX_ATTEMPTS = 3;
/** Agent SDK 最大连续失败次数，超过则熔断跳过剩余分片 */
const LLM_EXTRACTION_MAX_CONSECUTIVE_FAILURES = 3;

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
