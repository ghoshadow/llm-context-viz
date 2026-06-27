import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAutoCalibrationStartBody,
  captureTargetHelpText,
  defaultCalibrationPromptInput,
  defaultCalibrationTargetInput,
} from './calibrationAutoStart';

test('uses Claude UI defaults for the existing proxy workflow', () => {
  assert.equal(defaultCalibrationPromptInput('claude'), 'say hi');
  assert.equal(defaultCalibrationTargetInput('claude'), 'http://127.0.0.1:15721');
});

test('leaves Codex target empty so the server can read config.toml', () => {
  assert.equal(defaultCalibrationPromptInput('codex'), 'Calibration probe: reply with "ok".');
  assert.equal(defaultCalibrationTargetInput('codex'), '');
});

test('explains empty Codex capture target behavior', () => {
  assert.match(captureTargetHelpText('codex'), /留空/);
  assert.equal(captureTargetHelpText('codex').includes('~/.codex/config.toml'), true);
  assert.match(captureTargetHelpText('codex'), /覆盖/);
});

test('keeps Claude capture target help focused on proxy targets', () => {
  assert.match(captureTargetHelpText('claude'), /完整 Base URL/);
  assert.match(captureTargetHelpText('claude'), /裸 host/);
});

test('omits Codex targetHost when the input is empty', () => {
  assert.deepEqual(buildAutoCalibrationStartBody({
    source: 'codex',
    cwd: '/tmp/project',
    prompt: '',
    targetHost: '',
    timeoutMs: 45000,
  }), {
    source: 'codex',
    cwd: '/tmp/project',
    prompt: 'Calibration probe: reply with "ok".',
    timeoutMs: 45000,
  });
});

test('keeps explicit Codex targetHost overrides', () => {
  assert.deepEqual(buildAutoCalibrationStartBody({
    source: 'codex',
    cwd: '/tmp/project',
    prompt: 'probe',
    targetHost: 'http://127.0.0.1:9999',
    timeoutMs: 45000,
  }), {
    source: 'codex',
    cwd: '/tmp/project',
    prompt: 'probe',
    targetHost: 'http://127.0.0.1:9999',
    timeoutMs: 45000,
  });
});

test('keeps Claude targetHost fallback when the input is empty', () => {
  assert.deepEqual(buildAutoCalibrationStartBody({
    source: 'claude',
    cwd: '/tmp/project',
    prompt: '',
    targetHost: '',
    timeoutMs: 45000,
  }), {
    source: 'claude',
    cwd: '/tmp/project',
    prompt: 'say hi',
    targetHost: 'api.deepseek.com',
    timeoutMs: 45000,
  });
});
