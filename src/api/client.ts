const BASE = '/api';

export async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const parsed = await res.json();
      if (parsed?.error) detail = parsed.error;
    } catch {
      // Keep HTTP status when response body is not JSON.
    }
    throw new Error(`GET ${path} failed: ${detail}`);
  }
  return res.json();
}

export async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
    body: body instanceof FormData ? body : JSON.stringify(body),
  });
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

export async function put<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
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

export async function del(path: string): Promise<void> {
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE' });
  if (!res.ok) {
    throw new Error(`DELETE ${path} failed: ${res.status} ${res.statusText}`);
  }
}
