import assert from 'node:assert/strict';
import test from 'node:test';
import { extractContentWithTurns } from './extract-session';

function toJsonl(lines: unknown[]): string {
  return lines.map((line) => JSON.stringify(line)).join('\n');
}

test('extracts Codex JSONL into ontology turn content', () => {
  const rawJsonl = toJsonl([
    {
      timestamp: '2026-06-26T01:00:00.000Z',
      type: 'session_meta',
      payload: { session_id: 'sess_1', cwd: '/repo', cli_version: '0.99.0' },
    },
    {
      timestamp: '2026-06-26T01:00:01.000Z',
      type: 'event_msg',
      payload: { type: 'task_started', turn_id: 'turn_1', model_context_window: 258400 },
    },
    {
      timestamp: '2026-06-26T01:00:01.100Z',
      type: 'turn_context',
      payload: { turn_id: 'turn_1', cwd: '/repo', model: 'gpt-5.5' },
    },
    {
      timestamp: '2026-06-26T01:00:01.200Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: '实现 Codex 本体抽取' },
    },
    {
      timestamp: '2026-06-26T01:00:03.000Z',
      type: 'response_item',
      payload: { type: 'reasoning', id: 'rs_1', encrypted_content: 'encrypted' },
    },
    {
      timestamp: '2026-06-26T01:00:04.000Z',
      type: 'event_msg',
      payload: { type: 'agent_message', message: '我先定位内容抽取入口。' },
    },
    {
      timestamp: '2026-06-26T01:00:05.000Z',
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'exec_command',
        arguments: '{"cmd":"rg extractContentWithTurns server"}',
        call_id: 'call_1',
      },
    },
    {
      timestamp: '2026-06-26T01:00:06.000Z',
      type: 'response_item',
      payload: {
        type: 'function_call_output',
        call_id: 'call_1',
        output: 'server/content/extract-session.ts\nProcess exited with code 0',
      },
    },
    {
      timestamp: '2026-06-26T01:00:06.100Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          last_token_usage: {
            input_tokens: 12345,
            cached_input_tokens: 1000,
            output_tokens: 55,
            reasoning_output_tokens: 12,
          },
        },
      },
    },
    {
      timestamp: '2026-06-26T01:00:07.000Z',
      type: 'event_msg',
      payload: { type: 'task_complete', turn_id: 'turn_1', duration_ms: 6000 },
    },
  ]);

  const turns = extractContentWithTurns(rawJsonl);

  assert.equal(turns.length, 1);
  assert.equal(turns[0]!.turnNum, 1);
  assert.match(turns[0]!.content, /## 第 1 轮/);
  assert.match(turns[0]!.content, /### 用户输入\n实现 Codex 本体抽取/);
  assert.match(turns[0]!.content, /### 模型/);
  assert.match(turns[0]!.content, /\[REPLY\] 我先定位内容抽取入口。/);
  assert.match(turns[0]!.content, /\[REASONING_SUMMARY\][\s\S]*Codex 推理内容已加密/);
  assert.match(turns[0]!.content, /\[TOOL_SUMMARY\][\s\S]*exec_command/);
  assert.match(turns[0]!.content, /Process exited with code 0/);
});

test('keeps Claude JSONL ontology extraction unchanged', () => {
  const rawJsonl = toJsonl([
    { type: 'user', message: { role: 'user', content: 'Claude 侧用户问题' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Claude 侧模型回答' }] } },
  ]);

  const turns = extractContentWithTurns(rawJsonl);

  assert.equal(turns.length, 1);
  assert.match(turns[0]!.content, /Claude 侧用户问题/);
  assert.match(turns[0]!.content, /\[REPLY\] Claude 侧模型回答/);
});
