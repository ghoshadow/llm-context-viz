/**
 * env-file.ts — .env 文件解析与写回工具。
 *
 * 读取：优先 ~/.llm-context-viz/.env → 项目 .env → process.env
 * 写入：始终写入 ~/.llm-context-viz/.env
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const ENV_PATH = join(homedir(), '.llm-context-viz', '.env');
const PROJECT_ENV = join(process.cwd(), '.env');

// ── 解析 ──────────────────────────────────────────────────────────────────────

interface EnvLine { raw: string; key?: string; value?: string }

function parseLines(text: string): EnvLine[] {
  return text.split('\n').map((raw) => {
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#')) return { raw };
    const eq = raw.indexOf('=');
    if (eq <= 0) return { raw };
    return { raw, key: raw.slice(0, eq).trim(), value: raw.slice(eq + 1) };
  });
}

function readRaw(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of parseLines(text)) {
    if (line.key) result[line.key] = line.value ?? '';
  }
  return result;
}

// ── 掩码 ──────────────────────────────────────────────────────────────────────

function maskApiKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '***';
  return key.slice(0, 4) + '...' + key.slice(-4);
}

// ── 公开类型 ──────────────────────────────────────────────────────────────────

export interface ModelConfig {
  LLM_BASE_URL: string;
  LLM_API_KEY: string;
  LLM_MODEL: string;
  TRANSLATION_BASE_URL: string;
  TRANSLATION_MODEL: string;
}

export interface ModelConfigResponse {
  LLM_BASE_URL: string;
  LLM_API_KEY: string;
  LLM_MODEL: string;
  TRANSLATION_BASE_URL: string;
  TRANSLATION_MODEL: string;
  hasApiKey: boolean;
}

// ── 默认值 ────────────────────────────────────────────────────────────────────

const DEFAULTS: Record<string, string> = {
  LLM_BASE_URL: 'https://api.deepseek.com/anthropic',
  LLM_MODEL: 'deepseek-v4-pro',
};

/** 合并多个来源：文件值 > env > 默认值 */
function merge(files: string[]): Record<string, string> {
  const result: Record<string, string> = { ...DEFAULTS };
  // 最后读的文件覆盖前面的
  for (const f of files) {
    if (existsSync(f)) Object.assign(result, readRaw(readFileSync(f, 'utf-8')));
  }
  // process.env 优先级最高
  for (const k of ['LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL', 'TRANSLATION_BASE_URL', 'TRANSLATION_MODEL']) {
    if (process.env[k]) result[k] = process.env[k];
  }
  return result;
}

// ── 公开 API ──────────────────────────────────────────────────────────────────

export function readModelConfig(): ModelConfigResponse {
  const files = [ENV_PATH, PROJECT_ENV];  // 用户配置 > 项目配置
  const cfg = merge(files);
  const key = cfg.LLM_API_KEY || '';
  return {
    LLM_BASE_URL: cfg.LLM_BASE_URL || DEFAULTS.LLM_BASE_URL,
    LLM_API_KEY: maskApiKey(key),
    LLM_MODEL: cfg.LLM_MODEL || DEFAULTS.LLM_MODEL,
    TRANSLATION_BASE_URL: cfg.TRANSLATION_BASE_URL || '',
    TRANSLATION_MODEL: cfg.TRANSLATION_MODEL || '',
    hasApiKey: key.length > 0,
  };
}

const MANAGED_KEYS = new Set([
  'LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL',
  'TRANSLATION_BASE_URL', 'TRANSLATION_MODEL',
]);

export function writeModelConfig(updates: Partial<ModelConfig>): ModelConfigResponse {
  const dir = join(ENV_PATH, '..');
  mkdirSync(dir, { recursive: true });

  const oldText = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf-8') : '';
  const lines = parseLines(oldText);
  const updated = new Set<string>();

  const newLines = lines.map((line) => {
    if (line.key && MANAGED_KEYS.has(line.key) && line.key in updates) {
      updated.add(line.key);
      return `${line.key}=${(updates as any)[line.key]}`;
    }
    return line.raw;
  });

  for (const k of Object.keys(updates)) {
    if (!updated.has(k)) newLines.push(`${k}=${(updates as any)[k]}`);
  }

  writeFileSync(ENV_PATH, newLines.join('\n') + '\n', 'utf-8');

  for (const k of Object.keys(updates)) {
    if ((updates as any)[k]) process.env[k] = (updates as any)[k];
  }

  return readModelConfig();
}
