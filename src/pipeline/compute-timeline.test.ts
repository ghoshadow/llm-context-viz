import assert from 'node:assert/strict';
import test from 'node:test';
import { computeContext, computeTimeline, estimateTokens, identifyTurns, parseJsonl } from './index';

test('cumCacheHit uses the turn max cache hit independent of max total context', () => {
  const jsonl = [
    userLine('u1', '2026-01-01T00:00:00.000Z', 'check cache'),
    assistantLine('a1', '2026-01-01T00:00:01.000Z', 1_000, 50, 10),
    assistantLine('a2', '2026-01-01T00:00:02.000Z', 10, 900, 5),
  ].join('\n');

  const { lines } = parseJsonl(jsonl);
  const groups = identifyTurns(lines);
  const compositions = computeContext(groups, { estimate: estimateTokens });
  const [turn] = computeTimeline(groups, compositions);

  assert.equal(turn?.cumTotal, 1_050);
  assert.equal(turn?.cumCacheHit, 900);
  assert.equal(turn?.maxInput, 1_000);
  assert.equal(turn?.maxCacheHit, 50);
});

test('command promptId meta content stays in the command turn with cache usage', () => {
  const command = '<command-message>trellis-update-spec</command-message>\n<command-name>/trellis-update-spec</command-name>';
  const metaText = 'Base directory for this skill:\n# Update Code-Spec';
  const jsonl = [
    userLine('u1', '2026-01-01T00:00:00.000Z', command, 'p1'),
    userLine('u2', '2026-01-01T00:00:00.000Z', [{ type: 'text', text: metaText }], 'p1', true),
    assistantLine('a1', '2026-01-01T00:00:01.000Z', 100, 900, 10),
  ].join('\n');

  const { lines } = parseJsonl(jsonl);
  const groups = identifyTurns(lines);
  const compositions = computeContext(groups, { estimate: (text) => text.length });
  const [turn] = computeTimeline(groups, compositions);

  assert.equal(groups.length, 1);
  assert.ok((compositions[0]?.userMsgs ?? 0) >= command.length + metaText.length);
  assert.equal(turn?.prompt, command);
  assert.equal(turn?.asstReqs, 1);
  assert.equal(turn?.cumCacheHit, 900);
});

test('no-API command turns carry the previous cache hit with carried context', () => {
  const command = '<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args></command-args>';
  const jsonl = [
    userLine('u1', '2026-01-01T00:00:00.000Z', 'first prompt', 'p1'),
    assistantLine('a1', '2026-01-01T00:00:01.000Z', 100, 900, 10),
    userLine('u2', '2026-01-01T00:00:02.000Z', command, 'p2'),
  ].join('\n');

  const { lines } = parseJsonl(jsonl);
  const groups = identifyTurns(lines);
  const compositions = computeContext(groups, { estimate: estimateTokens });
  const turns = computeTimeline(groups, compositions);

  assert.equal(turns[1]?.prompt, command);
  assert.equal(turns[1]?.asstReqs, 0);
  assert.equal(turns[1]?.cumTotal, turns[0]?.cumTotal);
  assert.equal(turns[1]?.cumCacheHit, turns[0]?.cumCacheHit);
});

test('Claude context compression reset appears as a timeline step', () => {
  const jsonl = [
    userLine('u1', '2026-01-01T00:00:00.000Z', 'first prompt', 'p1'),
    assistantLine('a1', '2026-01-01T00:00:01.000Z', 1_000, 1_000, 10),
    userLine('u2', '2026-01-01T00:00:02.000Z', 'after compaction', 'p2'),
    assistantLine('a2', '2026-01-01T00:00:03.000Z', 100, 0, 10),
  ].join('\n');

  const { lines } = parseJsonl(jsonl);
  const groups = identifyTurns(lines);
  const compositions = computeContext(groups, { estimate: estimateTokens });
  const turns = computeTimeline(groups, compositions);

  assert.equal(turns[1]?.compressionReset, true);
  const compactedStep = turns[1]?.segs.find((seg) => seg.k === 'i' && seg.n === '上下文压缩');
  assert.ok(compactedStep);
  assert.match(compactedStep.det.text ?? '', /Claude Code/);
});

function userLine(
  uuid: string,
  timestamp: string,
  content: string | Array<{ type: 'text'; text: string }>,
  promptId?: string,
  isMeta?: boolean,
): string {
  return JSON.stringify({
    type: 'user',
    uuid,
    timestamp,
    sessionId: 's1',
    message: { role: 'user', content },
    ...(promptId ? { promptId } : {}),
    ...(isMeta === undefined ? {} : { isMeta }),
  });
}

function assistantLine(
  uuid: string,
  timestamp: string,
  inputTokens: number,
  cacheReadTokens: number,
  outputTokens: number,
): string {
  return JSON.stringify({
    type: 'assistant',
    uuid,
    timestamp,
    sessionId: 's1',
    message: {
      model: 'deepseek-v4-pro',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'ok' }],
      usage: {
        input_tokens: inputTokens,
        cache_read_input_tokens: cacheReadTokens,
        output_tokens: outputTokens,
      },
    },
  });
}
