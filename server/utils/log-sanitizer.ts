/**
 * 日志脱敏工具 — 防止 API Key、Token、完整 Prompt 内容泄露到日志输出。
 *
 * 使用方式：
 *   import { sanitizeForLog, SANITIZED } from '../utils/log-sanitizer.js';
 *   console.error('[llm]', sanitizeForLog(apiKey));
 */

import { ALLOWED_ENV_KEYS } from '../llm/config.js';

/** 需要遮盖的敏感键名模式（不区分大小写） */
const SENSITIVE_KEY_PATTERNS = [
  /api[_-]?key/i,
  /secret/i,
  /token/i,
  /password/i,
  /authorization/i,
  /credential/i,
];

/** 敏感值格式模式（用于自动检测未显式键名的泄露） */
const SENSITIVE_VALUE_PATTERNS = [
  /sk-(?:ant|proj)-[A-Za-z0-9_-]{20,}/,   // Anthropic / OpenAI API Key
  /sk-[A-Za-z0-9_-]{30,}/g,                // 通用 API Key（DeepSeek 等）
  /[A-Za-z0-9+/=]{40,}/,                    // 泛化 Base64 / 哈希
];

/** 日志文本最大长度（超过则截断） */
const MAX_LOG_TEXT_LENGTH = 200;

export const SANITIZED = '[已脱敏]';

/** 检查键名是否敏感 */
function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((p) => p.test(key));
}

/** 检查字符串值是否看起来像敏感凭证 */
function looksLikeSecret(value: string): boolean {
  if (value.length < 20) return false;
  return SENSITIVE_VALUE_PATTERNS.some((p) => p.test(value));
}

/**
 * 对单值进行脱敏处理。
 * - 字符串过长则截断
 * - 看起来像 API Key 则替换为占位符
 */
export function sanitizeValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;

  if (looksLikeSecret(value)) {
    return SANITIZED;
  }

  if (value.length > MAX_LOG_TEXT_LENGTH) {
    return value.slice(0, MAX_LOG_TEXT_LENGTH - 3) + '...';
  }

  return value;
}

/**
 * 对对象进行脱敏 — 递归遍历并遮盖敏感键名的值。
 * 注意：仅脱敏一层嵌套的字符串值，不处理深层嵌套以避免性能问题。
 */
export function sanitizeObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (isSensitiveKey(key)) {
      result[key] = SANITIZED;
    } else if (typeof value === 'string') {
      result[key] = sanitizeValue(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * 主入口：对日志消息进行安全脱敏。
 * - 字符串：检查长度和敏感模式
 * - 对象：检查键名和值的敏感模式
 */
export function sanitizeForLog(input: unknown): unknown {
  if (typeof input === 'string') {
    return sanitizeValue(input);
  }

  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return sanitizeObject(input as Record<string, unknown>);
  }

  return input;
}

/**
 * 对 process.env 进行安全过滤，只保留白名单中的环境变量。
 * 用于 Agent SDK 调用时防止全量环境变量泄露。
 * 白名单来自 config.ts 的 ALLOWED_ENV_KEYS（唯一真相来源）。
 */
export function filterEnv(
  env: Record<string, string | undefined>,
  allowedKeys: Set<string> = ALLOWED_ENV_KEYS,
): Record<string, string> {
  const filtered: Record<string, string> = {};
  for (const key of allowedKeys) {
    if (env[key] !== undefined) {
      filtered[key] = env[key]!;
    }
  }
  return filtered;
}
