/**
 * config.ts — 统一的 LLM 客户端配置。
 *
 * 集中管理模型名、base URL、超时、重试等配置，消除 client.ts 中
 * 的硬编码 DEFAULT_MODEL / DEFAULT_BASE_URL。
 */

// ── 默认值 ──────────────────────────────────────────────────────────────────

export const DEFAULT_MODEL = 'deepseek-v4-pro' as const;
export const DEFAULT_BASE_URL = 'https://api.deepseek.com/anthropic' as const;

// ── 超时与重试 ──────────────────────────────────────────────────────────────

/** LLM API 请求超时（毫秒）。 */
export const LLM_TIMEOUT_MS = 120_000;

/** 最大重试次数（指数退避）。 */
export const LLM_MAX_RETRIES = 3;

/** 退避基数（毫秒）。 */
export const LLM_RETRY_BASE_MS = 1000;

// ── 模型上下文窗口（token） ─────────────────────────────────────────────────

export { MODEL_CONTEXT_WINDOWS, resolveContextLimit } from '../../shared/constants';

// ── 环境变量白名单（传给 Agent SDK 子进程） ─────────────────────────────────

export const ALLOWED_ENV_KEYS: ReadonlySet<string> = new Set([
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'LLM_MODEL',
  'HOME',
  'USER',
  'PATH',
  'TMPDIR',
  'LANG',
  'SHELL',
]);

/**
 * 构建 Agent SDK 子进程用的安全环境变量映射。
 * 只传递白名单中的变量，严禁全量展开 process.env。
 */
export function buildSafeEnv(overrides: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ALLOWED_ENV_KEYS) {
    const value = process.env[key];
    if (typeof value === 'string') env[key] = value;
  }
  return { ...env, ...overrides };
}
