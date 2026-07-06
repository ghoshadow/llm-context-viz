import assert from 'node:assert/strict';
import test from 'node:test';
import { detectSessionFormat } from './session-format';

function toJsonl(lines: unknown[]): string {
  return lines.map((line) => JSON.stringify(line)).join('\n');
}

test('detects supported JSONL session formats by source-specific shape', () => {
  assert.equal(detectSessionFormat(toJsonl([
    { type: 'user', uuid: 'u1', timestamp: '2026-07-06T00:00:00Z', message: { role: 'user', content: 'hello' } },
  ])), 'claude');

  assert.equal(detectSessionFormat(toJsonl([
    { type: 'session_meta', timestamp: '2026-07-06T00:00:00Z', payload: { cwd: '/repo' } },
  ])), 'codex');

  assert.equal(detectSessionFormat(toJsonl([
    {
      type: 'step_start',
      timestamp: 1767036059338,
      sessionID: 'ses_open',
      part: { id: 'prt_1', sessionID: 'ses_open', messageID: 'msg_1', type: 'step-start' },
    },
  ])), 'opencode');

  assert.equal(detectSessionFormat(toJsonl([
    { type: 'header', version: 3, workingDirectory: '/repo' },
    { type: 'message', id: 'msg_1', parentId: null, message: { role: 'user', content: [{ type: 'text', text: 'hello' }] } },
  ])), 'pi-session');

  assert.equal(detectSessionFormat(toJsonl([
    { type: 'session', id: 'pi_1', version: 3, timestamp: '2026-07-06T00:00:00Z', cwd: '/repo' },
    { type: 'turn_start' },
  ])), 'pi-event-stream');

  assert.equal(detectSessionFormat(toJsonl([
    { type: 'message', value: 'not a known agent format' },
  ])), 'unknown');
});
