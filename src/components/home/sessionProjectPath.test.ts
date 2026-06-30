import assert from 'node:assert/strict';
import test from 'node:test';
import { homedir } from 'os';
import { join } from 'path';
import { getSessionProjectPathText } from './sessionProjectPath';

const home = homedir();

test('replaces home directory with tilde', () => {
  assert.equal(
    getSessionProjectPathText({ cwd: join(home, 'Documents', 'my-project') }),
    '~/Documents/my-project',
  );
});

test('shortens a bare home directory to tilde', () => {
  assert.equal(getSessionProjectPathText({ cwd: home }), '~');
});

test('falls back when a session list item has no recorded cwd', () => {
  assert.equal(getSessionProjectPathText({}), '未记录项目目录');
  assert.equal(getSessionProjectPathText({ cwd: '   ' }), '未记录项目目录');
});

test('returns absolute path for paths outside home', () => {
  assert.equal(
    getSessionProjectPathText({ cwd: '/opt/some-tool/data' }),
    '/opt/some-tool/data',
  );
});
