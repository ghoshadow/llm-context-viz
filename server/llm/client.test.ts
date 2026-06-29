import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveLLMRequestConfig } from './client';
import { buildSafeEnv } from './config';

test('uses flash model for translation calls without changing shared default', () => {
  const shared = resolveLLMRequestConfig({}, {});
  assert.equal(shared.model, 'deepseek-v4-pro');

  const translation = resolveLLMRequestConfig({}, { model: 'deepseek-v4-flash' });
  assert.equal(translation.model, 'deepseek-v4-flash');
});

test('environment model still overrides shared calls unless a call model is provided', () => {
  const env = { LLM_MODEL: 'custom-model', LLM_BASE_URL: 'https://example.test' };
  assert.equal(resolveLLMRequestConfig(env, {}).model, 'custom-model');
  assert.equal(resolveLLMRequestConfig(env, { model: 'deepseek-v4-flash' }).model, 'deepseek-v4-flash');
  assert.equal(resolveLLMRequestConfig(env, {}).baseUrl, 'https://example.test');
});

test('buildSafeEnv does not pass shared LLM_API_KEY into Agent SDK child env', () => {
  const previous = process.env.LLM_API_KEY;
  process.env.LLM_API_KEY = 'shared-secret';
  try {
    const env = buildSafeEnv({
      ANTHROPIC_API_KEY: 'anthropic-secret',
      ANTHROPIC_BASE_URL: 'https://example.test/anthropic',
    });

    assert.equal(env.ANTHROPIC_API_KEY, 'anthropic-secret');
    assert.equal(env.ANTHROPIC_BASE_URL, 'https://example.test/anthropic');
    assert.equal(env.LLM_API_KEY, undefined);
  } finally {
    if (previous === undefined) {
      delete process.env.LLM_API_KEY;
    } else {
      process.env.LLM_API_KEY = previous;
    }
  }
});
