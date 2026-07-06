import assert from 'node:assert/strict';
import test from 'node:test';
import { runOpenClawPipeline } from './openclaw-jsonl';

function toJsonl(lines: unknown[]): string {
  return lines.map((line) => JSON.stringify(line)).join('\n');
}

const openClawSample = toJsonl([
  {
    type: 'openclaw_session',
    sessionId: 'oc_session',
    sessionKey: 'agent:main:work',
    cwd: '/repo/openclaw',
    timestamp: 1767036059000,
  },
  {
    type: 'session_update',
    timestamp: 1767036060000,
    sessionId: 'oc_session',
    sessionKey: 'agent:main:work',
    runId: 'run_1',
    update: {
      sessionUpdate: 'user_message_chunk',
      content: { type: 'text', text: 'OpenClaw prompt' },
    },
  },
  {
    type: 'session_update',
    timestamp: 1767036061000,
    sessionId: 'oc_session',
    sessionKey: 'agent:main:work',
    runId: 'run_1',
    update: {
      sessionUpdate: 'tool_call',
      toolCallId: 'tool_1',
      title: 'Read file',
      kind: 'read',
      rawInput: { path: 'README.md' },
      status: 'in_progress',
    },
  },
  {
    type: 'session_update',
    timestamp: 1767036062000,
    sessionId: 'oc_session',
    sessionKey: 'agent:main:work',
    runId: 'run_1',
    update: {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tool_1',
      status: 'completed',
      rawOutput: 'file contents',
      content: [{ type: 'text', text: 'file contents' }],
    },
  },
  {
    type: 'session_update',
    timestamp: 1767036063000,
    sessionId: 'oc_session',
    sessionKey: 'agent:main:work',
    runId: 'run_1',
    update: {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'OpenClaw answer.' },
    },
  },
  {
    type: 'session_update',
    timestamp: 1767036064000,
    sessionId: 'oc_session',
    sessionKey: 'agent:main:work',
    runId: 'run_1',
    update: {
      sessionUpdate: 'usage_update',
      used: 1234,
      size: 200000,
    },
  },
]);

test('parses OpenClaw ACP JSONL streams into turn inspector data', () => {
  const { summary, turns, errors } = runOpenClawPipeline(openClawSample, 'openclaw.jsonl');
  const turn = turns[0]!;

  assert.equal(errors.length, 0);
  assert.equal(summary.session.model, 'openclaw');
  assert.equal(summary.session.version, 'oc_session');
  assert.equal(summary.session.cwd, '/repo/openclaw');
  assert.equal(summary.session.aiTitle, 'OpenClaw prompt');
  assert.equal(summary.session.requests, 1);
  assert.equal(summary.session.peakTokens, 1234);
  assert.equal(summary.session.contextLimit, 200000);
  assert.equal(turns.length, 1);
  assert.equal(turn.prompt, 'OpenClaw prompt');
  assert.equal(turn.asstReqs, 1);
  assert.equal(turn.maxInput, 1234);
  assert.equal(turn.cumTotal, 1234);
  assert.equal(turn.tools['Read file'], 1);

  const call = turn.segs.find((seg) => seg.k === 'm' && seg.det.calls?.[0]?.name === 'Read file');
  assert.match(call?.det.calls?.[0]?.input ?? '', /README\.md/);

  const tool = turn.segs.find((seg) => seg.k === 't' && seg.n === 'Read file');
  assert.match(tool?.det.input ?? '', /README\.md/);
  assert.equal(tool?.det.result, 'file contents');
  assert.equal(tool?.det.isError, false);

  const reply = turn.segs.find((seg) => seg.k === 'm' && seg.det.text);
  assert.equal(reply?.det.text, 'OpenClaw answer.');
});

test('groups multi-block OpenClaw user chunks with the same run into one turn', () => {
  const rawJsonl = toJsonl([
    { type: 'openclaw_session', sessionId: 'oc_session', sessionKey: 'agent:main', cwd: '/repo/openclaw' },
    {
      type: 'session_update',
      timestamp: '2026-07-06T00:00:00.000Z',
      sessionId: 'oc_session',
      runId: 'run_1',
      update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'First block' } },
    },
    {
      type: 'session_update',
      timestamp: '2026-07-06T00:00:00.010Z',
      sessionId: 'oc_session',
      runId: 'run_1',
      update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'Second block' } },
    },
    {
      type: 'session_update',
      timestamp: '2026-07-06T00:00:01.000Z',
      sessionId: 'oc_session',
      runId: 'run_1',
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'One answer' } },
    },
  ]);

  const { turns } = runOpenClawPipeline(rawJsonl, 'openclaw.jsonl');

  assert.equal(turns.length, 1);
  assert.equal(turns[0]!.prompt, 'First block\nSecond block');
  assert.equal(turns[0]!.asstReqs, 1);
});
