import assert from 'node:assert/strict';
import test from 'node:test';
import { runPiPipeline } from './pi-jsonl';
import type { NormalizedCalibration } from './calibration-types';

function toJsonl(lines: unknown[]): string {
  return lines.map((line) => JSON.stringify(line)).join('\n');
}

function categoryTokens(summary: { categories: Array<{ key: string; tokens: number }> }, key: string): number {
  return summary.categories.find((category) => category.key === key)?.tokens ?? 0;
}

const piSessionSample = toJsonl([
  { type: 'header', version: 3, workingDirectory: '/repo/pi' },
  {
    type: 'message',
    id: 'u1',
    parentId: null,
    message: { role: 'user', content: [{ type: 'text', text: 'Pi main prompt' }], timestamp: 1709136000000 },
  },
  {
    type: 'message',
    id: 'a1',
    parentId: 'u1',
    message: { role: 'assistant', content: [{ type: 'text', text: 'Main answer' }], timestamp: 1709136001000 },
  },
  {
    type: 'message',
    id: 'branch_a',
    parentId: 'u1',
    message: { role: 'assistant', content: [{ type: 'text', text: 'Discarded branch answer' }], timestamp: 1709136001500 },
  },
  {
    type: 'message',
    id: 'tool1',
    parentId: 'a1',
    message: {
      role: 'toolResult',
      toolName: 'bash',
      toolCallId: 'tool_1',
      content: [{ type: 'text', text: 'tool ok' }],
      timestamp: 1709136002000,
    },
  },
  {
    type: 'compaction',
    id: 'cmp1',
    parentId: 'tool1',
    summary: 'Compressed context summary',
    tokensBefore: 50000,
    tokensAfter: 5000,
  },
]);

test('parses Pi session JSONL using only the current longest branch', () => {
  const { summary, turns, errors } = runPiPipeline(piSessionSample, 'pi-session.jsonl');
  const turn = turns[0]!;

  assert.equal(errors.length, 0);
  assert.equal(summary.session.model, 'pi');
  assert.equal(summary.session.cwd, '/repo/pi');
  assert.equal(summary.session.aiTitle, 'Pi main prompt');
  assert.equal(turns.length, 1);
  assert.equal(turn.prompt, 'Pi main prompt');
  assert.equal(turn.ts, '2024-02-28T16:00:00.000Z');
  assert.equal(turn.asstReqs, 1);
  assert.ok(turn.cumTotal > 0);
  assert.equal(turn.tools.bash, 1);
  assert.equal(turn.compressionReset, true);
  assert.equal(turn.segs.some((seg) => seg.det.text === 'Discarded branch answer'), false);

  const reply = turn.segs.find((seg) => seg.k === 'm' && seg.det.text);
  assert.equal(reply?.det.text, 'Main answer');

  const tool = turn.segs.find((seg) => seg.k === 't' && seg.n === 'bash');
  assert.equal(tool?.det.result, 'tool ok');

  const compaction = turn.segs.find((seg) => seg.k === 'i' && seg.n === '上下文压缩');
  assert.match(compaction?.det.text ?? '', /Compressed context summary/);
});

test('parses Pi local sessions that start with a session record', () => {
  const rawJsonl = toJsonl([
    { type: 'session', version: 3, id: 'pi_local', timestamp: '2026-07-06T03:46:26.390Z', cwd: '/repo/pi' },
    { type: 'model_change', id: 'model1', parentId: null, timestamp: '2026-07-06T03:47:02.824Z', modelId: 'deepseek-v4-pro' },
    {
      type: 'message',
      id: 'u1',
      parentId: 'model1',
      timestamp: '2026-07-06T03:47:14.135Z',
      message: { role: 'user', content: [{ type: 'text', text: 'Pi local prompt' }] },
    },
    {
      type: 'message',
      id: 'a1',
      parentId: 'u1',
      timestamp: '2026-07-06T03:47:18.314Z',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Pi local answer' }] },
    },
  ]);

  const { summary, turns } = runPiPipeline(rawJsonl, 'pi-local.jsonl');

  assert.equal(summary.session.version, 'pi_local');
  assert.equal(summary.session.cwd, '/repo/pi');
  assert.equal(turns.length, 1);
  assert.equal(turns[0]!.prompt, 'Pi local prompt');
  assert.equal(turns[0]!.segs.find((seg) => seg.k === 'm')?.det.text, 'Pi local answer');
});

test('parses Pi event streams without treating them as session JSONL', () => {
  const rawJsonl = toJsonl([
    { type: 'session', id: 'pi_stream', version: 3, timestamp: '2026-07-06T00:00:00Z', cwd: '/repo/pi' },
    { type: 'turn_start', timestamp: '2026-07-06T00:00:01Z' },
    { type: 'message_end', timestamp: '2026-07-06T00:00:02Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Stream answer' }] } },
    { type: 'tool_execution_start', timestamp: '2026-07-06T00:00:03Z', toolCallId: 'tool_1', toolName: 'bash', args: { command: 'pwd' } },
    { type: 'tool_execution_end', timestamp: '2026-07-06T00:00:04Z', toolCallId: 'tool_1', toolName: 'bash', result: { content: [{ type: 'text', text: '/repo/pi' }] }, isError: false },
    { type: 'turn_end', timestamp: '2026-07-06T00:00:05Z' },
  ]);

  const { summary, turns } = runPiPipeline(rawJsonl, 'pi-stream.jsonl');

  assert.equal(summary.session.version, 'pi_stream');
  assert.equal(turns.length, 1);
  assert.match(turns[0]!.segs.map((seg) => seg.det.text ?? seg.det.result ?? '').join('\n'), /Stream answer/);
  assert.equal(turns[0]!.tools.bash, 1);
});

test('uses final Pi message_end text without duplicating message_update chunks', () => {
  const rawJsonl = toJsonl([
    { type: 'session', id: 'pi_stream', version: 3, timestamp: '2026-07-06T00:00:00Z', cwd: '/repo/pi' },
    { type: 'turn_start', timestamp: '2026-07-06T00:00:01Z' },
    { type: 'message_update', timestamp: '2026-07-06T00:00:02Z', message: { role: 'assistant', content: [{ type: 'text', text: 'partial' }] } },
    { type: 'message_end', timestamp: '2026-07-06T00:00:03Z', message: { role: 'assistant', content: [{ type: 'text', text: 'final answer' }] } },
    { type: 'turn_end', timestamp: '2026-07-06T00:00:04Z' },
  ]);

  const { turns } = runPiPipeline(rawJsonl, 'pi-stream.jsonl');
  const replySegments = turns[0]!.segs.filter((seg) => seg.k === 'm' && seg.det.text);

  assert.equal(turns[0]!.asstReqs, 1);
  assert.equal(replySegments.length, 1);
  assert.equal(replySegments[0]!.det.text, 'final answer');
});

test('uses Pi calibration constants as missing core context fallback', () => {
  const calibration: NormalizedCalibration = {
    schemaVersion: 1,
    source: 'pi',
    categories: {
      sysPrompt: { chars: 40 },
      tool_defs: { chars: 60 },
      skills: { chars: 20 },
      mcp: { chars: 10 },
      reminders: { chars: 15 },
    },
  };

  const { summary, turns } = runPiPipeline(piSessionSample, 'pi-session.jsonl', calibration);

  assert.ok(categoryTokens(summary, 'sysPrompt') > 0);
  assert.ok(categoryTokens(summary, 'tool_defs') > 0);
  assert.ok(categoryTokens(summary, 'skills') > 0);
  assert.ok(categoryTokens(summary, 'mcp') > 0);
  assert.ok(categoryTokens(summary, 'reminders') > 0);
  assert.ok((turns[0]!.comp.sysPrompt ?? 0) > 0);
});
