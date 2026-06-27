import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COLORS, LABELS } from './theme';

test('labels normalized tool definition category in Chinese', () => {
  assert.equal(LABELS.tool_defs, '工具定义');
});

test('colors normalized tool definition category like legacy tools key', () => {
  assert.equal(COLORS.tool_defs, COLORS.tools);
});

test('labels Claude user message wrapper category in Chinese', () => {
  assert.equal(LABELS.userWrapper, '用户消息包装');
});

test('colors Claude user message wrapper separately from user messages', () => {
  assert.ok(COLORS.userWrapper);
  assert.notEqual(COLORS.userWrapper, COLORS.userMsgs);
});
