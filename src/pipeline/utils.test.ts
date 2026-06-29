/**
 * utils.test.ts — 管道工具函数测试
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  estimateTokens,
  estimateTokensModelAware,
  roundTokens,
  roundTokensModelAware,
  isSubAgentTool,
  isTaskTool,
  extractContentText,
  extractPromptText,
} from './utils';
import type { ContentBlock } from '../types/session';

// ── estimateTokens 测试 ─────────────────────────────────────────────────

test('estimateTokens 正确估算纯英文文本', () => {
  const tokens = estimateTokens('Hello world');
  assert.ok(tokens > 0);
  // chars=11 / 3.0 ≈ 3.67
  assert.ok(tokens < 5);
});

test('estimateTokens 正确估算纯中文文本', () => {
  const tokens = estimateTokens('你好世界');
  // chars=4 / 3.0 ≈ 1.33
  assert.ok(tokens < 3);
});

test('estimateTokens 空字符串返回 0', () => {
  assert.equal(estimateTokens(''), 0);
});

test('estimateTokens 长文本', () => {
  const text = 'hello '.repeat(30); // 180 chars
  assert.equal(estimateTokens(text), 180 / 3.0);
});

// ── estimateTokensModelAware 测试 ───────────────────────────────────────

test('estimateTokensModelAware 纯中文文本使用中文比率', () => {
  const cnText = '这是一段很长很长很长很长很长很长很长很长很长很长很长很长很长很长的中文文本';
  const tokens = estimateTokensModelAware(cnText);
  // 中文 chars-per-token = 1.67
  assert.equal(tokens, cnText.length / 1.67);
});

test('estimateTokensModelAware 纯英文文本使用英文比率', () => {
  const enText = 'This is a long English sentence for testing purposes';
  const tokens = estimateTokensModelAware(enText);
  // 英文 chars-per-token = 3.33
  assert.equal(tokens, enText.length / 3.33);
});

test('estimateTokensModelAware 空字符串回退 mixed', () => {
  const tokens = estimateTokensModelAware('');
  // mixed ratio = 3.0
  assert.equal(tokens, 0);
});

test('estimateTokensModelAware 代码文本', () => {
  // 包含大量符号：{}, (), =, ; 等
  const codeText = `function foo() {
  const x = {a: 1, b: 2};
  return x.a + x.b;
}`;
  const tokens = estimateTokensModelAware(codeText);
  // code chars-per-token = 2.5
  assert.equal(tokens, codeText.length / 2.5);
});

// ── roundTokens / roundTokensModelAware 测试 ─────────────────────────────

test('roundTokens 返回整数', () => {
  const result = roundTokens('Hello world and beyond');
  assert.ok(Number.isInteger(result));
  assert.ok(result > 0);
});

test('roundTokens 空字符串返回 0', () => {
  assert.equal(roundTokens(''), 0);
});

test('roundTokensModelAware 返回整数', () => {
  const result = roundTokensModelAware('中文文本测试');
  assert.ok(Number.isInteger(result));
  assert.ok(result > 0);
});

// ── isSubAgentTool 测试 ─────────────────────────────────────────────────

test('isSubAgentTool Agent 返回 true', () => {
  assert.equal(isSubAgentTool('Agent'), true);
});

test('isSubAgentTool Workflow 返回 true', () => {
  assert.equal(isSubAgentTool('Workflow'), true);
});

test('isSubAgentTool 其他工具返回 false', () => {
  assert.equal(isSubAgentTool('Read'), false);
  assert.equal(isSubAgentTool('Bash'), false);
  assert.equal(isSubAgentTool('TaskCreate'), false);
  assert.equal(isSubAgentTool(''), false);
});

test('isSubAgentTool 大小写敏感', () => {
  assert.equal(isSubAgentTool('agent'), false);
  assert.equal(isSubAgentTool('workflow'), false);
});

// ── isTaskTool 测试 ─────────────────────────────────────────────────────

test('isTaskTool Task 前缀方法返回 true', () => {
  assert.equal(isTaskTool('TaskCreate'), true);
  assert.equal(isTaskTool('TaskUpdate'), true);
  assert.equal(isTaskTool('TaskDelete'), true);
  assert.equal(isTaskTool('Task'), true); // 仅 "Task"
});

test('isTaskTool 非 Task 前缀返回 false', () => {
  assert.equal(isTaskTool('Agent'), false);
  assert.equal(isTaskTool('Read'), false);
  assert.equal(isTaskTool(''), false);
});

test('isTaskTool 小写 task 返回 false', () => {
  assert.equal(isTaskTool('taskCreate'), false);
});

// ── extractContentText 测试 ─────────────────────────────────────────────

test('extractContentText 普通字符串返回自身', () => {
  assert.equal(extractContentText('hello world'), 'hello world');
});

test('extractContentText 空字符串返回空字符串', () => {
  assert.equal(extractContentText(''), '');
});

test('extractContentText ContentBlock 数组提取文本', () => {
  const blocks: ContentBlock[] = [
    { type: 'text', text: 'Hello' },
    { type: 'text', text: ' World' },
  ];
  // BLOCK_WRAPPER_CHARS = 23，每个非 tool_result block 追加 23 个空格
  const expected = 'Hello' + ' '.repeat(23) + ' World' + ' '.repeat(23);
  assert.equal(extractContentText(blocks), expected);
});

test('extractContentText 跳过 image 类型的 block', () => {
  const blocks: ContentBlock[] = [
    { type: 'text', text: 'Hello' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } },
    { type: 'text', text: 'World' },
  ];
  const result = extractContentText(blocks);
  // image block 被跳过（只有 text 和 tool_result 被处理）
  assert.ok(result.startsWith('Hello'));
  assert.ok(result.includes('World'));
});

test('extractContentText 递归处理 tool_result 中的字符串 content', () => {
  const blocks: ContentBlock[] = [
    {
      type: 'tool_result',
      tool_use_id: 't1',
      content: 'result text',
    },
  ];
  // tool_result block 不追加 BLOCK_WRAPPER_CHARS
  const result = extractContentText(blocks);
  assert.equal(result, 'result text');
});

test('extractContentText 递归处理 tool_result 中的 ContentBlock[]', () => {
  const blocks: ContentBlock[] = [
    {
      type: 'tool_result',
      tool_use_id: 't1',
      content: [
        { type: 'text', text: 'nested' },
      ],
    },
  ];
  const result = extractContentText(blocks);
  assert.equal(result, 'nested' + ' '.repeat(23));
});

test('extractContentText 递归处理深度嵌套的 tool_result', () => {
  const blocks: ContentBlock[] = [
    {
      type: 'tool_result',
      tool_use_id: 't1',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 't2',
          content: 'deep result',
        },
      ],
    },
  ];
  const result = extractContentText(blocks);
  assert.equal(result, 'deep result');
});

// ── extractPromptText 测试 ──────────────────────────────────────────────

test('extractPromptText 普通字符串返回自身', () => {
  assert.equal(extractPromptText('hello'), 'hello');
});

test('extractPromptText 空字符串返回空字符串', () => {
  assert.equal(extractPromptText(''), '');
});

test('extractPromptText ContentBlock[] 仅提取 text 类型', () => {
  const blocks: ContentBlock[] = [
    { type: 'text', text: 'hello' },
    { type: 'text', text: 'world' },
  ];
  assert.equal(extractPromptText(blocks), 'hello\nworld');
});

test('extractPromptText 过滤 tool_result 和 image block', () => {
  const blocks: ContentBlock[] = [
    { type: 'text', text: 'prompt' },
    {
      type: 'tool_result',
      tool_use_id: 't1',
      content: 'result',
    },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } },
    { type: 'text', text: 'more' },
  ];
  assert.equal(extractPromptText(blocks), 'prompt\nmore');
});

test('extractPromptText 纯 tool_result 返回空字符串', () => {
  const blocks: ContentBlock[] = [
    {
      type: 'tool_result',
      tool_use_id: 't1',
      content: 'result',
    },
  ];
  assert.equal(extractPromptText(blocks), '');
});
