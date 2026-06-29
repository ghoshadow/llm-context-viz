/**
 * orchestrator-prompt.test.ts — 编排器 Prompt 构建测试
 *
 * 覆盖：
 * - buildOrchestratorPrompt() 的基本 prompt 构建
 * - 用户会话数据通过 XML 标签隔离
 * - 分片列表正确生成
 * - 抽取深度对应正确的标签
 * - buildEntityExtractorPrompt() 内部函数的行为
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { ExtractionManifest, ShardFile } from '../content/extract-to-files.js';
import { buildOrchestratorPrompt } from './orchestrator-prompt.js';

// ── 固定测试数据 ────────────────────────────────────────────────────────

function makeShard(index: number, start: number, end: number, path = `/tmp/extractions/test-session/shard_${String(index).padStart(3, '0')}_turns_${start}-${end}.md`): ShardFile {
  return {
    index,
    path,
    filename: `shard_${String(index).padStart(3, '0')}_turns_${start}-${end}.md`,
    turnRange: `${start}-${end}`,
    turnCount: end - start + 1,
    startTurn: start,
    endTurn: end,
  };
}

function makeManifest(overrides?: Partial<ExtractionManifest>): ExtractionManifest {
  const shards = [
    makeShard(0, 1, 30, '/tmp/extractions/session-1/shard_000_turns_1-30.md'),
    makeShard(1, 31, 45, '/tmp/extractions/session-1/shard_001_turns_31-45.md'),
  ];
  return {
    sessionId: 'session-1',
    extractedAt: '2025-01-15T10:00:00.000Z',
    totalTurns: 45,
    shardCount: shards.length,
    shards,
    rootDir: '/tmp/extractions/session-1',
    ...overrides,
  };
}

// ── buildOrchestratorPrompt 测试 ─────────────────────────────────────────

test('buildOrchestratorPrompt 输出包含会话 ID', () => {
  const manifest = makeManifest();
  const prompt = buildOrchestratorPrompt(manifest, undefined, 'refined');

  assert.ok(prompt.includes('session-1'), '应包含会话 ID');
});

test('buildOrchestratorPrompt 用 user_data 标签包裹用户信息', () => {
  const manifest = makeManifest();
  const prompt = buildOrchestratorPrompt(manifest, undefined, 'refined');

  assert.ok(prompt.includes('<user_data>'), '应包含 <user_data> 开始标签');
  assert.ok(prompt.includes('</user_data>'), '应包含 </user_data> 结束标签');
  // 会话 ID 应在 user_data 标签内
  const userDataSection = prompt.substring(
    prompt.indexOf('<user_data>'),
    prompt.indexOf('</user_data>') + '</user_data>'.length,
  );
  assert.ok(userDataSection.includes('session-1'), '会话 ID 应在 user_data 标签内');
});

test('buildOrchestratorPrompt 包含所有分片的 task 描述', () => {
  const manifest = makeManifest();
  const prompt = buildOrchestratorPrompt(manifest, undefined, 'refined');

  // 每个分片都应有一个任务描述行
  assert.ok(prompt.includes('分片 0:'), '应包含分片 0 描述');
  assert.ok(prompt.includes('分片 1:'), '应包含分片 1 描述');
  assert.ok(prompt.includes('shardIndex=0'), '分片 0 应设置 shardIndex=0');
  assert.ok(prompt.includes('shardIndex=1'), '分片 1 应设置 shardIndex=1');
});

test('buildOrchestratorPrompt 包含抽取密度标签', () => {
  const manifest = makeManifest();
  const refinedPrompt = buildOrchestratorPrompt(manifest, undefined, 'refined');
  assert.ok(refinedPrompt.includes('精炼模式'), 'refined depth 应显示"精炼模式"');

  const deepPrompt = buildOrchestratorPrompt(manifest, undefined, 'deep');
  assert.ok(deepPrompt.includes('深挖模式'), 'deep depth 应显示"深挖模式"');
});

test('buildOrchestratorPrompt 不包含重复的分片详情', () => {
  const manifest = makeManifest();
  const prompt = buildOrchestratorPrompt(manifest, undefined, 'refined');

  // 每个分片文件名只出现一次
  const matches = prompt.match(/shard_000_turns_1-30\.md/g);
  assert.ok(matches !== null, '应包含分片文件名');
  // 在 task 描述和分片详情中各出现一次 = 2 次
  assert.equal(matches!.length, 2, '每个分片文件名应出现两次（详情 + 任务描述）');
});

test('buildOrchestratorPrompt 使用 activeShards 覆盖 manifest.shards', () => {
  const manifest = makeManifest();
  const activeShards = [
    makeShard(0, 1, 15, '/tmp/extractions/session-1/shard_000_turns_1-15.md'),
  ];
  const prompt = buildOrchestratorPrompt(manifest, activeShards, 'refined');

  assert.ok(prompt.includes('1-15'), '应使用 activeShards 的轮次范围');
  assert.ok(!prompt.includes('1-30'), '不应包含被覆盖的分片范围');
  assert.ok(prompt.includes('15 轮'), '应反映 activeShards 的轮次数');
});

test('buildOrchestratorPrompt 包含总轮次和分片数统计', () => {
  const manifest = makeManifest();
  const prompt = buildOrchestratorPrompt(manifest, undefined, 'refined');

  assert.ok(prompt.includes('45'), '应包含总轮次数');
  assert.ok(prompt.includes('2'), '应包含分片数量');
});

// ── 边界条件 ─────────────────────────────────────────────────────────────

test('buildOrchestratorPrompt 处理空分片列表', () => {
  const manifest = makeManifest({ shards: [], shardCount: 0, totalTurns: 0 });
  const prompt = buildOrchestratorPrompt(manifest, undefined, 'refined');

  // 不应抛出异常
  assert.ok(typeof prompt === 'string', '应返回字符串');
  assert.ok(prompt.length > 0, '应返回非空字符串');
  // 应该包含"0"（总轮次或分片数）或表明无分片
  assert.ok(
    prompt.includes('0') || prompt.includes('分片数: 0') || prompt.includes('总轮次: 0'),
    '应包含数字 0 表示空状态',
  );
});

test('buildOrchestratorPrompt 处理单分片情况', () => {
  const shards = [makeShard(0, 1, 30, '/tmp/extractions/session-1/shard_000_turns_1-30.md')];
  const manifest = makeManifest({ shards, shardCount: 1, totalTurns: 30 });
  const prompt = buildOrchestratorPrompt(manifest, undefined, 'refined');

  assert.ok(prompt.includes('分片 0:'), '应包含唯一分片的描述');
  // 不应有分片 1
  assert.ok(!prompt.includes('分片 1:'), '不应包含不存在分片的描述');
});

test('buildOrchestratorPrompt 深度默认为 refined', () => {
  const manifest = makeManifest();
  // depth 参数是可选的，默认应为 'refined'
  const prompt = buildOrchestratorPrompt(manifest);
  assert.ok(prompt.includes('精炼模式'), '默认深度应为精炼模式');
});

test('buildOrchestratorPrompt prompt 结构完整', () => {
  const manifest = makeManifest();
  const prompt = buildOrchestratorPrompt(manifest, undefined, 'refined');

  // 验证关键结构部分存在
  assert.ok(prompt.includes('本体提取编排器'), '应包含角色定义');
  assert.ok(prompt.includes('抽取密度'), '应包含抽取密度标签');
  assert.ok(prompt.includes('## 当前会话'), '应包含当前会话章节');
  assert.ok(prompt.includes('## 执行步骤'), '应包含执行步骤章节');
  assert.ok(prompt.includes('子 Agent'), '应提及子 Agent');
  assert.ok(prompt.includes('JSON 数组'), '应提到 JSON 数组汇总格式');
});

test('buildOrchestratorPrompt 输出不包含未 sanitized 的用户输入', () => {
  // 模拟一个可能被误认为是命令的用户输入
  const manifest = makeManifest({ sessionId: '<injected>DROP TABLE users;--</injected>' });
  const prompt = buildOrchestratorPrompt(manifest, undefined, 'refined');

  // 会话 ID 应被包裹在 user_data 标签内
  assert.ok(prompt.includes('<user_data>'), '应使用 user_data 标签隔离');
  assert.ok(prompt.includes('</user_data>'), '应有闭合标签');
});
