import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defaultCalibrationPrompt,
  defaultCalibrationTarget,
  buildCalibrationProxyArgs,
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

test('defaults calibration prompt by source', () => {
  assert.equal(defaultCalibrationPrompt('claude'), 'say hi');
  assert.equal(defaultCalibrationPrompt('codex'), 'Calibration probe: reply with "ok".');
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
