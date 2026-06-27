import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCalibrationCategoryRows,
  getNormalizedCalibrationSummary,
  sumCalibrationCategoryChars,
} from './calibrationCategories';

test('uses top-level normalized categories from auto job results', () => {
  const summary = getNormalizedCalibrationSummary({
    categories: {
      sysPrompt: { chars: 100, detailKey: 'codex.instructions' },
      tool_defs: { chars: 200, detailKey: 'codex.tools' },
    },
    usage: { firstRequestInputTokens: 1234 },
    toolNames: ['Read'],
  });

  assert.equal(summary.categories.sysPrompt?.chars, 100);
  assert.equal(summary.categories.tool_defs?.detailKey, 'codex.tools');
  assert.equal(summary.usage?.firstRequestInputTokens, 1234);
  assert.deepEqual(summary.toolNames, ['Read']);
});

test('uses nested summary categories from extractor results', () => {
  const summary = getNormalizedCalibrationSummary({
    summary: {
      categories: {
        reminders: { chars: 300, detailKey: 'codex.runtime' },
      },
      hashes: { runtime: 'abc123' },
    },
  });

  assert.equal(summary.categories.reminders?.chars, 300);
  assert.equal(summary.hashes?.runtime, 'abc123');
});

test('converts legacy Claude summaries into normalized categories for display', () => {
  const summary = getNormalizedCalibrationSummary({
    summary: {
      SYS_PROMPT_FALLBACK_CHARS: 11,
      TOOL_DEFS_FALLBACK_CHARS: 22,
      SYSTEM_REMINDER_CHROME_CHARS: 33,
    },
  });

  assert.equal(summary.categories.sysPrompt?.chars, 11);
  assert.equal(summary.categories.tool_defs?.chars, 22);
  assert.equal(summary.categories.userMsgs?.chars, 33);
});

test('builds stable category rows with labels and detail text', () => {
  const rows = buildCalibrationCategoryRows({
    tool_defs: { chars: 200, detailKey: 'codex.tools' },
    sysPrompt: { chars: 100, detailKey: 'codex.instructions' },
    memoryProject: { chars: 20, detailKey: 'claude.memory.project' },
    memoryGlobal: { chars: 10, detailKey: 'claude.memory.global' },
    mcp: { chars: 50 },
    memory: { chars: 0 },
  }, {
    'codex.tools': '# tools',
    'codex.instructions': '# instructions',
    'claude.memory.global': '# global',
    'claude.memory.project': '# project',
    mcp: '# mcp',
  });

  assert.deepEqual(rows.map((row) => row.key), ['sysPrompt', 'tool_defs', 'memoryGlobal', 'memoryProject', 'mcp']);
  assert.deepEqual(rows.map((row) => row.label), ['系统提示', '工具定义', '全局 CLAUDE.md', '项目 CLAUDE.md', 'MCP / 插件']);
  assert.equal(rows[1]?.detailKey, 'codex.tools');
  assert.equal(rows[1]?.detail, '# tools');
  assert.equal(rows[2]?.detail, '# global');
  assert.equal(rows[3]?.detail, '# project');
  assert.equal(sumCalibrationCategoryChars(rows), 380);
});
