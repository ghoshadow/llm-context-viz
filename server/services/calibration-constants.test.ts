import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_CALIBRATION_CONSTANTS,
  readProjectConstants,
  resolveProjectConstantsPath,
  writeProjectConstants,
} from './calibration-constants';

test('resolves constants path under project .claude-trace', () => {
  const project = mkdtempSync(join(tmpdir(), 'cal-constants-'));
  try {
    assert.equal(
      resolveProjectConstantsPath(project),
      join(project, '.claude-trace', 'system-constants.json'),
    );
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('reads defaults when project constants are missing', () => {
  const project = mkdtempSync(join(tmpdir(), 'cal-constants-'));
  try {
    const current = readProjectConstants(project);
    assert.equal(current.source, 'defaults');
    assert.equal(current.cwd, project);
    assert.equal(current.SYS_PROMPT_FALLBACK_CHARS, DEFAULT_CALIBRATION_CONSTANTS.SYS_PROMPT_FALLBACK_CHARS);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('writes and reads project constants', () => {
  const project = mkdtempSync(join(tmpdir(), 'cal-constants-'));
  try {
    const written = writeProjectConstants(project, {
      ccVersion: '2.1.170',
      model: 'deepseek-v4-pro',
      summary: {
        SYS_PROMPT_FALLBACK_CHARS: 123,
        TOOL_DEFS_FALLBACK_CHARS: 456,
        SYSTEM_REMINDER_CHROME_CHARS: 789,
      },
      details: {
        SYS_PROMPT_FALLBACK_CHARS: '# sys',
        TOOL_DEFS_FALLBACK_CHARS: '# tools',
        SYSTEM_REMINDER_CHROME_CHARS: '# reminder',
      },
    });
    assert.equal(written.source, 'project');
    assert.equal(written.cwd, project);
    assert.equal(written.path, join(project, '.claude-trace', 'system-constants.json'));

    const current = readProjectConstants(project);
    assert.equal(current.source, 'project');
    assert.equal(current.SYS_PROMPT_FALLBACK_CHARS, 123);
    assert.equal(current.TOOL_DEFS_FALLBACK_CHARS, 456);
    assert.equal(current.SYSTEM_REMINDER_CHROME_CHARS, 789);
    assert.equal(current.details?.TOOL_DEFS_FALLBACK_CHARS, '# tools');
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
