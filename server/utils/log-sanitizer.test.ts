import assert from 'node:assert/strict';
import test from 'node:test';
import { filterEnv } from './log-sanitizer';

test('filterEnv excludes shared LLM_API_KEY from Agent SDK child env', () => {
  const env = filterEnv({
    LLM_API_KEY: 'shared-secret',
    ANTHROPIC_API_KEY: 'anthropic-secret',
    ANTHROPIC_BASE_URL: 'https://example.test/anthropic',
    PATH: '/usr/bin',
  });

  assert.equal(env.ANTHROPIC_API_KEY, 'anthropic-secret');
  assert.equal(env.ANTHROPIC_BASE_URL, 'https://example.test/anthropic');
  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.LLM_API_KEY, undefined);
});
