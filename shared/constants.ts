/**
 * shared/constants.ts — 跨层共享常量定义。
 *
 * 被 server/ 和 src/ 共同引用。
 */

// ── 应用级常量 ──────────────────────────────────────────────────────────────

/** 默认服务端口号（当未设置 PORT 环境变量时使用）。 */
export const DEFAULT_SERVER_PORT = 4137;

// ── Token 估算 ──────────────────────────────────────────────────────────────

/**
 * 模型感知的 chars-per-token 比率。
 * DeepSeek 官方: 英文 ~3.33, 中文 ~1.67
 */
export const CHARS_PER_TOKEN = 3.0;

/** 不同语言的 chars-per-token 比率。 */
export const CHARS_PER_TOKEN_BY_LANG: Record<string, number> = {
  en: 3.33,
  zh: 1.67,
  code: 2.5,
  mixed: 3.0,
};

// ── 内容 JSON 包装开销 ──────────────────────────────────────────────────────

/** 每个工具结果块 JSON 包装的估算字符开销。 */
export const BLOCK_WRAPPER_CHARS = 23;

// ── CJK 检测阈值 ────────────────────────────────────────────────────────────

/** CJK 字符占比阈值，超过此值视为中文为主文本。 */
export const CJK_RATIO_THRESHOLD = 0.3;

/** 代码指标符号占比阈值，低于此阈值视为纯英文文本。 */
export const CODE_INDICATOR_RATIO_THRESHOLD = 0.05;

// ── 模型上下文窗口 ──────────────────────────────────────────────────────────

/** 模型名 -> 上下文窗口 token 上限。 */
export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'claude-sonnet': 200_000,
  'claude-opus': 200_000,
  'claude-haiku': 200_000,
  'deepseek-v4': 1_000_000,
  'deepseek-v4-pro': 1_000_000,
  'deepseek-v3': 128_000,
  'deepseek-r1': 128_000,
};

/** 根据模型名推断上下文窗口大小。 */
export function resolveContextLimit(model: string): number {
  const lower = model.toLowerCase();
  for (const [prefix, limit] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
    if (lower.includes(prefix)) return limit;
  }
  return 200_000;
}
