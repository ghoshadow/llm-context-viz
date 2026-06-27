import assert from 'node:assert/strict';
import test from 'node:test';
import {
  categoryChars,
  legacyClaudeSummaryToNormalized,
  normalizeAgentSource,
} from './calibration-types';

test('converts legacy Claude summary into normalized categories', () => {
  const normalized = legacyClaudeSummaryToNormalized({
    SYS_PROMPT_FALLBACK_CHARS: 111,
    TOOL_DEFS_FALLBACK_CHARS: 222,
    SYSTEM_REMINDER_CHROME_CHARS: 333,
  }, {
    SYS_PROMPT_FALLBACK_CHARS: '# sys',
    TOOL_DEFS_FALLBACK_CHARS: '# tools',
    SYSTEM_REMINDER_CHROME_CHARS: '# chrome',
  });

  assert.equal(normalized.categories.sysPrompt?.chars, 111);
  assert.equal(normalized.categories.tool_defs?.chars, 222);
  assert.equal(normalized.categories.userMsgs?.chars, 333);
  assert.equal(normalized.categories.sysPrompt?.detailKey, 'claude.sysPrompt');
  assert.equal(normalized.details?.['claude.userMsgs'], '# chrome');
});

test('categoryChars returns zero for missing categories', () => {
  const normalized = legacyClaudeSummaryToNormalized({
    SYS_PROMPT_FALLBACK_CHARS: 111,
    TOOL_DEFS_FALLBACK_CHARS: 222,
    SYSTEM_REMINDER_CHROME_CHARS: 333,
  });

  assert.equal(categoryChars(normalized, 'sysPrompt'), 111);
  assert.equal(categoryChars(normalized, 'memory'), 0);
});

test('normalizes supported agent sources and rejects unknown values', () => {
  assert.equal(normalizeAgentSource(undefined), 'claude');
  assert.equal(normalizeAgentSource('codex'), 'codex');
  assert.equal(normalizeAgentSource('opencode'), 'opencode');
  assert.equal(normalizeAgentSource('openclaw'), 'openclaw');
  assert.throws(() => normalizeAgentSource('other'), /Unsupported calibration source: other/);
});
