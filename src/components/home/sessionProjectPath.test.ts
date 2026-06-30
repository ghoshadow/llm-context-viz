import assert from 'node:assert/strict';
import test from 'node:test';
import { homedir } from 'os';
import { join } from 'path';
import { getSessionProjectPathText } from './sessionProjectPath';

const home = homedir();

test('replaces home directory with tilde', () => {
  assert.equal(
    getSessionProjectPathText({ cwd: join(home, 'Documents', 'my-project') }, home),
    '~/Documents/my-project',
  );
});

test('shortens a bare home directory to tilde', () => {
  assert.equal(getSessionProjectPathText({ cwd: home }, home), '~');
});

test('returns absolute path when no homeDir provided', () => {
  assert.equal(
    getSessionProjectPathText({ cwd: join(home, 'work') }),
    join(home, 'work'),
  );
});

test('falls back when a session list item has no recorded cwd', () => {
  assert.equal(getSessionProjectPathText({}), '未记录项目目录');
  assert.equal(getSessionProjectPathText({ cwd: '   ' }), '未记录项目目录');
});

test('returns absolute path for paths outside home', () => {
  assert.equal(
    getSessionProjectPathText({ cwd: '/opt/some-tool/data' }, home),
    '/opt/some-tool/data',
  );
});
