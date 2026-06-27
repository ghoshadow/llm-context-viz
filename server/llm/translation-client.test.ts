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
    TRANSLATION_BASE_URL: 'https://api.deepseek.com/chat/completions',
  });

  assert.equal(config.apiKey, 'test-key');
  assert.equal(config.requestUrl, 'https://api.deepseek.com/chat/completions');
  assert.equal(config.model, 'deepseek-v4-flash');
  assert.equal(config.maxTokens, undefined);
});

test('can use DeepSeek-specific API key for translation requests', () => {
  const config = resolveTranslationRequestConfig({
    DEEPSEEK_API_KEY: 'deepseek-key',
  });

  assert.equal(config.apiKey, 'deepseek-key');
});

test('posts OpenAI chat completions request matching the verified direct script', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: init! });
    return new Response(JSON.stringify({
      choices: [
        { message: { content: '[0] 你好\n%%%\n[1] 世界' }, finish_reason: 'stop' },
      ],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const text = await callTranslationLLM('Translate me', {
    env: {
      LLM_API_KEY: 'test-key',
      LLM_BASE_URL: 'https://ignored.example/anthropic',
      TRANSLATION_BASE_URL: 'https://example.test/chat/completions',
    },
    fetchImpl,
  });

  assert.equal(text, '[0] 你好\n%%%\n[1] 世界');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, 'https://example.test/chat/completions');
  assert.equal(calls[0]!.init.method, 'POST');
  assert.equal((calls[0]!.init.headers as Record<string, string>)['Authorization'], 'Bearer test-key');
  assert.equal((calls[0]!.init.headers as Record<string, string>)['x-api-key'], undefined);

  const body = JSON.parse(String(calls[0]!.init.body));
  assert.equal(body.model, 'deepseek-v4-flash');
  assert.equal(body.stream, false);
  assert.equal(body.max_tokens, undefined);
  assert.equal(body.thinking, undefined);
  assert.equal(body.reasoning_effort, undefined);
  assert.equal(body.messages.length, 2);
  assert.equal(body.messages[0].role, 'system');
  assert.match(body.messages[0].content, /专业的技术文档翻译/);
  assert.deepEqual(body.messages[1], { role: 'user', content: '请翻译以下文本：\n\nTranslate me' });
});

test('can opt into max_tokens for translation requests', async () => {
  const calls: Array<{ init: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (_url, init) => {
    calls.push({ init: init! });
    return new Response(JSON.stringify({
      choices: [{ message: { content: '你好' }, finish_reason: 'stop' }],
    }), { status: 200 });
  };

  await callTranslationLLM('Translate me', {
    env: {
      LLM_API_KEY: 'test-key',
      TRANSLATION_MAX_TOKENS: '1280000',
    },
    fetchImpl,
  });

  const body = JSON.parse(String(calls[0]!.init.body));
  assert.equal(body.max_tokens, 1280000);
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
        choices: [
          { finish_reason: 'length', message: { content: '[0] partial' } },
        ],
      }), { status: 200 }),
    }),
    /翻译 API 返回被截断: length/,
  );
});
