import assert from 'node:assert/strict';
import test from 'node:test';
import { runOpenCodePipeline } from './opencode-jsonl';

function toJsonl(lines: unknown[]): string {
  return lines.map((line) => JSON.stringify(line)).join('\n');
}

const openCodeSample = toJsonl([
  {
    type: 'step_start',
    timestamp: 1767036059338,
    sessionID: 'ses_open',
    part: { id: 'prt_1', sessionID: 'ses_open', messageID: 'msg_1', type: 'step-start' },
  },
  {
    type: 'tool_use',
    timestamp: 1767036061199,
    sessionID: 'ses_open',
    part: {
      id: 'prt_2',
      sessionID: 'ses_open',
      messageID: 'msg_1',
      type: 'tool',
      callID: 'call_1',
      tool: 'bash',
      state: {
        status: 'completed',
        input: { command: 'echo hello' },
        output: 'hello\n',
        title: 'Print hello',
        metadata: { exit: 0 },
        time: { start: 1767036061123, end: 1767036061173 },
      },
    },
  },
  {
    type: 'text',
    timestamp: 1767036064268,
    sessionID: 'ses_open',
    part: {
      id: 'prt_3',
      sessionID: 'ses_open',
      messageID: 'msg_2',
      type: 'text',
      text: 'Done from OpenCode.',
      time: { start: 1767036064265, end: 1767036064265 },
    },
  },
  {
    type: 'step_finish',
    timestamp: 1767036064273,
    sessionID: 'ses_open',
    part: {
      id: 'prt_4',
      sessionID: 'ses_open',
      messageID: 'msg_2',
      type: 'step-finish',
      reason: 'stop',
      tokens: { input: 671, output: 8, reasoning: 1, cache: { read: 21, write: 0 } },
    },
  },
]);

test('parses OpenCode run --format json streams into turn inspector data', () => {
  const { summary, turns, errors } = runOpenCodePipeline(openCodeSample, 'opencode-run.jsonl');
  const turn = turns[0]!;

  assert.equal(errors.length, 0);
  assert.equal(summary.session.model, 'opencode');
  assert.equal(summary.session.version, 'ses_open');
  assert.equal(summary.session.requests, 1);
  assert.equal(summary.session.peakTokens, 671);
  assert.equal(summary.session.peakCacheHit, 21);
  assert.equal(summary.session.totalOutput, 8);
  assert.equal(turns.length, 1);
  assert.equal(turn.asstReqs, 1);
  assert.equal(turn.maxInput, 671);
  assert.equal(turn.cumTotal, 671);
  assert.equal(turn.outTok, 8);
  assert.equal(turn.tools.bash, 1);

  const callStep = turn.segs.find((seg) => seg.k === 'm' && seg.det.calls?.[0]?.name === 'bash');
  assert.match(callStep?.det.calls?.[0]?.input ?? '', /echo hello/);

  const toolStep = turn.segs.find((seg) => seg.k === 't' && seg.n === 'bash');
  assert.equal(toolStep?.det.result, 'hello\n');
  assert.equal(toolStep?.det.isError, false);
  assert.equal(toolStep?.ms, 50);

  const reply = turn.segs.find((seg) => seg.k === 'm' && seg.det.text);
  assert.equal(reply?.det.text, 'Done from OpenCode.');
});

test('keeps OpenCode error events visible without throwing', () => {
  const rawJsonl = toJsonl([
    { type: 'step_start', timestamp: 1767036059338, sessionID: 'ses_open', part: { type: 'step-start' } },
    {
      type: 'error',
      timestamp: 1767036065000,
      sessionID: 'ses_open',
      error: { name: 'APIError', data: { message: 'Rate limit exceeded', statusCode: 429 } },
    },
  ]);

  const { turns } = runOpenCodePipeline(rawJsonl, 'opencode-error.jsonl');
  const err = turns[0]!.segs.find((seg) => seg.k === 'i' && seg.n === 'OpenCode 错误');

  assert.match(err?.det.text ?? '', /Rate limit exceeded/);
});
