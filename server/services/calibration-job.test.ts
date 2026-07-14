import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  defaultCalibrationPrompt,
  defaultCalibrationTarget,
  buildCalibrationProxyArgs,
  startCalibrationJob,
  summarizeCalibrationProxyExit,
} from './calibration-job';

test('summarizes calibration proxy ERROR output for failed jobs', () => {
  const error = summarizeCalibrationProxyExit(1, [
    "[calibration-proxy] ERROR Project trace directory is not writable: /repo/.claude-trace (EACCES: permission denied, access '/repo/.claude-trace')",
  ]);

  assert.match(error, /Project trace directory is not writable: \/repo\/\.claude-trace/);
  assert.match(error, /calibration proxy exited with code 1/);
});

test('falls back to exit code when proxy output has no explicit error', () => {
  assert.equal(
    summarizeCalibrationProxyExit(2, ['[calibration-proxy] CONNECT registry.npmjs.org:443']),
    'calibration proxy exited with code 2',
  );
});

test('summarizes child CLI stderr when proxy has no explicit ERROR line', () => {
  const summary = summarizeCalibrationProxyExit(1, [
    '[calibration-proxy] READY source=openclaw port=18443 mode=connect target=api.deepseek.com log=/repo/.openclaw-trace/api-log.jsonl',
    'Config invalid',
    'File: ~/.openclaw-autoclaw/openclaw.json',
    'Run: openclaw --profile autoclaw doctor --fix',
  ]);

  assert.match(summary, /Config invalid/);
  assert.match(summary, /openclaw --profile autoclaw doctor --fix/);
  assert.match(summary, /calibration proxy exited with code 1/);
});

test('defaults calibration prompt by source', () => {
  assert.equal(defaultCalibrationPrompt('claude'), 'say hi');
  assert.equal(defaultCalibrationPrompt('codex'), 'Calibration probe: reply with "ok".');
  assert.equal(defaultCalibrationPrompt('opencode'), 'Calibration probe: reply with "ok".');
  assert.equal(defaultCalibrationPrompt('pi'), 'Calibration probe: reply with "ok".');
  assert.equal(defaultCalibrationPrompt('openclaw'), 'Calibration probe: reply with "ok".');
});

test('defaults calibration target by source', () => {
  assert.equal(
    defaultCalibrationTarget('claude', () => 'https://api.openai.com/v1', () => 'http://127.0.0.1:15721'),
    'http://127.0.0.1:15721',
  );
  assert.equal(
    defaultCalibrationTarget('codex', () => 'http://127.0.0.1:9090', () => 'http://127.0.0.1:15721'),
    'http://127.0.0.1:9090',
  );
  assert.equal(
    defaultCalibrationTarget('pi', () => 'http://127.0.0.1:9090', () => 'http://127.0.0.1:15721'),
    'api.deepseek.com',
  );
});

test('builds Claude proxy args with backward-compatible defaults', () => {
  const args = buildCalibrationProxyArgs({
    source: 'claude',
    scriptPath: '/repo/scripts/calibration-proxy.cjs',
    cwd: '/work',
    targetHost: 'api.deepseek.com',
    port: 18000,
    timeoutMs: 45000,
    prompt: 'say hi',
  });

  assert.deepEqual(args, [
    '/repo/scripts/calibration-proxy.cjs',
    '--source', 'claude',
    '--cwd', '/work',
    '--target-host', 'api.deepseek.com',
    '--port', '18000',
    '--timeout-ms', '45000',
    '--',
    '-p', 'say hi',
  ]);
});

test('builds OpenCode proxy args with a plain probe prompt', () => {
  const args = buildCalibrationProxyArgs({
    source: 'opencode',
    scriptPath: '/repo/scripts/calibration-proxy.cjs',
    cwd: '/work',
    targetHost: 'api.deepseek.com',
    port: 18002,
    timeoutMs: 45000,
    prompt: 'Calibration probe: reply with "ok".',
  });

  assert.deepEqual(args, [
    '/repo/scripts/calibration-proxy.cjs',
    '--source', 'opencode',
    '--cwd', '/work',
    '--target-host', 'api.deepseek.com',
    '--port', '18002',
    '--timeout-ms', '45000',
    '--',
    'Calibration probe: reply with "ok".',
  ]);
});

test('builds Pi proxy args with a plain probe prompt', () => {
  const args = buildCalibrationProxyArgs({
    source: 'pi',
    scriptPath: '/repo/scripts/calibration-proxy.cjs',
    cwd: '/work',
    targetHost: 'api.deepseek.com',
    port: 18003,
    timeoutMs: 45000,
    prompt: 'Calibration probe: reply with "ok".',
  });

  assert.deepEqual(args, [
    '/repo/scripts/calibration-proxy.cjs',
    '--source', 'pi',
    '--cwd', '/work',
    '--target-host', 'api.deepseek.com',
    '--port', '18003',
    '--timeout-ms', '45000',
    '--',
    'Calibration probe: reply with "ok".',
  ]);
});

test('builds OpenClaw proxy args with a plain probe prompt', () => {
  const args = buildCalibrationProxyArgs({
    source: 'openclaw',
    scriptPath: '/repo/scripts/calibration-proxy.cjs',
    cwd: '/work',
    targetHost: 'api.deepseek.com',
    port: 18004,
    timeoutMs: 45000,
    prompt: 'Calibration probe: reply with "ok".',
  });

  assert.deepEqual(args, [
    '/repo/scripts/calibration-proxy.cjs',
    '--source', 'openclaw',
    '--cwd', '/work',
    '--target-host', 'api.deepseek.com',
    '--port', '18004',
    '--timeout-ms', '45000',
    '--',
    'Calibration probe: reply with "ok".',
  ]);
});

test('builds Codex proxy args using base-url capture mode', () => {
  const args = buildCalibrationProxyArgs({
    source: 'codex',
    scriptPath: '/repo/scripts/calibration-proxy.cjs',
    cwd: '/work',
    targetHost: 'http://127.0.0.1:9090',
    port: 18001,
    timeoutMs: 45000,
    prompt: 'Calibration probe: reply with "ok".',
  });

  assert.deepEqual(args, [
    '/repo/scripts/calibration-proxy.cjs',
    '--source', 'codex',
    '--cwd', '/work',
    '--target-host', 'http://127.0.0.1:9090',
    '--port', '18001',
    '--timeout-ms', '45000',
    '--',
    'Calibration probe: reply with "ok".',
  ]);
});
