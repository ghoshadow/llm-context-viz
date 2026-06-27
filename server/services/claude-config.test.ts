import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseClaudeSettings,
  readClaudeBaseUrl,
  resolveClaudeSettingsPath,
  resolveClaudeBaseUrlFromSettingsText,
} from './claude-config';

test('resolves Claude settings path under the provided home directory', () => {
  assert.equal(resolveClaudeSettingsPath('/Users/link'), '/Users/link/.claude/settings.json');
});

test('parses ANTHROPIC_BASE_URL from Claude settings env block', () => {
  const parsed = parseClaudeSettings(JSON.stringify({
    env: {
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:15721',
      ANTHROPIC_AUTH_TOKEN: 'secret',
    },
  }));

  assert.equal(parsed.baseUrl, 'http://127.0.0.1:15721');
});

test('resolves Claude base URL from settings text', () => {
  const baseUrl = resolveClaudeBaseUrlFromSettingsText(JSON.stringify({
    env: { ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic' },
  }));

  assert.equal(baseUrl, 'https://api.deepseek.com/anthropic');
});

test('falls back to DeepSeek Anthropic endpoint when settings are missing or invalid', () => {
  assert.equal(resolveClaudeBaseUrlFromSettingsText('{}'), 'https://api.deepseek.com/anthropic');
  assert.equal(resolveClaudeBaseUrlFromSettingsText('{oops'), 'https://api.deepseek.com/anthropic');
  assert.equal(readClaudeBaseUrl('/tmp/definitely-missing-claude-settings.json'), 'https://api.deepseek.com/anthropic');
});
