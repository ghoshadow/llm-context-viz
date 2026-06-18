/**
 * extract-ontology.ts
 *
 * 主编排器：从 JSONL 会话转录中自动提取上下文本体。
 *
 * 6 步流水线：
 *   1. Extract  — 调用 extractContentWithTurns 提取自然语言内容
 *   2. Shard    — 按配置将 turn 切分为重叠分片
 *   3. LLM      — 并行调用 LLM 对每个分片提取实体和关系
 *   4. Merge    — 合并多个分片的结果（去重、择优）
 *   5. Build    — 调用 buildOntology 构建最终图谱
 *   6. Return   — 返回成功结果或失败信息
 */

import { extractContentWithTurns, type TurnContent } from '../content/extract-session.js';
import { buildOntology, type OntologyBuildOutput } from '../../src/pipeline/build-ontology.js';
import type { CandidateEntity, SemanticRelation, OntologyBuildConfig } from '../../src/pipeline/build-ontology.js';
import { buildFullPrompt, buildCompactPrompt, type Meta } from './prompt.js';

// ── 动态导入 provider（避免 provider.ts 尚未创建时启动失败）─────────────────

interface ChatResult {
  text: string;
  usage: { input: number; output: number };
}

type ChatFn = (
  system: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  overrides?: { baseUrl?: string; apiKey?: string; model?: string },
) => Promise<ChatResult>;

let _chat: ChatFn | null = null;

async function getChat(): Promise<ChatFn> {
  if (_chat) return _chat;
  const mod = await import('./provider.js');
  _chat = mod.chat as ChatFn;
  return _chat;
}

// ── 类型定义 ────────────────────────────────────────────────────────────────

/** LLM 提取的原始结果（单个分片返回的 JSON） */
interface ShardResult {
  candidates: CandidateEntity[];
  relations: SemanticRelation[];
  config: OntologyBuildConfig;
}

/** 成功返回 */
export interface ExtractSuccess {
  success: true;
  buildOutput: OntologyBuildOutput;
  shardStats: { total: number; succeeded: number; failed: number };
}

/** 失败返回 */
export interface ExtractFailure {
  success: false;
  stage: 'content' | 'llm' | 'parse' | 'build' | 'store';
  message: string;
  detail?: string;
}

export type ExtractResult = ExtractSuccess | ExtractFailure;

// ── JSON 解析辅助（带三次回退）─────────────────────────────────────────────

function parseJsonFromResponse(text: string): ShardResult | null {
  // 1. 直接解析
  try {
    return JSON.parse(text) as ShardResult;
  } catch {
    // continue
  }

  // 2. 去掉 ```json ... ``` 包裹
  const jsonBlock = text.match(/```json\s*([\s\S]*?)```/);
  if (jsonBlock?.[1]) {
    try {
      return JSON.parse(jsonBlock[1]) as ShardResult;
    } catch {
      // continue
    }
  }

  // 3. 去掉任意 ``` 包裹
  const anyBlock = text.match(/```\s*([\s\S]*?)```/);
  if (anyBlock?.[1]) {
    try {
      return JSON.parse(anyBlock[1]) as ShardResult;
    } catch {
      // continue
    }
  }

  return null;
}

// ── 合并逻辑 ────────────────────────────────────────────────────────────────

function mergeResults(results: ShardResult[]): ShardResult {
  // ── 合并 candidates：按 id 去重，保留最高 conf ──
  const candidateMap = new Map<string, CandidateEntity>();

  for (const shard of results) {
    for (const c of shard.candidates) {
      const existing = candidateMap.get(c.id);
      if (!existing || c.conf > existing.conf) {
        // 保留最高 conf 条目，合并 turns 和 aliases
        if (existing) {
          candidateMap.set(c.id, {
            ...c,
            turns: [...new Set([...existing.turns, ...c.turns])].sort((a, b) => a - b),
            aliases: [...new Set([...(existing.aliases || []), ...(c.aliases || [])])],
            firstTurn: Math.min(existing.firstTurn, c.firstTurn),
          });
        } else {
          candidateMap.set(c.id, {
            ...c,
            turns: [...c.turns].sort((a, b) => a - b),
            aliases: [...(c.aliases || [])],
          });
        }
      } else {
        // 保留最高 conf 的 snippet
        const mergeC = {
          ...existing,
          turns: [...new Set([...existing.turns, ...c.turns])].sort((a, b) => a - b),
          aliases: [...new Set([...(existing.aliases || []), ...(c.aliases || [])])],
          firstTurn: Math.min(existing.firstTurn, c.firstTurn),
        };
        candidateMap.set(c.id, mergeC);
      }
    }
  }

  // ── 合并 relations：按 [s,t,label].sort().join('::') 去重，保留最高 conf ──
  const relationMap = new Map<string, SemanticRelation>();

  for (const shard of results) {
    for (const r of shard.relations) {
      const key = [r.s, r.t, r.label].sort().join('::');
      const existing = relationMap.get(key);
      if (!existing || r.conf > existing.conf) {
        relationMap.set(key, {
          ...r,
          firstTurn: existing ? Math.min(existing.firstTurn, r.firstTurn) : r.firstTurn,
        });
      } else {
        relationMap.set(key, {
          ...existing,
          firstTurn: Math.min(existing.firstTurn, r.firstTurn),
        });
      }
    }
  }

  // ── 合并 config：浅合并，冲突时后面的赢 ──
  const mergedConfig: OntologyBuildConfig = {};
  for (const shard of results) {
    if (shard.config) {
      Object.assign(mergedConfig, shard.config);
      // reclassify 特殊处理：浅合并各分片
      if (shard.config.reclassify) {
        mergedConfig.reclassify = {
          ...(mergedConfig.reclassify || {}),
          ...shard.config.reclassify,
        };
      }
    }
  }

  return {
    candidates: Array.from(candidateMap.values()),
    relations: Array.from(relationMap.values()),
    config: mergedConfig,
  };
}

// ── 分片构建 ────────────────────────────────────────────────────────────────

interface Shard {
  index: number;
  content: string;
  turnRange: string;
  turnCount: number;
}

function buildShards(
  turns: TurnContent[],
  totalTurns: number,
  shardSize: number,
  overlap: number,
  maxShards: number,
): Shard[] {
  const effectiveSize = shardSize - overlap;
  const numShards = Math.min(maxShards, Math.max(1, Math.ceil((totalTurns - overlap) / effectiveSize)));

  const shards: Shard[] = [];

  for (let i = 0; i < numShards; i++) {
    const startTurn = i * effectiveSize + 1;
    const endTurn = Math.min(startTurn + shardSize - 1, totalTurns);

    const selected = turns.filter((t) => t.turnNum >= startTurn && t.turnNum <= endTurn);
    const content = selected.map((t) => t.content).join('');

    shards.push({
      index: i,
      content,
      turnRange: `${startTurn}-${endTurn}`,
      turnCount: selected.length,
    });
  }

  return shards;
}

// ── 单个分片的 LLM 提取 ────────────────────────────────────────────────────

interface ShardLLMResult {
  shardIndex: number;
  result: ShardResult | null;
  error?: string;
}

async function processShard(
  shard: Shard,
  numShards: number,
  sessionId: string,
  chat: ChatFn,
): Promise<ShardLLMResult> {
  const meta: Meta = {
    sessionId,
    partN: shard.index + 1,
    totalParts: numShards,
    turnRange: shard.turnRange,
    turnCount: shard.turnCount,
  };

  const systemPrompt = '你是一个精确的会话分析工具。请严格按照要求输出 JSON，不添加任何解释或包装。';
  const userPrompt =
    shard.index === 0
      ? buildFullPrompt(shard.content, meta)
      : buildCompactPrompt(shard.content, meta);

  let lastError: string | undefined;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
        { role: 'user', content: userPrompt },
      ];

      // 重试时追加纠正提示
      if (attempt > 0) {
        messages.splice(0, 0, { role: 'assistant', content: lastError! });
        messages.push({
          role: 'user',
          content:
            '上次返回格式不正确。Please output pure JSON without markdown wrapping. 请直接输出 JSON 对象，不要用 ``` 包裹。',
        });
      }

      const response = await chat(systemPrompt, messages);
      const parsed = parseJsonFromResponse(response.text);

      if (parsed) {
        return { shardIndex: shard.index, result: parsed };
      }

      lastError = response.text.substring(0, 500);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    shardIndex: shard.index,
    result: null,
    error: `分片 ${shard.index} 在 3 次尝试后仍无法解析: ${lastError?.substring(0, 200)}`,
  };
}

// ── 主入口 ──────────────────────────────────────────────────────────────────

/**
 * 从 JSONL 会话转录中自动提取上下文本体。
 *
 * @param rawJsonl  — 原始 JSONL 内容字符串
 * @param sessionId — 会话 ID（用于元信息）
 * @param onEvent   — SSE 事件回调 (event, data)
 * @param options   — 分片配置（可选）
 * @returns 成功返回 ExtractSuccess，失败返回 ExtractFailure
 */
export async function extractAndBuild(
  rawJsonl: string,
  sessionId: string,
  onEvent: (event: string, data: Record<string, unknown>) => void,
  options?: { shardSize?: number; overlap?: number; maxShards?: number },
): Promise<ExtractResult> {
  const shardSize = options?.shardSize ?? 50;
  const overlap = options?.overlap ?? 5;
  const maxShards = options?.maxShards ?? 20;

  // ── Step 1: Extract ──────────────────────────────────────────────────────
  const turns = extractContentWithTurns(rawJsonl);
  const totalTurns = turns.length;

  if (totalTurns === 0) {
    return {
      success: false,
      stage: 'content',
      message: '未从 JSONL 中提取到任何用户 turn 内容',
    };
  }

  // ── Step 2: Shard ────────────────────────────────────────────────────────
  const shards = buildShards(turns, totalTurns, shardSize, overlap, maxShards);
  const numShards = shards.length;

  onEvent('start', { shards: numShards, totalTurns });

  // ── Step 3: Parallel LLM ─────────────────────────────────────────────────
  let chat: ChatFn;
  try {
    chat = await getChat();
  } catch (err) {
    return {
      success: false,
      stage: 'llm',
      message: '无法加载 LLM provider: ' + (err instanceof Error ? err.message : String(err)),
    };
  }

  const shardPromises = shards.map((shard) => processShard(shard, numShards, sessionId, chat));
  const shardResults = await Promise.all(shardPromises);

  let succeeded = 0;
  let failed = 0;

  for (const sr of shardResults) {
    if (sr.result) {
      succeeded++;
      onEvent('shard-done', {
        shardIndex: sr.shardIndex,
        candidates: sr.result.candidates,
        relations: sr.result.relations,
      });
    } else {
      failed++;
      onEvent('shard-error', {
        shardIndex: sr.shardIndex,
        error: sr.error,
      });
    }
  }

  // 全部分片 LLM 调用失败
  if (succeeded === 0) {
    return {
      success: false,
      stage: 'llm',
      message: `所有 ${numShards} 个分片的 LLM 调用均失败`,
      detail: shardResults.map((s) => s.error).join('; '),
    };
  }

  // 全部分片解析失败
  if (succeeded === 0 && failed > 0) {
    return {
      success: false,
      stage: 'parse',
      message: `所有 ${numShards} 个分片的 JSON 解析均失败`,
    };
  }

  // ── Step 4: Merge ────────────────────────────────────────────────────────
  const successfulResults = shardResults
    .filter((s): s is ShardLLMResult & { result: ShardResult } => s.result !== null)
    .map((s) => s.result);

  const merged = mergeResults(successfulResults);

  onEvent('merge', {
    candidates: merged.candidates,
    relations: merged.relations,
  });

  // ── Step 5: Build ────────────────────────────────────────────────────────
  onEvent('build', {});

  let buildOutput: OntologyBuildOutput;
  try {
    buildOutput = buildOntology({
      candidates: merged.candidates,
      relations: merged.relations,
      config: merged.config,
    });
  } catch (err) {
    return {
      success: false,
      stage: 'build',
      message: '本体构建失败: ' + (err instanceof Error ? err.message : String(err)),
    };
  }

  // ── Step 6: Return ───────────────────────────────────────────────────────
  return {
    success: true,
    buildOutput,
    shardStats: {
      total: numShards,
      succeeded,
      failed,
    },
  };
}
