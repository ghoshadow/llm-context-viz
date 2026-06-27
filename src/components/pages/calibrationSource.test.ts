import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calibrationSourceFromSession,
  calibrationSourceLabel,
} from './calibrationSource';

test('uses current session source to lock calibration source', () => {
  assert.equal(calibrationSourceFromSession({ source: 'claude', model: 'gpt-5', filename: 'rollout-x.jsonl' }), 'claude');
  assert.equal(calibrationSourceFromSession({ source: 'codex', model: 'claude-sonnet-4', filename: 'x.jsonl' }), 'codex');
});

test('infers source from current session metadata when explicit source is missing', () => {
  assert.equal(calibrationSourceFromSession({ model: 'claude-sonnet-4', filename: 'rollout-x.jsonl' }), 'claude');
  assert.equal(calibrationSourceFromSession({ model: 'gpt-5.5', filename: 'session.jsonl' }), 'codex');
});

test('defaults to Claude when there is no selected session', () => {
  assert.equal(calibrationSourceFromSession(null), 'claude');
});

test('labels locked calibration source', () => {
  assert.equal(calibrationSourceLabel('claude'), 'Claude Code');
  assert.equal(calibrationSourceLabel('codex'), 'Codex');
});
