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

test('keeps translated file header separated from following list', () => {
  const translated = reassembleTranslatedSegments(
    [
      {
        zh: false,
        text: "Contents of /Users/link/.claude/CLAUDE.md (user's private global instructions for all projects):\n\n",
      },
      {
        zh: true,
        text: '- 输出超过 token 限制风险时，主动拆分回答或使用文件输出',
      },
    ],
    [
      "Contents of /Users/link/.claude/CLAUDE.md (user's private global instructions for all projects):",
    ],
  );

  assert.equal(
    translated,
    [
      "Contents of /Users/link/.claude/CLAUDE.md (user's private global instructions for all projects):",
      '',
      '- 输出超过 token 限制风险时，主动拆分回答或使用文件输出',
    ].join('\n'),
  );
});

test('keeps markdown list marker when it is split before Chinese item text', () => {
  const translated = reassembleTranslatedSegments(
    [
      {
        zh: false,
        text: [
          '<system-reminder>',
          "As you answer the user's questions, you can use the following context:",
          '# claudeMd',
          'Codebase and user instructions are shown below.',
          '',
          "Contents of /Users/link/.claude/CLAUDE.md (user's private global instructions for all projects):",
          '',
          '- ',
        ].join('\n'),
      },
      { zh: true, text: '输出超过' },
      { zh: false, text: ' token ' },
      { zh: true, text: '限制风险时，主动拆分回答或使用文件输出' },
      { zh: false, text: '\n# currentDate\nToday date is 2026/06/26.' },
    ],
    [
      [
        '<system-reminder>',
        '回答用户问题时，你可以参考以下上下文：',
        '# claudeMd',
        '下面是代码库和用户说明。',
        "/Users/link/.claude/CLAUDE.md 的内容（用户所有项目的私有全局说明）：",
      ].join('\n'),
      'token',
      '# currentDate\n今天的日期是 2026/06/26。',
    ],
  );

  assert.equal(
    translated,
    [
      '<system-reminder>',
      '回答用户问题时，你可以参考以下上下文：',
      '# claudeMd',
      '下面是代码库和用户说明。',
      "/Users/link/.claude/CLAUDE.md 的内容（用户所有项目的私有全局说明）：",
      '',
      '- 输出超过token限制风险时，主动拆分回答或使用文件输出',
      '# currentDate',
      '今天的日期是 2026/06/26。',
    ].join('\n'),
  );
});

test('keeps heading break when source heading has leading whitespace', () => {
  const translated = reassembleTranslatedSegments(
    [
      { zh: true, text: '主动拆分回答或使用文件输出' },
      { zh: false, text: '\n# currentDate\nToday date is 2026/06/26.' },
    ],
    ['currentDate\n今天的日期是 2026/06/26。'],
  );

  assert.equal(
    translated,
    '主动拆分回答或使用文件输出\ncurrentDate\n今天的日期是 2026/06/26。',
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
