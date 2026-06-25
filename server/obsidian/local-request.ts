import type { Request, Response } from 'express';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function originHost(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

export function isTrustedLocalRequest(req: Request): boolean {
  const origin = req.get('origin');
  if (!origin) return true;
  const host = originHost(origin);
  return Boolean(host && LOCAL_HOSTS.has(host));
}

export function rejectUntrustedLocalRequest(req: Request, res: Response): boolean {
  if (isTrustedLocalRequest(req)) return false;
  res.status(403).json({ error: '仅允许本机页面发起 Obsidian 同步请求' });
  return true;
}
