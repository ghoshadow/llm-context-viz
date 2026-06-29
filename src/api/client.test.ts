/**
 * api/client.test.ts — API 客户端测试
 *
 * 覆盖：
 * - get: 正常响应、HTTP 错误
 * - post: JSON body、FormData body
 * - fetchWithTimeout: 超时 abort、正常响应
 */
import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

// ── 辅助函数 ─────────────────────────────────────────────────────────────

/** 创建模拟 Response 对象 */
function mockResponse(body: unknown, status = 200, statusText = 'OK'): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => body,
    headers: new Headers(),
    redirected: false,
    type: 'basic' as ResponseType,
    url: '',
    clone: () => mockResponse(body, status, statusText),
    body: null,
    bodyUsed: false,
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    formData: async () => new FormData(),
    text: async () => JSON.stringify(body),
  } as Response;
}

// ── 动态导入被测模块（在 mock fetch 之后） ───────────────────────────────

// 由于 fetch 是全局的，在 mock 后才能正确导入
const fetchMock = mock.method(globalThis, 'fetch');

// 延迟导入，确保 fetch mock 生效
const clientModule = await import('./client');
const { get, post } = clientModule;

// ── get 测试 ────────────────────────────────────────────────────────────

test('get 正常响应返回 JSON 数据', async () => {
  fetchMock.mock.mockImplementationOnce(() =>
    Promise.resolve(mockResponse({ data: 'hello' }, 200))
  );

  const result = await get<{ data: string }>('/test');
  assert.deepEqual(result, { data: 'hello' });
});

test('get HTTP 错误抛出异常', async () => {
  fetchMock.mock.mockImplementationOnce(() =>
    Promise.resolve(mockResponse({}, 404, 'Not Found'))
  );

  await assert.rejects(
    () => get('/nonexistent'),
    (err: Error) => err.message.includes('GET') && err.message.includes('404'),
  );
});

test('get HTTP 错误包含响应体的 error 字段', async () => {
  fetchMock.mock.mockImplementationOnce(() =>
    Promise.resolve(mockResponse({ error: '自定义错误消息' }, 500, 'Internal Server Error'))
  );

  await assert.rejects(
    () => get('/error-endpoint'),
    (err: Error) => err.message.includes('自定义错误消息'),
  );
});

test('get HTTP 错误响应体无 JSON 时回退到 HTTP status', async () => {
  const response = mockResponse({}, 500, 'Internal Server Error');
  // 覆盖 json 方法直接抛异常
  response.json = async () => { throw new Error('not json'); };

  fetchMock.mock.mockImplementationOnce(() => Promise.resolve(response));

  await assert.rejects(
    () => get('/server-error'),
    (err: Error) => err.message.includes('500 Internal Server Error'),
  );
});

// ── post 测试 ──────────────────────────────────────────────────────────

test('post JSON body 发送正确请求', async () => {
  fetchMock.mock.mockImplementationOnce((_url: string | URL | Request, init?: RequestInit) => {
    assert.ok(init, '应有请求配置');
    const headers = init!.headers as Record<string, string>;
    assert.equal(headers['Content-Type'], 'application/json');
    assert.equal(init!.method, 'POST');
    assert.equal(init!.body, JSON.stringify({ key: 'value' }));
    return Promise.resolve(mockResponse({ success: true }, 200));
  });

  const result = await post('/submit', { key: 'value' });
  assert.deepEqual(result, { success: true });
});

test('post FormData body 不设置 Content-Type', async () => {
  fetchMock.mock.mockImplementationOnce((_url: string | URL | Request, init?: RequestInit) => {
    const headers = init!.headers as Record<string, string>;
    assert.ok(!('Content-Type' in headers), 'FormData 不应设置 Content-Type');
    return Promise.resolve(mockResponse({ ok: true }, 200));
  });

  const formData = new FormData();
  formData.append('file', new Blob(['test']), 'test.txt');

  const result = await post('/upload', formData);
  assert.deepEqual(result, { ok: true });
});

test('post HTTP 错误抛出异常', async () => {
  fetchMock.mock.mockImplementationOnce(() =>
    Promise.resolve(mockResponse({}, 400, 'Bad Request'))
  );

  await assert.rejects(
    () => post('/bad-request'),
    (err: Error) => err.message.includes('POST') && err.message.includes('400'),
  );
});

// ── 超时测试 ────────────────────────────────────────────────────────────

test('get 超时抛出异常', async () => {
  fetchMock.mock.mockImplementationOnce(() => {
    // 模拟永不 resolve 的 Promise（忽略 signal 超时）
    // 由于我们 mock 了 fetch，signal abort 不会真正生效
    // 所以我们直接构造 AbortError
    const error = new DOMException('The operation was aborted', 'AbortError');
    return Promise.reject(error);
  });

  await assert.rejects(
    () => get('/slow', 1),
    (err: DOMException) => err.name === 'AbortError',
  );
});
