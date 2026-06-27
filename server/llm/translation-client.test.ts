import assert from 'node:assert/strict';
import test from 'node:test';
import {
  callTranslationLLM,
  resolveTranslationRequestConfig,
} from './translation-client';

test('resolves direct translation API config without using shared agent defaults', () => {
  const config = resolveTranslationRequestConfig({
    LLM_API_KEY: 'test-key',
    LLM_BASE_URL: 'https://api.deepseek.com/anthropic/',
  });

  assert.equal(config.apiKey, 'test-key');
  assert.equal(config.baseUrl, 'https://api.deepseek.com/anthropic');
  assert.equal(config.model, 'deepseek-v4-flash');
  assert.equal(config.messagesUrl, 'https://api.deepseek.com/anthropic/v1/messages');
});

test('posts Anthropic messages request and returns concatenated text', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: init! });
    return new Response(JSON.stringify({
      content: [
        { type: 'text', text: '[0] 你好' },
        { type: 'text', text: '[1] 世界' },
      ],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const text = await callTranslationLLM('Translate me', {
    env: {
      LLM_API_KEY: 'test-key',
      LLM_BASE_URL: 'https://example.test/anthropic',
    },
    fetchImpl,
  });

  assert.equal(text, '[0] 你好\n[1] 世界');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, 'https://example.test/anthropic/v1/messages');
  assert.equal(calls[0]!.init.method, 'POST');
  assert.equal((calls[0]!.init.headers as Record<string, string>)['x-api-key'], 'test-key');
  assert.equal((calls[0]!.init.headers as Record<string, string>)['anthropic-version'], '2023-06-01');

  const body = JSON.parse(String(calls[0]!.init.body));
  assert.equal(body.model, 'deepseek-v4-flash');
  assert.equal(body.max_tokens, 8192);
  assert.deepEqual(body.messages, [{ role: 'user', content: 'Translate me' }]);
});

test('surfaces direct translation API errors', async () => {
  await assert.rejects(
    () => callTranslationLLM('Translate me', {
      env: { LLM_API_KEY: 'test-key' },
      fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'bad model' } }), { status: 400 }),
    }),
    /翻译 API 请求失败 \(400\): bad model/,
  );
});

test('rejects truncated translation responses instead of caching partial text', async () => {
  await assert.rejects(
    () => callTranslationLLM('Translate me', {
      env: { LLM_API_KEY: 'test-key' },
      fetchImpl: async () => new Response(JSON.stringify({
        stop_reason: 'max_tokens',
        content: [{ type: 'text', text: '[0] partial' }],
      }), { status: 200 }),
    }),
    /翻译 API 返回被截断: max_tokens/,
  );
});
