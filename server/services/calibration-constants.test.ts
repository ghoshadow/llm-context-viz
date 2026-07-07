import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_CALIBRATION_CONSTANTS,
  readCalibrationConstants,
  readClaudeMemoryConstants,
  readLatestCaptureConstants,
  readProjectConstants,
  resolveProjectConstantsPath,
  writeCalibrationConstants,
  writeProjectConstants,
} from './calibration-constants';

test('resolves constants path under source-specific project trace directory', () => {
  const project = mkdtempSync(join(tmpdir(), 'cal-constants-'));
  try {
    assert.equal(
      resolveProjectConstantsPath(project, 'claude'),
      join(project, '.claude-trace', 'system-constants.json'),
    );
    assert.equal(
      resolveProjectConstantsPath(project, 'codex'),
      join(project, '.codex-trace', 'codex-system-constants.json'),
    );
    assert.equal(
      resolveProjectConstantsPath(project, 'pi'),
      join(project, '.pi-trace', 'pi-system-constants.json'),
    );
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('reads Claude defaults when project constants are missing', () => {
  const project = mkdtempSync(join(tmpdir(), 'cal-constants-'));
  try {
    const current = readCalibrationConstants(project, 'claude');
    assert.equal(current.constantsSource, 'defaults');
    assert.equal(current.cwd, project);
    assert.equal(current.categories.sysPrompt?.chars, DEFAULT_CALIBRATION_CONSTANTS.SYS_PROMPT_FALLBACK_CHARS);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('reads split Claude memory constants from global and project files', () => {
  const home = mkdtempSync(join(tmpdir(), 'cal-home-'));
  const project = mkdtempSync(join(tmpdir(), 'cal-constants-'));
  try {
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(join(home, '.claude', 'CLAUDE.md'), 'global memory');
    mkdirSync(join(project, '.claude'), { recursive: true });
    writeFileSync(join(project, '.claude', 'CLAUDE.md'), 'project memory');

    const memory = readClaudeMemoryConstants(project, home);
    assert.equal(memory.categories.memoryGlobal?.chars, 'global memory'.length);
    assert.equal(memory.categories.memoryProject?.chars, 'project memory'.length);
    assert.equal(memory.details?.['claude.memory.global'], 'global memory');
    assert.equal(memory.details?.['claude.memory.project'], 'project memory');

    const current = readCalibrationConstants(project, 'claude', { homeDir: home });
    assert.equal(current.categories.memoryGlobal?.chars, 'global memory'.length);
    assert.equal(current.categories.memoryProject?.chars, 'project memory'.length);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
});

test('keeps stored Claude memory constants before filesystem fallback', () => {
  const home = mkdtempSync(join(tmpdir(), 'cal-home-'));
  const project = mkdtempSync(join(tmpdir(), 'cal-constants-'));
  try {
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(join(home, '.claude', 'CLAUDE.md'), 'changed global memory');
    mkdirSync(join(project, '.claude-trace'), { recursive: true });
    writeFileSync(join(project, '.claude-trace', 'system-constants.json'), JSON.stringify({
      schemaVersion: 1,
      source: 'claude',
      categories: {
        memoryGlobal: { chars: 6, detailKey: 'claude.memory.global' },
      },
      details: {
        'claude.memory.global': 'stored',
      },
    }, null, 2));

    const current = readCalibrationConstants(project, 'claude', { homeDir: home });
    assert.equal(current.categories.memoryGlobal?.chars, 6);
    assert.equal(current.details?.['claude.memory.global'], 'stored');
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
});

test('writes captured Claude memory constants before filesystem fallback', () => {
  const project = mkdtempSync(join(tmpdir(), 'cal-constants-'));
  try {
    mkdirSync(join(project, '.claude'), { recursive: true });
    writeFileSync(join(project, '.claude', 'CLAUDE.md'), 'filesystem project memory');

    const written = writeCalibrationConstants(project, {
      source: 'claude',
      summary: {
        categories: {
          memoryProject: { chars: 7, detailKey: 'claude.memory.project' },
        },
      },
      details: {
        'claude.memory.project': 'capture',
      },
    });

    assert.equal(written.categories.memoryProject?.chars, 7);
    assert.equal(written.details?.['claude.memory.project'], 'capture');
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('reads empty Codex defaults when project constants are missing', () => {
  const project = mkdtempSync(join(tmpdir(), 'cal-constants-'));
  try {
    const current = readCalibrationConstants(project, 'codex');
    assert.equal(current.constantsSource, 'defaults');
    assert.equal(current.source, 'codex');
    assert.equal(current.categories.tool_defs?.chars ?? 0, 0);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('reads OpenCode defaults separately from latest capture candidate', () => {
  const project = mkdtempSync(join(tmpdir(), 'cal-constants-'));
  try {
    mkdirSync(join(project, '.opencode-trace'), { recursive: true });
    const logPath = join(project, '.opencode-trace', 'api-log-2026-07-06-01-02-03.jsonl');
    writeFileSync(logPath, JSON.stringify({
      request: {
        method: 'POST',
        url: 'https://api.openai.com/v1/responses',
        headers: { 'user-agent': 'opencode/1.2.3' },
        body: {
          model: 'gpt-5.5',
          instructions: 'OpenCode system prompt',
          input: [{ role: 'developer', content: [{ text: '<skills_instructions>skills</skills_instructions>' }] }],
          tools: [{ type: 'function', name: 'bash' }],
        },
      },
      response: { body: 'data: {"response":{"usage":{"input_tokens":111}}}\n\n' },
    }) + '\n');

    const current = readCalibrationConstants(project, 'opencode');
    const candidate = readLatestCaptureConstants(project, 'opencode');

    assert.equal(current.constantsSource, 'defaults');
    assert.equal(current.categories.sysPrompt?.chars ?? 0, 0);
    assert.equal(candidate?.constantsSource, 'capture');
    assert.equal(candidate?.rawLogPath, logPath);
    assert.equal(candidate?.categories.sysPrompt?.chars, 'OpenCode system prompt'.length);
    assert.equal(candidate?.categories.tool_defs?.chars, JSON.stringify([{ type: 'function', name: 'bash' }]).length);
    assert.equal(candidate?.usage?.firstRequestInputTokens, 111);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('reads Pi defaults separately from latest capture candidate', () => {
  const project = mkdtempSync(join(tmpdir(), 'cal-constants-'));
  try {
    mkdirSync(join(project, '.pi-trace'), { recursive: true });
    const logPath = join(project, '.pi-trace', 'api-log-2026-07-06-01-02-03.jsonl');
    writeFileSync(logPath, JSON.stringify({
      request: {
        method: 'POST',
        url: 'https://api.openai.com/v1/chat/completions',
        headers: { 'user-agent': 'pi/0.9.0' },
        body: {
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: 'Pi system prompt' },
            { role: 'developer', content: '<app-context>runtime</app-context>' },
          ],
          tools: [{ type: 'function', function: { name: 'read' } }],
        },
      },
      response: { body: { usage: { prompt_tokens: 222 } } },
    }) + '\n');

    const current = readCalibrationConstants(project, 'pi');
    const candidate = readLatestCaptureConstants(project, 'pi');

    assert.equal(current.constantsSource, 'defaults');
    assert.equal(current.categories.sysPrompt?.chars ?? 0, 0);
    assert.equal(candidate?.constantsSource, 'capture');
    assert.equal(candidate?.rawLogPath, logPath);
    assert.equal(candidate?.categories.sysPrompt?.chars, 'Pi system prompt'.length);
    assert.equal(candidate?.categories.reminders?.chars, '<app-context>runtime</app-context>'.length);
    assert.equal(candidate?.usage?.firstRequestInputTokens, 222);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('reads OpenClaw defaults separately from latest capture candidate', () => {
  const project = mkdtempSync(join(tmpdir(), 'cal-constants-'));
  try {
    mkdirSync(join(project, '.openclaw-trace'), { recursive: true });
    const logPath = join(project, '.openclaw-trace', 'api-log-2026-07-06-01-02-03.jsonl');
    writeFileSync(logPath, JSON.stringify({
      request: {
        method: 'POST',
        url: 'https://api.anthropic.com/v1/messages',
        headers: { 'user-agent': 'openclaw/5.0.0' },
        body: {
          model: 'claude-sonnet-4',
          system: [{ text: 'OpenClaw system prompt' }],
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
          tools: [{ name: 'grep', input_schema: { type: 'object' } }],
        },
      },
      response: { body: { usage: { input_tokens: 333 } } },
    }) + '\n');

    const current = readCalibrationConstants(project, 'openclaw');
    const candidate = readLatestCaptureConstants(project, 'openclaw');

    assert.equal(current.constantsSource, 'defaults');
    assert.equal(current.categories.sysPrompt?.chars ?? 0, 0);
    assert.equal(candidate?.source, 'openclaw');
    assert.equal(candidate?.constantsSource, 'capture');
    assert.equal(candidate?.rawLogPath, logPath);
    assert.equal(candidate?.categories.sysPrompt?.chars, 'OpenClaw system prompt'.length);
    assert.equal(candidate?.usage?.firstRequestInputTokens, 333);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('writes and reads normalized Codex constants', () => {
  const project = mkdtempSync(join(tmpdir(), 'cal-constants-'));
  try {
    const written = writeCalibrationConstants(project, {
      source: 'codex',
      cliVersion: '0.142.2',
      model: 'gpt-5.5',
      wireApi: 'responses',
      rawLogPath: join(project, '.codex-trace', 'codex-api-log.jsonl'),
      summary: {
        categories: {
          sysPrompt: { chars: 123, detailKey: 'codex.instructions' },
          tool_defs: { chars: 456, detailKey: 'codex.tools' },
          skills: { chars: 789, detailKey: 'codex.skills' },
        },
        toolNames: ['exec_command'],
        hashes: { instructions: 'abc' },
      },
      details: {
        'codex.instructions': '# instructions',
        'codex.tools': '# tools',
      },
    });

    assert.equal(written.source, 'codex');
    assert.equal(written.constantsSource, 'project');
    assert.equal(written.path, join(project, '.codex-trace', 'codex-system-constants.json'));

    const current = readCalibrationConstants(project, 'codex');
    assert.equal(current.categories.tool_defs?.chars, 456);
    assert.equal(current.toolNames?.[0], 'exec_command');
    assert.equal(current.details?.['codex.tools'], '# tools');
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('reads legacy Claude constants and exposes normalized plus legacy compatibility', () => {
  const project = mkdtempSync(join(tmpdir(), 'cal-constants-'));
  try {
    mkdirSync(join(project, '.claude-trace'), { recursive: true });
    writeFileSync(join(project, '.claude-trace', 'system-constants.json'), JSON.stringify({
      source: 'project',
      cwd: project,
      ccVersion: '2.1.170',
      model: 'deepseek-v4-pro',
      SYS_PROMPT_FALLBACK_CHARS: 11,
      TOOL_DEFS_FALLBACK_CHARS: 22,
      SYSTEM_REMINDER_CHROME_CHARS: 33,
      details: {
        SYS_PROMPT_FALLBACK_CHARS: '# sys',
      },
    }, null, 2));

    const current = readCalibrationConstants(project, 'claude');
    assert.equal(current.categories.sysPrompt?.chars, 11);
    assert.equal(current.categories.tool_defs?.chars, 22);
    assert.equal(current.categories.userMsgs?.chars, 33);
    assert.equal(current.details?.['claude.sysPrompt'], '# sys');

    const legacy = readProjectConstants(project);
    assert.equal(legacy.SYS_PROMPT_FALLBACK_CHARS, 11);
    assert.equal(legacy.TOOL_DEFS_FALLBACK_CHARS, 22);
    assert.equal(legacy.SYSTEM_REMINDER_CHROME_CHARS, 33);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('legacy writeProjectConstants writes normalized Claude constants', () => {
  const project = mkdtempSync(join(tmpdir(), 'cal-constants-'));
  try {
    const written = writeProjectConstants(project, {
      ccVersion: '2.1.170',
      model: 'deepseek-v4-pro',
      summary: {
        SYS_PROMPT_FALLBACK_CHARS: 101,
        TOOL_DEFS_FALLBACK_CHARS: 202,
        SYSTEM_REMINDER_CHROME_CHARS: 303,
      },
    });

    assert.equal(written.SYS_PROMPT_FALLBACK_CHARS, 101);
    const normalized = readCalibrationConstants(project, 'claude');
    assert.equal(normalized.categories.sysPrompt?.chars, 101);
    assert.equal(normalized.categories.userMsgs?.chars, 303);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
