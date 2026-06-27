import assert from 'node:assert/strict';
import test from 'node:test';
import { getCalibrationFailureNotice } from './calibrationFailureNotice';

test('turns project trace EACCES output into a permission command', () => {
  const notice = getCalibrationFailureNotice({
    cwd: '/Users/link/Documents/Anaconda/llm-context-viz',
    error: 'calibration proxy exited with code 1',
    output: [
      "[calibration-proxy] ERROR Project trace directory is not writable: /Users/link/Documents/Anaconda/llm-context-viz/.claude-trace (EACCES: permission denied, access '/Users/link/Documents/Anaconda/llm-context-viz/.claude-trace')",
    ],
  });

  assert.equal(notice?.title, '项目日志目录没有写入权限');
  assert.match(notice?.detail ?? '', /自动校准需要写入 .*\.claude-trace/);
  assert.equal(
    notice?.command,
    'sudo chown -R "$USER":staff \'/Users/link/Documents/Anaconda/llm-context-viz/.claude-trace\'',
  );
});

test('ignores non-permission calibration failures', () => {
  assert.equal(
    getCalibrationFailureNotice({
      cwd: '/repo',
      error: 'no target request captured',
      output: ['[calibration-proxy] CONNECT registry.npmjs.org:443'],
    }),
    null,
  );
});
