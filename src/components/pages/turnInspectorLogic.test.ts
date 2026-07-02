import assert from 'node:assert/strict';
import test from 'node:test';
import { isTaskName, parseJSON, segLabel } from './turnInspectorLogic';

test('parseJSON returns fallback for empty or invalid input', () => {
  assert.deepEqual(parseJSON(undefined, { ok: false }), { ok: false });
  assert.deepEqual(parseJSON('{bad', { ok: false }), { ok: false });
});

test('parseJSON parses valid JSON', () => {
  assert.deepEqual(parseJSON('{"ok":true}', { ok: false }), { ok: true });
});

test('labels timeline segment kinds', () => {
  assert.equal(segLabel('m', ''), '模型生成');
  assert.equal(segLabel('s', 'worker'), '子Agent · worker');
  assert.equal(segLabel('i', '等待'), '等待');
  assert.equal(segLabel('t', 'Read'), '工具 · Read');
});

test('detects task-like tool names', () => {
  assert.equal(isTaskName('Agent'), true);
  assert.equal(isTaskName('Workflow'), true);
  assert.equal(isTaskName('Read'), false);
});
