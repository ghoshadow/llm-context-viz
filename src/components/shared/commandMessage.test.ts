import assert from 'node:assert/strict';
import test from 'node:test';
import { getCommandMessagePreview, parseCommandMessageSegments } from './commandMessage';

test('parses plugin command message tags into a command segment', () => {
  const segments = parseCommandMessageSegments(
    '<command-message>ponytail:ponytail-audit</command-message> <command-name>/ponytail:ponytail-audit</command-name> <command-args>审查当前项目所有代码</command-args>',
  );

  assert.deepEqual(segments, [
    {
      type: 'command',
      message: 'ponytail:ponytail-audit',
      name: '/ponytail:ponytail-audit',
      args: '审查当前项目所有代码',
      raw: '<command-message>ponytail:ponytail-audit</command-message> <command-name>/ponytail:ponytail-audit</command-name> <command-args>审查当前项目所有代码</command-args>',
    },
  ]);
});

test('preserves surrounding text around plugin command messages', () => {
  const segments = parseCommandMessageSegments(
    '前文\n<command-message>x:y</command-message><command-name>/x:y</command-name><command-args>参数</command-args>\n后文',
  );

  assert.deepEqual(segments, [
    { type: 'text', text: '前文\n' },
    {
      type: 'command',
      message: 'x:y',
      name: '/x:y',
      args: '参数',
      raw: '<command-message>x:y</command-message><command-name>/x:y</command-name><command-args>参数</command-args>',
    },
    { type: 'text', text: '\n后文' },
  ]);
});

test('parses slash command messages without command args', () => {
  const raw = '<command-message>trellis-update-spec</command-message>\n<command-name>/trellis-update-spec</command-name>';

  assert.deepEqual(parseCommandMessageSegments(raw), [
    {
      type: 'command',
      message: 'trellis-update-spec',
      name: '/trellis-update-spec',
      args: '',
      raw,
    },
  ]);
});

test('parses command tags regardless of order', () => {
  const raw = '<command-name>/model</command-name>\n\n<command-message>model</command-message>\n<command-args></command-args>';

  assert.deepEqual(parseCommandMessageSegments(raw), [
    {
      type: 'command',
      message: 'model',
      name: '/model',
      args: '',
      raw,
    },
  ]);
});

test('returns plain text when command tags are incomplete', () => {
  assert.deepEqual(parseCommandMessageSegments('<command-name>/x:y</command-name>'), [
    { type: 'text', text: '<command-name>/x:y</command-name>' },
  ]);
});

test('builds a compact preview for turn list command messages', () => {
  assert.deepEqual(
    getCommandMessagePreview(
      '<command-message>ponytail:ponytail-audit</command-message> <command-name>/ponytail:ponytail-audit</command-name> <command-args>审查当前项目所有代码</command-args>',
    ),
    {
      message: 'ponytail:ponytail-audit',
      name: '/ponytail:ponytail-audit',
      args: '审查当前项目所有代码',
      plugin: 'ponytail',
      command: 'ponytail-audit',
      displayName: '/ponytail:ponytail-audit',
    },
  );
});

test('builds a compact preview from truncated session title command messages', () => {
  assert.deepEqual(
    getCommandMessagePreview(
      '<command-message>ponytail:ponytail-audit</command-message>\n<command-name>/ponytail:ponytail-audit</command-name>\n<comman',
    ),
    {
      message: 'ponytail:ponytail-audit',
      name: '/ponytail:ponytail-audit',
      args: '',
      plugin: 'ponytail',
      command: 'ponytail-audit',
      displayName: '/ponytail:ponytail-audit',
    },
  );
});

test('builds a compact preview for slash commands without plugin namespace', () => {
  assert.deepEqual(
    getCommandMessagePreview(
      '<command-message>trellis-update-spec</command-message><command-name>/trellis-update-spec</command-name>',
    ),
    {
      message: 'trellis-update-spec',
      name: '/trellis-update-spec',
      args: '',
      plugin: '',
      command: 'trellis-update-spec',
      displayName: '/trellis-update-spec',
    },
  );
});

test('returns null preview when no complete command message exists', () => {
  assert.equal(getCommandMessagePreview('普通用户输入'), null);
});
