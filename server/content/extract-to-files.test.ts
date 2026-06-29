/**
 * extract-to-files.test.ts — JSONL 提取写入文件树测试
 *
 * 覆盖：
 * - extractToFiles() 全量提取
 * - loadExistingManifest() 加载已有 manifest
 * - extractIncremental() 增量提取
 * - 幂等逻辑（force=false 跳过已存在）
 * - 边界条件（空 JSONL、非法 JSON、turns=0）
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  extractToFiles,
  loadExistingManifest,
  extractIncremental,
} from '../content/extract-to-files.js';

// ── 辅助：生成最小可用的 JSONL ──────────────────────────────────────────

/** 生成单轮最小 JSONL 内容（只包含用户消息 + 助手回复） */
function minimalJsonl(sessionId: string, turnCount = 2): string {
  const lines: string[] = [];

  // 系统消息
  lines.push(JSON.stringify({
    type: 'system',
    subtype: 'init',
    session_id: sessionId,
    cwd: '/tmp/test-project',
    ts: new Date().toISOString(),
    message: { model: 'claude-sonnet' },
  }));

  // N 轮：每轮 user + assistant
  for (let t = 1; t <= turnCount; t++) {
    lines.push(JSON.stringify({
      type: 'user',
      session_id: sessionId,
      message: {
        role: 'user',
        content: `第 ${t} 轮用户输入：这段会话讨论 Foo 框架的调试。`,
      },
    }));
    lines.push(JSON.stringify({
      type: 'assistant',
      session_id: sessionId,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: `第 ${t} 轮助手回复：分析 Foo 框架的竞态条件。` }],
      },
      parent_tool_use_id: null,
    }));
  }

  // 结果消息
  lines.push(JSON.stringify({
    type: 'result',
    subtype: 'success',
    session_id: sessionId,
    ts: new Date().toISOString(),
    message: {},
  }));

  return lines.join('\n');
}

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'extract-to-files-'));
  return dir;
}

// ── loadExistingManifest 测试 ────────────────────────────────────────────

test('loadExistingManifest 目录不存在时返回 null', async () => {
  const baseDir = join(makeTmpDir(), 'nonexistent');
  const result = await loadExistingManifest('session-x', baseDir);
  assert.equal(result, null);
});

test('loadExistingManifest 解析合法 manifest.json', async () => {
  const baseDir = makeTmpDir();
  try {
    const sessionDir = join(baseDir, 'session-1');
    mkdirSync(sessionDir, { recursive: true });
    const manifest = {
      sessionId: 'session-1',
      extractedAt: '2025-01-15T10:00:00.000Z',
      totalTurns: 30,
      shardCount: 1,
      shards: [{
        index: 0, path: join(sessionDir, 'shard_000_turns_1-30.md'),
        filename: 'shard_000_turns_1-30.md', turnRange: '1-30',
        turnCount: 30, startTurn: 1, endTurn: 30,
      }],
      rootDir: sessionDir,
    };
    writeFileSync(join(sessionDir, 'manifest.json'), JSON.stringify(manifest));

    const loaded = await loadExistingManifest('session-1', baseDir);
    assert.ok(loaded !== null);
    assert.equal(loaded!.sessionId, 'session-1');
    assert.equal(loaded!.totalTurns, 30);
    assert.equal(loaded!.shardCount, 1);
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
});

test('loadExistingManifest 非法 JSON 返回 null', async () => {
  const baseDir = makeTmpDir();
  try {
    const sessionDir = join(baseDir, 'session-invalid');
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, 'manifest.json'), '{not valid json');

    const result = await loadExistingManifest('session-invalid', baseDir);
    assert.equal(result, null);
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── extractToFiles 测试 ──────────────────────────────────────────────────

test('extractToFiles 从 JSONL 生成分片文件', async () => {
  const baseDir = makeTmpDir();
  try {
    const jsonl = minimalJsonl('session-e2f', 45);
    const manifest = await extractToFiles(jsonl, 'session-e2f', {
      shardSize: 30,
      maxShardChars: 45_000,
      baseDir,
      force: true,
    });

    assert.ok(manifest !== null);
    assert.equal(manifest.sessionId, 'session-e2f');
    assert.equal(manifest.totalTurns, 45); // 45 个 user turn
    assert.ok(manifest.shardCount >= 1);
    assert.equal(manifest.rootDir, join(baseDir, 'session-e2f'));
    assert.ok(manifest.shards[0]!.filename.endsWith('.md'));
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
});

test('extractToFiles 强制覆盖已有文件', async () => {
  const baseDir = makeTmpDir();
  try {
    const jsonl1 = minimalJsonl('session-f1', 2);
    await extractToFiles(jsonl1, 'session-f1', { baseDir, force: true, shardSize: 30, maxShardChars: 45_000 });

    // 第二次使用 force=true 应覆盖
    const manifest2 = await extractToFiles(jsonl1, 'session-f1', { baseDir, force: true, shardSize: 30, maxShardChars: 45_000 });
    assert.ok(manifest2 !== null);
    assert.equal(manifest2.totalTurns, 2);
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
});

test('extractToFiles 幂等：force=false 时复用已有 manifest', async () => {
  const baseDir = makeTmpDir();
  try {
    const jsonl = minimalJsonl('session-idempotent', 2);
    const m1 = await extractToFiles(jsonl, 'session-idempotent', { baseDir, force: true, shardSize: 30, maxShardChars: 45_000 });

    // 第二次 force=false 应返回同一个 manifest
    const m2 = await extractToFiles(jsonl, 'session-idempotent', { baseDir, force: false, shardSize: 30, maxShardChars: 45_000 });
    assert.equal(m2.extractedAt, m1.extractedAt, '幂等：应返回首次写入的时间戳');
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── extractIncremental 测试 ──────────────────────────────────────────────

test('extractIncremental 在无已有数据时执行全量提取', async () => {
  const baseDir = makeTmpDir();
  try {
    const jsonl = minimalJsonl('session-inc-1', 3);
    const result = await extractIncremental(jsonl, 'session-inc-1', { baseDir, shardSize: 30, maxShardChars: 45_000 });

    assert.ok(result.hasNewTurns, '应报告有新轮次');
    assert.equal(result.manifest.totalTurns, 3);
    // 全量提取：所有分片都标记为新增
    assert.equal(result.newShardIndices.length, result.manifest.shardCount);
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
});

test('extractIncremental 无新增轮次时返回原 manifest', async () => {
  const baseDir = makeTmpDir();
  try {
    const jsonl2 = minimalJsonl('session-inc-2', 2);
    await extractToFiles(jsonl2, 'session-inc-2', { baseDir, force: true, shardSize: 30, maxShardChars: 45_000 });

    // 再次增量提取相同 JSONL → 无新轮次
    const result = await extractIncremental(jsonl2, 'session-inc-2', { baseDir, shardSize: 30, maxShardChars: 45_000 });
    assert.equal(result.hasNewTurns, false, '应无新增轮次');
    assert.deepEqual(result.newShardIndices, [], '新增分片列表应为空');
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
});

test('extractIncremental 有新增轮次时追加分片', async () => {
  const baseDir = makeTmpDir();
  try {
    // 先写入 2 轮
    const jsonl2 = minimalJsonl('session-inc-3', 2);
    await extractToFiles(jsonl2, 'session-inc-3', { baseDir, force: true, shardSize: 30, maxShardChars: 45_000 });

    // 再增量提取 4 轮
    const jsonl4 = minimalJsonl('session-inc-3', 4);
    const result = await extractIncremental(jsonl4, 'session-inc-3', { baseDir, shardSize: 30, maxShardChars: 45_000 });

    assert.ok(result.hasNewTurns, '应有新增轮次');
    assert.equal(result.manifest.totalTurns, 4);
    assert.ok(result.newShardIndices.length > 0, '应有新增分片索引');
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── 边界条件 ─────────────────────────────────────────────────────────────

test('extractToFiles 空 JSONL 抛出异常', async () => {
  const baseDir = makeTmpDir();
  try {
    await assert.rejects(
      () => extractToFiles('', 'session-empty', { baseDir }),
      /未从 JSONL 中提取/,
      '空 JSONL 应抛出异常',
    );
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
});

test('extractIncremental 空 JSONL 抛出异常', async () => {
  const baseDir = makeTmpDir();
  try {
    await assert.rejects(
      () => extractIncremental('', 'session-empty', { baseDir }),
      /未从 JSONL 中提取/,
      '空 JSONL 应抛出异常',
    );
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
});

test('extractToFiles 使用默认选项值', async () => {
  const baseDir = makeTmpDir();
  try {
    const jsonl = minimalJsonl('session-defaults', 2);
    // 不提供 shardSize, maxShardChars, baseDir
    const manifest = await extractToFiles(jsonl, 'session-defaults');

    assert.ok(manifest !== null);
    assert.equal(manifest.sessionId, 'session-defaults');
    assert.equal(manifest.totalTurns, 2);
    assert.ok(manifest.shardCount >= 1);
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
});

test('extractToFiles 分片数随轮次增多而增加', async () => {
  const baseDir = makeTmpDir();
  try {
    // 使用较小的 shardSize=1，确保分片拆分
    const jsonl = minimalJsonl('session-many', 5);
    const manifest = await extractToFiles(jsonl, 'session-many', {
      baseDir, force: true, shardSize: 1, maxShardChars: 45_000,
    });

    assert.ok(manifest.shardCount >= 5, `shardSize=1 时 5 轮应至少产生 5 个分片，实际: ${manifest.shardCount}`);
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
});

test('extractToFiles 保留分片轮次元信息', async () => {
  const baseDir = makeTmpDir();
  try {
    const jsonl = minimalJsonl('session-meta', 3);
    const manifest = await extractToFiles(jsonl, 'session-meta', {
      baseDir, force: true, shardSize: 30, maxShardChars: 45_000,
    });

    for (const shard of manifest.shards) {
      assert.ok(shard.index >= 0, '分片应有 index');
      assert.ok(shard.filename.length > 0, '分片应有 filename');
      assert.ok(shard.turnRange.length > 0, '分片应有 turnRange');
      assert.ok(shard.turnCount > 0, '分片应有正数的 turnCount');
      assert.ok(shard.startTurn >= 1, 'startTurn 应从 1 开始');
      assert.ok(shard.endTurn >= shard.startTurn, 'endTurn 应 >= startTurn');
    }
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
});
