/**
 * API client — 统一的 HTTP 请求封装。
 *
 * 开发模式: /api → Vite proxy → localhost:4137
 * 生产构建: /api 使用同源请求
 */

// 构建时注入（vite.config.ts define），运行时是常量字符串
declare const __API_BASE__: string;

const BASE = typeof __API_BASE__ !== 'undefined' ? __API_BASE__ : '/api';

/** 默认请求超时时间（毫秒） */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * 带超时的 fetch 封装。
 * 使用 race 而非 AbortController（AbortController 的 fetch 在取消后无法复用连接）。
 */
async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Preserve caller's signal if provided: combine it with the timeout signal
  // so either the caller aborting OR the timeout will cancel the request.
  const combinedSignal = init?.signal
    ? AbortSignal.any([init.signal, controller.signal])
    : controller.signal;

  try {
    const response = await fetch(url, { ...init, signal: combinedSignal });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

export async function get<T>(path: string, timeoutMs?: number): Promise<T> {
  const res = await fetchWithTimeout(`${BASE}${path}`, undefined, timeoutMs);
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const parsed = await res.json();
      if (parsed?.error) detail = parsed.error;
    } catch { /* ok */ }
    throw new Error(`GET ${path} failed: ${detail}`);
  }
  return res.json();
}

export const API_BASE = BASE;

export async function post<T>(path: string, body?: unknown, timeoutMs?: number): Promise<T> {
  const res = await fetchWithTimeout(`${BASE}${path}`, {
    method: 'POST',
    headers: body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
    body: body instanceof FormData ? body : JSON.stringify(body),
  }, timeoutMs);
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const parsed = await res.json();
      if (parsed?.error) detail = parsed.error;
    } catch {
      // Keep HTTP status when response body is not JSON.
    }
    throw new Error(`POST ${path} failed: ${detail}`);
  }
  return res.json();
}

export async function put<T>(path: string, body?: unknown, timeoutMs?: number): Promise<T> {
  const res = await fetchWithTimeout(`${BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, timeoutMs);
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const parsed = await res.json();
      if (parsed?.error) detail = parsed.error;
    } catch {
      // Keep HTTP status when response body is not JSON.
    }
    throw new Error(`PUT ${path} failed: ${detail}`);
  }
  return res.json();
}

export async function del(path: string, timeoutMs?: number): Promise<void> {
  const res = await fetchWithTimeout(`${BASE}${path}`, { method: 'DELETE' }, timeoutMs);
  if (!res.ok) {
    throw new Error(`DELETE ${path} failed: ${res.status} ${res.statusText}`);
  }
}
