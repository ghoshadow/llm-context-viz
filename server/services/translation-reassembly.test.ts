import assert from 'node:assert/strict';
import test from 'node:test';
import { reassembleTranslatedSegments } from './translation-reassembly';

test('keeps translated markdown heading on its own line', () => {
  const translated = reassembleTranslatedSegments(
    [
      { zh: false, text: 'Contents of /Users/link/.claude/CLAUDE.md\n\n' },
      { zh: false, text: '# currentDate\nToday date is 2026/06/26.' },
    ],
    [
      '/Users/link/.claude/CLAUDE.md 的内容',
      'currentDate\n当前日期为 2026/06/26。',
    ],
  );

  assert.equal(
    translated,
    '/Users/link/.claude/CLAUDE.md 的内容\ncurrentDate\n当前日期为 2026/06/26。',
  );
});

test('keeps code fences on their own line after translated text', () => {
  const translated = reassembleTranslatedSegments(
    [
      { zh: false, text: 'Example:\n' },
      { zh: true, text: '```bash\necho hello\n```' },
    ],
    ['示例：'],
  );

  assert.equal(translated, '示例：\n```bash\necho hello\n```');
});
