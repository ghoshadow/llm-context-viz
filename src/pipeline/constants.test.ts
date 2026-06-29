/**
 * constants.test.ts — 管道常量测试
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveContextLimit, MODEL_CONTEXT_WINDOWS } from './constants';

// ── MODEL_CONTEXT_WINDOWS 静态数据检查 ─────────────────────────────────

test('MODEL_CONTEXT_WINDOWS 包含已知模型', () => {
  assert.ok('claude-sonnet' in MODEL_CONTEXT_WINDOWS);
  assert.ok('deepseek-v4' in MODEL_CONTEXT_WINDOWS);
  assert.ok('deepseek-v3' in MODEL_CONTEXT_WINDOWS);
});

test('MODEL_CONTEXT_WINDOWS 中所有值都是正整数', () => {
  for (const limit of Object.values(MODEL_CONTEXT_WINDOWS)) {
    assert.ok(typeof limit === 'number');
    assert.ok(Number.isInteger(limit));
    assert.ok(limit > 0);
  }
});

// ── resolveContextLimit 测试 ────────────────────────────────────────────

test('resolveContextLimit 精确匹配模型名', () => {
  assert.equal(resolveContextLimit('claude-sonnet'), 200_000);
  assert.equal(resolveContextLimit('claude-opus'), 200_000);
  assert.equal(resolveContextLimit('deepseek-v4'), 1_000_000);
  assert.equal(resolveContextLimit('deepseek-v3'), 128_000);
});

test('resolveContextLimit 子串匹配（大小写不敏感）', () => {
  assert.equal(resolveContextLimit('Claude-sonnet-20250219'), 200_000);
  assert.equal(resolveContextLimit('DeepSeek-V4-Pro'), 1_000_000); // toLowerCase + includes = true
  assert.equal(resolveContextLimit('deepseek-r1-some-variant'), 128_000);
});

test('resolveContextLimit 未匹配回退到 200000', () => {
  assert.equal(resolveContextLimit('unknown-model'), 200_000);
  assert.equal(resolveContextLimit('gpt-4'), 200_000);
  assert.equal(resolveContextLimit(''), 200_000);
});

test('resolveContextLimit haiku 和 sonnet 变体', () => {
  assert.equal(resolveContextLimit('claude-haiku-3.5'), 200_000);
  assert.equal(resolveContextLimit('Claude-Haiku'), 200_000);
});

test('resolveContextLimit deepseek-v4 包含 deepseek-v3 前缀时返回正确值', () => {
  // deepseek-v3 是 deepseek-v4 的子串，for...in 遍历顺序决定了谁先匹配
  // 实际逻辑是先检查包含 deepseek-v4 的，因为 Object.entries 按定义顺序
  // claude-sonnet, claude-opus, claude-haiku, deepseek-v4, deepseek-v4-pro, deepseek-v3, deepseek-r1
  assert.equal(resolveContextLimit('deepseek-v4-pro'), 1_000_000);
  // deepseek-v3 在后, 由于 'deepseek-v4-pro'.includes('deepseek-v3') 是 false，前三个 Claude 也没有，然后 'deepseek-v4-pro'.includes('deepseek-v4') 为 true
});
