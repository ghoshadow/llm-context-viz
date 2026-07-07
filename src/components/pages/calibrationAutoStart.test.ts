import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAutoCalibrationStartBody,
  captureTargetPlaceholderText,
  defaultCalibrationPromptInput,
  defaultCalibrationTargetInput,
} from './calibrationAutoStart';

test('leaves Claude target empty so the server can read settings.json', () => {
  assert.equal(defaultCalibrationPromptInput('claude'), 'say hi');
  assert.equal(defaultCalibrationTargetInput('claude'), '');
});

test('leaves Codex target empty so the server can read config.toml', () => {
  assert.equal(defaultCalibrationPromptInput('codex'), 'Calibration probe: reply with "ok".');
  assert.equal(defaultCalibrationTargetInput('codex'), '');
});

test('uses neutral auto-launch defaults for OpenCode, Pi, and OpenClaw', () => {
  for (const source of ['opencode', 'pi', 'openclaw'] as const) {
    assert.equal(defaultCalibrationPromptInput(source), 'Calibration probe: reply with "ok".');
    assert.equal(defaultCalibrationTargetInput(source), '');
    assert.equal(
      captureTargetPlaceholderText(source),
      '留空使用默认 API Host；填写可覆盖，如 api.deepseek.com',
    );
  }
});

test('uses concise Codex capture target placeholder', () => {
  assert.equal(
    captureTargetPlaceholderText('codex'),
    '留空读取 ~/.codex/config.toml；填写可覆盖 Base URL',
  );
});

test('uses concise Claude capture target placeholder', () => {
  assert.equal(
    captureTargetPlaceholderText('claude'),
    '留空读取 ~/.claude/settings.json；填写可覆盖 Base URL',
  );
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

test('omits Claude targetHost when the input is empty', () => {
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
    timeoutMs: 45000,
  });
});
