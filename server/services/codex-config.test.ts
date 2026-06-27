import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseCodexConfig,
  resolveCodexBaseUrlFromConfigText,
  resolveCodexConfigPath,
} from './codex-config';

test('resolves Codex config path under the provided home directory', () => {
  assert.equal(resolveCodexConfigPath('/Users/link'), '/Users/link/.codex/config.toml');
});

test('parses model provider blocks and active provider', () => {
  const parsed = parseCodexConfig([
    'model_provider = "DeepSeek"',
    '',
    '[model_providers.OpenAI]',
    'base_url = "https://api.openai.com/v1"',
    '',
    '[model_providers.DeepSeek]',
    'base_url = "http://127.0.0.1:9090"',
  ].join('\n'));

  assert.equal(parsed.modelProvider, 'DeepSeek');
  assert.equal(parsed.modelProviders.DeepSeek?.baseUrl, 'http://127.0.0.1:9090');
});

test('resolves active Codex base URL from config text', () => {
  const baseUrl = resolveCodexBaseUrlFromConfigText([
    'model_provider = "DeepSeek"',
    '[model_providers.OpenAI]',
    'base_url = "https://api.openai.com/v1"',
    '[model_providers.DeepSeek]',
    'base_url = "http://127.0.0.1:9090"',
  ].join('\n'));

  assert.equal(baseUrl, 'http://127.0.0.1:9090');
});

test('falls back to OpenAI provider when active provider is missing', () => {
  const baseUrl = resolveCodexBaseUrlFromConfigText([
    '[model_providers.OpenAI]',
    'base_url = "https://api.openai.com/v1"',
  ].join('\n'));

  assert.equal(baseUrl, 'https://api.openai.com/v1');
});
