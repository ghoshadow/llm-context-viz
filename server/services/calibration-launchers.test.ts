import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCalibrationProxyArgs } from './calibration-launchers';

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
