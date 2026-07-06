import assert from 'node:assert/strict';
import test from 'node:test';
import { getSessionSource } from './sessionSource';

test('uses explicit imported session source when present', () => {
  assert.equal(getSessionSource({ source: 'codex', model: 'claude-sonnet-4', filename: 'x.jsonl' }), 'codex');
  assert.equal(getSessionSource({ source: 'claude', model: 'gpt-5.5', filename: 'rollout-x.jsonl' }), 'claude');
});

test('round-trips explicit future agent sources', () => {
  assert.equal(getSessionSource({ source: 'opencode', model: 'gpt-5.5', filename: 'x.jsonl' }), 'opencode');
  assert.equal(getSessionSource({ source: 'pi', model: 'gpt-5.5', filename: 'x.jsonl' }), 'pi');
  assert.equal(getSessionSource({ source: 'openclaw', model: 'gpt-5.5', filename: 'rollout-x.jsonl' }), 'openclaw');
});

test('infers imported session source from model and filename', () => {
  assert.equal(getSessionSource({ model: 'gpt-5.5', filename: 'session.jsonl' }), 'codex');
  assert.equal(getSessionSource({ model: 'codex', filename: 'session.jsonl' }), 'codex');
  assert.equal(getSessionSource({ model: 'claude-sonnet-4', filename: 'rollout-x.jsonl' }), 'claude');
  assert.equal(getSessionSource({ model: 'opencode', filename: 'session.jsonl' }), 'opencode');
  assert.equal(getSessionSource({ model: 'pi', filename: 'session.jsonl' }), 'pi');
  assert.equal(getSessionSource({ model: '', filename: 'rollout-2026-06-26T10-41-39.jsonl' }), 'codex');
  assert.equal(getSessionSource({ model: '', filename: 'plain-claude.jsonl' }), 'claude');
});
