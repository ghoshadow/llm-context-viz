/**
 * API client — 统一的 HTTP 请求封装。
 *
 * 浏览器模式 (npm run dev): /api → Vite proxy → localhost:4137
 * Tauri 模式 (npx tauri build): 构建时注入绝对地址
 */

// 构建时注入（vite.config.ts define），运行时是常量字符串
declare const __API_BASE__: string;

const BASE = typeof __API_BASE__ !== 'undefined' ? __API_BASE__ : '/api';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const url = `${BASE}${path}`;
  const init: RequestInit = {
    method,
    headers: body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) {
    init.body = body instanceof FormData ? body : JSON.stringify(body);
  }

  const res = await fetch(url, init);
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const parsed = await res.json();
      if (parsed?.error) detail = parsed.error;
    } catch { /* ok */ }
    throw new Error(`${method} ${path} failed: ${detail}`);
  }
  return res.json();
}

export const API_BASE = BASE;

export async function get<T>(path: string): Promise<T> {
  return request<T>('GET', path);
}

export async function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>('POST', path, body);
}

export async function put<T>(path: string, body?: unknown): Promise<T> {
  return request<T>('PUT', path, body);
}

export async function del(path: string): Promise<void> {
  await request<void>('DELETE', path);
}
