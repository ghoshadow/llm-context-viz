import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getCalibrationDetailDisplay,
  getCalibrationDetailLayout,
  getCalibrationDetailSectionIndex,
} from './calibrationDetailModal';

test('uses side-by-side layout after a translation is available', () => {
  assert.equal(getCalibrationDetailLayout('translated markdown'), 'side-by-side');
});

test('uses single-column layout before translation is available', () => {
  assert.equal(getCalibrationDetailLayout(''), 'single');
  assert.equal(getCalibrationDetailLayout(undefined), 'single');
});

test('builds different translation cache sections for different constants and content', () => {
  const sysA = getCalibrationDetailSectionIndex('SYS_PROMPT_FALLBACK_CHARS', 'alpha');
  const sysB = getCalibrationDetailSectionIndex('SYS_PROMPT_FALLBACK_CHARS', 'beta');
  const toolsA = getCalibrationDetailSectionIndex('TOOL_DEFS_FALLBACK_CHARS', 'alpha');

  assert.notEqual(sysA, sysB);
  assert.notEqual(sysA, toolsA);
  assert.equal(getCalibrationDetailSectionIndex('SYS_PROMPT_FALLBACK_CHARS', 'alpha'), sysA);
});

test('renders system prompt detail as plain text and unwraps legacy text fence', () => {
  const legacy = [
    '# SYS_PROMPT_FALLBACK_CHARS',
    '',
    '字符数: 42',
    '',
    '```text',
    'before',
    '```json',
    '{"ok":true}',
    '```',
    'after',
    '```',
  ].join('\n');

  assert.deepEqual(getCalibrationDetailDisplay('SYS_PROMPT_FALLBACK_CHARS', legacy), {
    text: ['before', '```json', '{"ok":true}', '```', 'after'].join('\n'),
    markdown: false,
  });
});

test('keeps tool detail as markdown for json code rendering', () => {
  const detail = ['# TOOL_DEFS_FALLBACK_CHARS', '', '```json', '{"name":"Read"}', '```'].join('\n');

  assert.deepEqual(getCalibrationDetailDisplay('TOOL_DEFS_FALLBACK_CHARS', detail), {
    text: detail,
    markdown: true,
  });
});
