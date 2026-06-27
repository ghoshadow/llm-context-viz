import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAutoCalibrationStartBody,
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
