import assert from 'node:assert/strict';
import test from 'node:test';
import { decideContentRender, formatSyntaxBody } from './contentRenderStrategy';

test('routes tool-output markdown through markdown rendering', () => {
  assert.deepEqual(
    decideContentRender({
      text: 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts',
      markdown: true,
    }),
    { kind: 'markdown' },
  );
});

test('routes json tool parameters through syntax rendering', () => {
  assert.deepEqual(
    decideContentRender({
      text: '{"command":"ls"}',
      language: 'json',
      toolName: 'Bash',
    }),
    { kind: 'syntax', language: 'json' },
  );
});

test('routes edit tool json through diff rendering', () => {
  assert.deepEqual(
    decideContentRender({
      text: '{"old_string":"a","new_string":"b"}',
      language: 'json',
      toolName: 'Edit',
    }),
    { kind: 'edit-diff' },
  );
});

test('routes non-markdown errors through plain rendering', () => {
  assert.deepEqual(
    decideContentRender({
      text: 'Command failed',
      markdown: false,
    }),
    { kind: 'plain' },
  );
});

test('routes code-like markdown through syntax rendering', () => {
  assert.deepEqual(
    decideContentRender({
      text: [
        '1: import x from "x"',
        '2: const y = 1',
        '3: return y',
      ].join('\n'),
      markdown: true,
    }),
    { kind: 'syntax', language: 'typescript' },
  );
});

test('formats json syntax bodies when possible', () => {
  assert.equal(formatSyntaxBody('{"a":1}', 'json'), '{\n  "a": 1\n}');
  assert.equal(formatSyntaxBody('{bad', 'json'), '{bad');
  assert.equal(formatSyntaxBody('const a = 1', 'typescript'), 'const a = 1');
});
