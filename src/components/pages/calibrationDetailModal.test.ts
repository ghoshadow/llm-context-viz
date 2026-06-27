import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PURE_CODE_TRANSLATION_MESSAGE,
  getCalibrationDetailDisplay,
  getCalibrationDetailLayout,
  getCalibrationDetailTranslationBlockReason,
  getCalibrationDetailTranslationSlot,
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

test('builds stable translation cache slot for calibration detail', () => {
  assert.deepEqual(getCalibrationDetailTranslationSlot('SYS_PROMPT_FALLBACK_CHARS', 'alpha'), {
    stepIndex: -100,
    sectionIndex: getCalibrationDetailSectionIndex('SYS_PROMPT_FALLBACK_CHARS', 'alpha'),
  });
});

test('builds stable translation cache slot for arbitrary calibration detail keys', () => {
  const first = getCalibrationDetailTranslationSlot('codex.tools', 'alpha');
  const second = getCalibrationDetailTranslationSlot('codex.tools', 'alpha');
  const third = getCalibrationDetailTranslationSlot('codex.instructions', 'alpha');

  assert.deepEqual(first, second);
  assert.notEqual(first.sectionIndex, third.sectionIndex);
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

test('renders system reminder detail as plain text and unwraps legacy text fence', () => {
  const legacy = [
    '# SYSTEM_REMINDER_CHROME_CHARS',
    '',
    '字符数: 42',
    '',
    '```text',
    'wrapper before',
    '```bash',
    'echo hello',
    '```',
    'wrapper after',
    '```',
  ].join('\n');

  assert.deepEqual(getCalibrationDetailDisplay('SYSTEM_REMINDER_CHROME_CHARS', legacy), {
    text: ['wrapper before', '```bash', 'echo hello', '```', 'wrapper after'].join('\n'),
    markdown: false,
  });
});

test('normalizes stuck heading breaks in translated plain text details', () => {
  const translated = [
    '# SYSTEM_REMINDER_CHROME_CHARS',
    '',
    '字符数: 42',
    '',
    '主动拆分回答或使用文件输出# currentDate',
    '当前日期为 2026/06/26。',
  ].join('\n');

  assert.deepEqual(getCalibrationDetailDisplay('SYSTEM_REMINDER_CHROME_CHARS', translated), {
    text: '主动拆分回答或使用文件输出\n# currentDate\n当前日期为 2026/06/26。',
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

test('renders tool detail as markdown for any tool_defs detail key', () => {
  const detail = ['# codex.tools', '', '字符数: 10', '', '```json', '{"name":"Read"}', '```'].join('\n');
  assert.deepEqual(getCalibrationDetailDisplay('codex.tools', detail), {
    text: detail,
    markdown: true,
  });
});

test('renders non-tool details as plain text', () => {
  const detail = ['# codex.instructions', '', '字符数: 10', '', 'hello'].join('\n');
  assert.deepEqual(getCalibrationDetailDisplay('codex.instructions', detail), {
    text: 'hello',
    markdown: false,
  });
});

test('blocks translation for pure tool definition code', () => {
  const detail = ['# codex.tools', '', '字符数: 10', '', '```json', '{"name":"Read"}', '```'].join('\n');
  const display = getCalibrationDetailDisplay('codex.tools', detail);

  assert.equal(
    getCalibrationDetailTranslationBlockReason('codex.tools', display),
    PURE_CODE_TRANSLATION_MESSAGE,
  );
});

test('blocks tool definition json even when strings contain fenced examples', () => {
  const detail = [
    '# TOOL_DEFS_FALLBACK_CHARS',
    '',
    '字符数: 100',
    '',
    '```json',
    '[',
    '  {',
    '    "name": "Bash",',
    '    "description": "Example:\\n```bash\\necho hello\\n```\\nUse for shell commands."',
    '  }',
    ']',
    '```',
  ].join('\n');
  const display = getCalibrationDetailDisplay('claude.tool_defs', detail);

  assert.equal(
    getCalibrationDetailTranslationBlockReason('claude.tool_defs', display),
    PURE_CODE_TRANSLATION_MESSAGE,
  );
});

test('blocks translation for raw json calibration detail', () => {
  assert.equal(
    getCalibrationDetailTranslationBlockReason('custom.detail', {
      text: '{"name":"Read","input_schema":{"type":"object"}}',
      markdown: false,
    }),
    PURE_CODE_TRANSLATION_MESSAGE,
  );
});

test('allows translation when prose remains outside code blocks', () => {
  const detail = [
    '# SYSTEM_REMINDER_CHROME_CHARS',
    '',
    '字符数: 42',
    '',
    '```text',
    'Read the following JSON if relevant:',
    '```json',
    '{"name":"Read"}',
    '```',
    'Then answer in Chinese.',
    '```',
  ].join('\n');
  const display = getCalibrationDetailDisplay('SYSTEM_REMINDER_CHROME_CHARS', detail);

  assert.equal(getCalibrationDetailTranslationBlockReason('SYSTEM_REMINDER_CHROME_CHARS', display), null);
});
