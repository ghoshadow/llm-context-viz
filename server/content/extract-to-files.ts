/**
 * extract-to-files.ts
 *
 * 从 JSONL 会话转录中提取自然语言内容，按轮次与字符预算分组后写入持久化文件树。
 *
 * 文件树结构：
 *   data/extractions/<session_id>/
 *     ├── manifest.json
 *     ├── shard_000_turns_1-30.md
 *     ├── shard_001_turns_31-60.md
 *     └── ...
 *
 * 每个 .md 文件包含用户消息、助手回复、推理摘要和工具摘要，
 * 与 extractContentWithTurns 的输出格式一致。
 */

import { extractContentWithTurns, type TurnContent } from './extract-session.js';
import { writeFileSync, readFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ESM 兼容：用 import.meta.url 推导 __dirname（避免 tsx 动态导入时 __dirname 不可用）
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── 类型定义 ────────────────────────────────────────────────────────────────

/** 单个分片文件的描述信息 */
export interface ShardFile {
  /** 零基分片序号 */
  index: number;
  /** 文件绝对路径 */
  path: string;
  /** 文件名，如 shard_000_turns_1-30.md */
  filename: string;
  /** 轮次范围字符串，如 "1-30" */
  turnRange: string;
  /** 该分片包含的轮次数 */
  turnCount: number;
  /** 起始轮次（1-based） */
  startTurn: number;
  /** 结束轮次（1-based，含） */
  endTurn: number;
}

/** 提取文件树的完整元信息清单 */
export interface ExtractionManifest {
  /** 会话 ID */
  sessionId: string;
  /** 提取时间戳 ISO 8601 */
  extractedAt: string;
  /** 会话总轮次数 */
  totalTurns: number;
  /** 分片文件数量 */
  shardCount: number;
  /** 各分片文件描述 */
  shards: ShardFile[];
  /** 文件树根目录绝对路径 */
  rootDir: string;
}

// ── 默认配置 ────────────────────────────────────────────────────────────────

const DEFAULT_SHARD_SIZE = 30;
const DEFAULT_MAX_SHARD_CHARS = 45_000;
const DEFAULT_BASE_DIR = resolve(join(__dirname, '..', '..', 'data', 'extractions'));

// ── 辅助函数 ────────────────────────────────────────────────────────────────

/**
 * 获取指定会话的提取输出目录。
 */
function getOutputDir(sessionId: string, baseDir: string): string {
  return join(baseDir, sessionId);
}

/**
 * 获取 manifest 文件路径。
 */
function getManifestPath(sessionId: string, baseDir: string): string {
  return join(getOutputDir(sessionId, baseDir), 'manifest.json');
}

/**
 * 生成分片文件名。
 * 例如：shardSize=30, index=0, startTurn=1, endTurn=30 → "shard_000_turns_1-30.md"
 */
function shardFilename(index: number, startTurn: number, endTurn: number): string {
  return `shard_${String(index).padStart(3, '0')}_turns_${startTurn}-${endTurn}.md`;
}

function groupTurnsIntoShards(
  turns: TurnContent[],
  maxTurns: number,
  maxChars: number,
  startIndex = 0,
): TurnContent[][] {
  const groups: TurnContent[][] = [];
  let current: TurnContent[] = [];
  let currentChars = 0;

  for (let i = startIndex; i < turns.length; i++) {
    const turn = turns[i]!;
    const nextChars = currentChars + turn.content.length;
    const shouldSplit =
      current.length > 0
      && (current.length >= maxTurns || nextChars > maxChars);

    if (shouldSplit) {
      groups.push(current);
      current = [];
      currentChars = 0;
    }

    current.push(turn);
    currentChars += turn.content.length;
  }

  if (current.length > 0) groups.push(current);
  return groups;
}

function writeShardGroup(
  outputDir: string,
  index: number,
  group: TurnContent[],
): ShardFile {
  const startTurn = group[0]!.turnNum;
  const endTurn = group[group.length - 1]!.turnNum;
  const filename = shardFilename(index, startTurn, endTurn);
  const filePath = join(outputDir, filename);
  const content = group.map((t) => t.content).join('\n');

  writeFileSync(filePath, content, 'utf-8');

  return {
    index,
    path: filePath,
    filename,
    turnRange: `${startTurn}-${endTurn}`,
    turnCount: group.length,
    startTurn,
    endTurn,
  };
}

// ── 导出函数 ────────────────────────────────────────────────────────────────

/**
 * 检查指定会话的提取文件树是否已存在。
 *
 * @returns 已存在则返回 Manifest，否则返回 null
 */
export function loadExistingManifest(
  sessionId: string,
  baseDir?: string,
): ExtractionManifest | null {
  const manifestPath = getManifestPath(sessionId, baseDir ?? DEFAULT_BASE_DIR);
  if (!existsSync(manifestPath)) return null;

  try {
    const raw = readFileSync(manifestPath, 'utf-8');
    return JSON.parse(raw) as ExtractionManifest;
  } catch {
    return null;
  }
}

/**
 * 读取单个分片文件的内容。
 */
export function readShardFile(filePath: string): string {
  return readFileSync(filePath, 'utf-8');
}

/**
 * 从 JSONL 原始内容中提取会话转录，按轮次分组后写入持久化文件树。
 *
 * 幂等设计：若目标目录已存在有效的 manifest.json 且 force 不为 true，
 * 则跳过写入，直接返回已有 manifest。
 *
 * @param rawJsonl  — 原始 JSONL 字符串
 * @param sessionId — 会话标识，用作目录名
 * @param options   — 可选配置
 * @returns 提取文件树的元信息清单
 */
export function extractToFiles(
  rawJsonl: string,
  sessionId: string,
  options?: {
    /** 每分片轮次数，默认 30 */
    shardSize?: number;
    /** 每分片最大字符数，默认 45000 */
    maxShardChars?: number;
    /** 输出根目录，默认 data/extractions */
    baseDir?: string;
    /** 是否强制覆盖已有文件，默认 false */
    force?: boolean;
  },
): ExtractionManifest {
  const shardSize = options?.shardSize ?? DEFAULT_SHARD_SIZE;
  const maxShardChars = options?.maxShardChars ?? DEFAULT_MAX_SHARD_CHARS;
  const baseDir = options?.baseDir ?? DEFAULT_BASE_DIR;
  const force = options?.force ?? false;

  // ── 幂等检查：已有 manifest 且非强制模式则直接返回 ──
  if (!force) {
    const existing = loadExistingManifest(sessionId, baseDir);
    if (existing) return existing;
  }

  // ── 解析 JSONL → 结构化轮次内容 ──
  const turns: TurnContent[] = extractContentWithTurns(rawJsonl);
  const totalTurns = turns.length;

  if (totalTurns === 0) {
    throw new Error('未从 JSONL 中提取到任何用户 turn 内容');
  }

  // ── 准备输出目录 ──
  const outputDir = getOutputDir(sessionId, baseDir);

  // 强制模式：先清空已有目录
  if (force && existsSync(outputDir)) {
    rmSync(outputDir, { recursive: true, force: true });
  }

  mkdirSync(outputDir, { recursive: true });

  // ── 按 shardSize + maxShardChars 混合预算顺序切分 ──
  const shards: ShardFile[] = [];
  const groups = groupTurnsIntoShards(turns, shardSize, maxShardChars);

  for (let i = 0; i < groups.length; i++) {
    shards.push(writeShardGroup(outputDir, i, groups[i]!));
  }

  // ── 写入 manifest.json ──
  const manifest: ExtractionManifest = {
    sessionId,
    extractedAt: new Date().toISOString(),
    totalTurns,
    shardCount: shards.length,
    shards,
    rootDir: outputDir,
  };

  const manifestPath = getManifestPath(sessionId, baseDir);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

  return manifest;
}

// ── 增量提取 ──────────────────────────────────────────────────────────────

/** 增量提取结果 */
export interface IncrementalResult {
  /** 更新后的完整 manifest */
  manifest: ExtractionManifest;
  /** 新增分片的索引列表（0-based） */
  newShardIndices: number[];
  /** 是否有新增轮次 */
  hasNewTurns: boolean;
}

/**
 * 增量提取：对比 JSONL 与已有文件树，只为新增轮次创建分片。
 *
 * 流程：
 *   1. 解析 JSONL → 获取当前轮次总数
 *   2. 加载已有 manifest
 *   3. 若 JSONL 轮次数 > manifest.totalTurns → 为新轮次创建分片
 *   4. 更新 manifest（追加新分片）
 *
 * @param rawJsonl  — 原始 JSONL 字符串
 * @param sessionId — 会话标识
 * @param options   — 可选配置
 * @returns 增量结果
 */
export function extractIncremental(
  rawJsonl: string,
  sessionId: string,
  options?: { shardSize?: number; maxShardChars?: number; baseDir?: string },
): IncrementalResult {
  const shardSize = options?.shardSize ?? DEFAULT_SHARD_SIZE;
  const maxShardChars = options?.maxShardChars ?? DEFAULT_MAX_SHARD_CHARS;
  const baseDir = options?.baseDir ?? DEFAULT_BASE_DIR;

  // 解析当前 JSONL
  const turns: TurnContent[] = extractContentWithTurns(rawJsonl);
  const currentTotalTurns = turns.length;

  if (currentTotalTurns === 0) {
    throw new Error('未从 JSONL 中提取到任何用户 turn 内容');
  }

  // 加载已有 manifest
  const existingManifest = loadExistingManifest(sessionId, baseDir);

  // 无已有 manifest → 全量提取
  if (!existingManifest) {
    const manifest = extractToFiles(rawJsonl, sessionId, { shardSize, maxShardChars, baseDir, force: true });
    const allIndices = manifest.shards.map((_, i) => i);
    return { manifest, newShardIndices: allIndices, hasNewTurns: true };
  }

  // 无新增轮次
  if (currentTotalTurns <= existingManifest.totalTurns) {
    return { manifest: existingManifest, newShardIndices: [], hasNewTurns: false };
  }

  const oldTotalTurns = existingManifest.totalTurns;
  const oldShardCount = existingManifest.shardCount;

  const outputDir = getOutputDir(sessionId, baseDir);
  const newShards: ShardFile[] = [];
  const groups = groupTurnsIntoShards(turns, shardSize, maxShardChars, oldTotalTurns);

  for (let i = 0; i < groups.length; i++) {
    newShards.push(writeShardGroup(outputDir, oldShardCount + i, groups[i]!));
  }

  // 合并 shards：已有分片中不包含的保留，新增或更新的替换
  const mergedShards = [...existingManifest.shards];
  const newShardIndices: number[] = [];

  for (const ns of newShards) {
    const existingIdx = mergedShards.findIndex((s) => s.index === ns.index);
    if (existingIdx >= 0) {
      mergedShards[existingIdx] = ns;
    } else {
      mergedShards.push(ns);
    }
    newShardIndices.push(ns.index);
  }

  mergedShards.sort((a, b) => a.index - b.index);

  // 更新 manifest
  const manifest: ExtractionManifest = {
    sessionId,
    extractedAt: new Date().toISOString(),
    totalTurns: currentTotalTurns,
    shardCount: mergedShards.length,
    shards: mergedShards,
    rootDir: outputDir,
  };

  const manifestPath = getManifestPath(sessionId, baseDir);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

  return { manifest, newShardIndices, hasNewTurns: true };
}
