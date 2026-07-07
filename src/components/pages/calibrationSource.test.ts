import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calibrationSourceAutoLaunchSupported,
  calibrationSourceFromSession,
  calibrationSourceLabel,
  calibrationTraceDirName,
} from './calibrationSource';

test('uses current session source to lock calibration source', () => {
  assert.equal(calibrationSourceFromSession({ source: 'claude', model: 'gpt-5', filename: 'rollout-x.jsonl' }), 'claude');
  assert.equal(calibrationSourceFromSession({ source: 'codex', model: 'claude-sonnet-4', filename: 'x.jsonl' }), 'codex');
  assert.equal(calibrationSourceFromSession({ source: 'opencode', model: 'gpt-5', filename: 'opencode.jsonl' }), 'opencode');
  assert.equal(calibrationSourceFromSession({ source: 'pi', model: 'gpt-5', filename: 'pi.jsonl' }), 'pi');
  assert.equal(calibrationSourceFromSession({ source: 'openclaw', model: 'gpt-5', filename: 'openclaw.jsonl' }), 'openclaw');
});

test('infers source from current session metadata when explicit source is missing', () => {
  assert.equal(calibrationSourceFromSession({ model: 'claude-sonnet-4', filename: 'rollout-x.jsonl' }), 'claude');
  assert.equal(calibrationSourceFromSession({ model: 'gpt-5.5', filename: 'session.jsonl' }), 'codex');
  assert.equal(calibrationSourceFromSession({ model: 'opencode', filename: 'session.jsonl' }), 'opencode');
  assert.equal(calibrationSourceFromSession({ model: 'pi', filename: 'session.jsonl' }), 'pi');
  assert.equal(calibrationSourceFromSession({ model: 'openclaw', filename: 'session.jsonl' }), 'openclaw');
});

test('defaults to Claude when there is no selected session', () => {
  assert.equal(calibrationSourceFromSession(null), 'claude');
});

test('labels locked calibration source', () => {
  assert.equal(calibrationSourceLabel('claude'), 'Claude Code');
  assert.equal(calibrationSourceLabel('codex'), 'Codex');
  assert.equal(calibrationSourceLabel('opencode'), 'OpenCode');
  assert.equal(calibrationSourceLabel('pi'), 'Pi');
  assert.equal(calibrationSourceLabel('openclaw'), 'OpenClaw');
});

test('uses source-specific calibration trace directory names', () => {
  assert.equal(calibrationTraceDirName('claude'), '.claude-trace/');
  assert.equal(calibrationTraceDirName('codex'), '.codex-trace/');
  assert.equal(calibrationTraceDirName('opencode'), '.opencode-trace/');
  assert.equal(calibrationTraceDirName('pi'), '.pi-trace/');
  assert.equal(calibrationTraceDirName('openclaw'), '.openclaw-trace/');
});

test('all calibration sources support automatic launch from the UI', () => {
  assert.equal(calibrationSourceAutoLaunchSupported('claude'), true);
  assert.equal(calibrationSourceAutoLaunchSupported('codex'), true);
  assert.equal(calibrationSourceAutoLaunchSupported('opencode'), true);
  assert.equal(calibrationSourceAutoLaunchSupported('pi'), true);
  assert.equal(calibrationSourceAutoLaunchSupported('openclaw'), true);
});
