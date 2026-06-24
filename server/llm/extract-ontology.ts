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
import { extractToFiles, extractIncremental, type ExtractionManifest } from '../content/extract-to-files.js';
import { buildOntology, type OntologyBuildOutput } from '../../src/pipeline/build-ontology.js';
import type { CandidateEntity, SemanticRelation, OntologyBuildConfig } from '../../src/pipeline/build-ontology.js';
import { buildOrchestratorPrompt, entityExtractorDef } from './orchestrator-prompt.js';
import { SubmitExtractionSchema } from './schema.js';

// ── 类型 ──────────────────────────────────────────────────────────────────

interface ShardResult {
  shardIndex: number;
  phaseTheme?: string;
  candidates: CandidateEntity[];
  relations: SemanticRelation[];
  config?: OntologyBuildConfig;
}

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
          firstTurn: existing ? Math.min(existing.firstTurn, c.firstTurn) : c.firstTurn,
        });
      } else {
        candidateMap.set(c.id, {
          ...existing,
          turns: [...new Set([...existing.turns, ...c.turns])].sort((a, b) => a - b),
          aliases: [...new Set([...(existing.aliases || []), ...(c.aliases || [])])],
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
        relationMap.set(key, { ...r, firstTurn: existing ? Math.min(existing.firstTurn, r.firstTurn) : r.firstTurn });
      } else {
        relationMap.set(key, { ...existing, firstTurn: Math.min(existing.firstTurn, r.firstTurn) });
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

/** 计算客观置信度 */
function computeConf(node: { turns: number[]; snippet: string; label: string }, maxTurn: number, shardCount: number): number {
  const turnRatio = node.turns.length / Math.max(maxTurn, 1);
  const base = turnRatio * 0.5 + 0.3;
  const crossShardBonus = 1 + 0.15 * Math.min(shardCount - 1, 3);
  const hasKeyword = node.snippet.includes(node.label.substring(0, 2));
  const snippetMult = hasKeyword ? 1.0 : 0.8;
  return Math.min(0.95, Math.max(0.3, base * crossShardBonus * snippetMult));
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
  options?: { shardSize?: number; force?: boolean; incremental?: boolean },
): Promise<ExtractResult> {
  const shardSize = options?.shardSize ?? 30;
  const force = options?.force ?? false;
  const incremental = options?.incremental ?? false;

  // Step 1: Extract to file tree
  let manifest: ExtractionManifest;
  let processShardIndices: number[] | undefined; // 仅增量模式：需要 LLM 处理的分片

  try {
    if (incremental) {
      const incResult = extractIncremental(rawJsonl, sessionId, { shardSize });
      manifest = incResult.manifest;
      if (!incResult.hasNewTurns) {
        onEvent('extracted', {
          totalTurns: manifest.totalTurns, shardCount: manifest.shardCount, rootDir: manifest.rootDir,
          shards: manifest.shards.map((s) => ({ index: s.index, filename: s.filename, turnRange: s.turnRange, turnCount: s.turnCount })),
          incremental: true, newTurns: false,
        });
        return { success: true, buildOutput: null, shardStats: { total: 0, succeeded: 0, failed: 0 } };
      }
      processShardIndices = incResult.newShardIndices;
    } else {
      manifest = extractToFiles(rawJsonl, sessionId, { shardSize, force });
    }
  } catch (err) {
    return { success: false, stage: 'content', message: '内容提取失败: ' + (err instanceof Error ? err.message : String(err)) };
  }

  if (manifest.totalTurns === 0) {
    return { success: false, stage: 'content', message: '未从 JSONL 中提取到任何用户 turn 内容' };
  }

  const activeShards = processShardIndices
    ? manifest.shards.filter((s) => processShardIndices!.includes(s.index))
    : manifest.shards;

  onEvent('extracted', {
    totalTurns: manifest.totalTurns, shardCount: manifest.shardCount,
    activeShards: activeShards.length, incremental: incremental && processShardIndices != null,
    rootDir: manifest.rootDir,
    shards: manifest.shards.map((s) => ({ index: s.index, filename: s.filename, turnRange: s.turnRange, turnCount: s.turnCount })),
  });

  // Step 2: Agent SDK orchestration
  const model = process.env.LLM_MODEL || 'deepseek-v4-pro';
  const apiKey = process.env.LLM_API_KEY;
  const baseUrl = process.env.LLM_BASE_URL || 'https://api.deepseek.com/anthropic';

  if (!apiKey) {
    return { success: false, stage: 'llm', message: '未设置 LLM_API_KEY 环境变量' };
  }

  onEvent('start', { shards: activeShards.length, totalTurns: manifest.totalTurns });

  // 收集子 Agent 返回的 JSON 文本
  const shardTextResults: Map<number, string> = new Map();

  const abort = new AbortController();
  const expectedShards = activeShards.length;

  try {
    const q = query({
      prompt: '请开始提取。',
      options: {
        abortController: abort,
        systemPrompt: buildOrchestratorPrompt(manifest, activeShards),
        model,
        agents: { 'entity-extractor': entityExtractorDef },
        allowedTools: ['Read', 'Task'],
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        maxTurns: Math.max(activeShards.length + 5, 5),
        thinking: { type: 'disabled' as const },
        cwd: manifest.rootDir.replace(/\/data\/extractions\/.*$/, ''),
        env: { ...process.env, ANTHROPIC_API_KEY: apiKey, ANTHROPIC_BASE_URL: baseUrl } as Record<string, string>,
      },
    });

    for await (const msg of q) {
      const mtype = (msg as Record<string, unknown>).type as string;
      const msubtype = (msg as Record<string, unknown>).subtype as string || '';
      console.error('[msg]', mtype, msubtype);

      if (msg.type === 'system' && msubtype === 'init') {
        onEvent('agent-start', { sessionId: (msg as SDKMessage & { session_id: string }).session_id });
      }

      // 记录 assistant 内容
      if (msg.type === 'assistant') {
        const am = msg as SDKMessage & { type: 'assistant'; message?: { content?: unknown[] } };
        if (am.message?.content) {
          for (const block of am.message.content as Array<{ type: string; text?: string; name?: string }>) {
            if (block.type === 'text') console.error('  [asst text]', (block.text || '').substring(0, 120));
            if (block.type === 'tool_use') console.error('  [asst tool]', block.name);
          }
        }
      }

      // 检测 tool_result 中的子 Agent JSON 输出
      if (msg.type === 'user') {
        const um = msg as SDKMessage & { type: 'user'; message?: { role: string; content?: unknown[] } };
        const blocks = (um.message?.content && Array.isArray(um.message.content))
          ? um.message.content
          : (um.message?.content ? [um.message.content] : []);
        for (const block of blocks as Array<{ type: string; tool_use_id?: string; content?: unknown; text?: string; name?: string }>) {
          // 只处理 Agent 工具的 tool_result（子 Agent 完成），跳过 Read 等工具的 tool_result
          if (block.type === 'tool_result') {
            // 提取文本：content 可能是 string 或 [{type:'text', text:'...'}, ...]
            let text = '';
            if (typeof block.content === 'string') {
              text = block.content;
            } else if (Array.isArray(block.content)) {
              text = (block.content as Array<{ type: string; text?: string }>)
                .filter((c) => c.type === 'text' && c.text)
                .map((c) => c.text!)
                .join('\n');
            } else if (block.content && typeof block.content === 'object') {
              text = JSON.stringify(block.content);
            }
            if (!text) continue;

            console.error('  [tool_result]', text.substring(0, 200));
            const parsed = parseJsonFromText(text);
            if (parsed && typeof parsed === 'object') {
              const single = parsed as Record<string, unknown>;
              const parsedItems = Array.isArray(parsed)
                ? parsed
                : Array.isArray(single.results)
                  ? single.results
                  : [parsed];

              for (const item of parsedItems) {
                const validation = SubmitExtractionSchema.safeParse(item);
                if (validation.success) {
                  const r = validation.data;
                  shardTextResults.set(r.shardIndex, JSON.stringify(r));
                  console.error('  [parsed shard]', r.shardIndex, 'theme:', r.phaseTheme);
                  onEvent('shard-done', { shardIndex: r.shardIndex, phaseTheme: r.phaseTheme, candidates: r.candidates, relations: r.relations });
                } else {
                  const candidate = item as Record<string, unknown>;
                  const shardIndex = typeof candidate?.shardIndex === 'number' ? candidate.shardIndex : -1;
                  const error = formatValidationError(validation.error);
                  console.error('  [validation error]', shardIndex, error);
                  onEvent('shard-error', { shardIndex, error });
                }
              }
            }
          }
        }
      }

      // 收齐所有分片后主动中断 Agent SDK
      if (shardTextResults.size >= expectedShards) {
        console.error('[extract-ontology] All', expectedShards, 'shards collected, aborting Agent SDK...');
        abort.abort();
        break;
      }

      // 记录最终结果
      if (msg.type === 'result') {
        console.error('  [result]', JSON.stringify(msg).substring(0, 400));
      }
    }
  } catch (err) {
    // AbortError 是预期的，不算错误
    if (err instanceof Error && err.name === 'AbortError') {
      console.error('[extract-ontology] Agent SDK aborted (expected)');
    } else {
      console.error('[extract-ontology] Agent SDK error:', err);
    }
    onEvent('agent-error', { message: err instanceof Error ? err.message : String(err) });
  }

  // Step 3: Parse collected results
  const shardResults: ShardResult[] = [];
  const phaseThemes: Array<{ shardIndex: number; startTurn: number; theme: string }> = [];
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
        turns: c.turns.filter((t) => t >= shardStart && t <= shardEnd),
      }));
      shardResults.push({
        shardIndex: shardIdx,
        phaseTheme: theme,
        candidates: validatedCandidates,
        relations: r.relations,
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

  // 语义去重
  merged.candidates = dedupByLabel(merged.candidates);

  // 生成聚合
  const aggregates = buildAggregates(phaseThemes, manifest);

  // 为每个 entity 计算客观 conf、snippet 质量、聚合归属
  const aggTopicId = new Map<string, string>(); // 每个聚合只保留一个 topic
  const mergedTopicIds = new Set<string>();
  for (const c of merged.candidates) {
    c.rawConf = c.conf;
    c.conf = computeConf(c, manifest.totalTurns, shardResults.length);
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
    buildOutput = buildOntology({ candidates: merged.candidates, relations: merged.relations, config: { ...merged.config, pruneOrphans: false } });
  } catch (err) {
    return { success: false, stage: 'build', message: '本体构建失败: ' + (err instanceof Error ? err.message : String(err)) };
  }

  buildOutput.aggregates = aggregates;
  if (phaseThemes.length > 0) {
    buildOutput.phaseThemes = phaseThemes;
  }

  return {
    success: true,
    buildOutput,
    shardStats: { total: manifest.shardCount, succeeded: shardResults.length, failed: manifest.shardCount - shardResults.length },
  };
}
