import assert from 'node:assert/strict';
import test from 'node:test';
import { getSessionProjectPathText } from './sessionProjectPath';

test('uses the session cwd as the homepage project path text', () => {
  assert.equal(
    getSessionProjectPathText({ cwd: '/Users/link/Documents/Anaconda/llm-context-viz' }),
    '~/Documents/Anaconda/llm-context-viz',
  );
});

test('shortens a bare macOS user home directory to tilde', () => {
  assert.equal(getSessionProjectPathText({ cwd: '/Users/link' }), '~');
});

test('falls back when a session list item has no recorded cwd', () => {
  assert.equal(getSessionProjectPathText({}), '未记录项目目录');
  assert.equal(getSessionProjectPathText({ cwd: '   ' }), '未记录项目目录');
});
