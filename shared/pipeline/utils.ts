// ============================================================================
// Shared pipeline utilities — eliminates duplicated helpers across stage files.
// ============================================================================

import type { ContentBlock } from '../types/session';
import {
  BLOCK_WRAPPER_CHARS,
  CHARS_PER_TOKEN,
  CHARS_PER_TOKEN_BY_LANG,
  CJK_RATIO_THRESHOLD,
  CODE_INDICATOR_RATIO_THRESHOLD,
} from './constants';

// ---------------------------------------------------------------------------
// Token 估算 — 常量已统一定义在 ./constants.ts，此处 re-export。
// ---------------------------------------------------------------------------

export { CHARS_PER_TOKEN, CHARS_PER_TOKEN_BY_LANG };

/**
 * 根据文本内容检测主要语言类型。
 * 简单启发式：CJK 字符占比 >30% 视为中文为主。
 */
function detectTextMode(text: string): 'zh' | 'en' | 'code' | 'mixed' {
  if (!text || text.length === 0) return 'mixed';
  let cjk = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp != null && (
      (cp >= 0x4E00 && cp <= 0x9FFF) ||   // CJK Unified
      (cp >= 0x3400 && cp <= 0x4DBF) ||   // CJK Extension A
      (cp >= 0x3000 && cp <= 0x303F) ||   // CJK Symbols
      (cp >= 0xFF00 && cp <= 0xFFEF)      // Halfwidth/Fullwidth
    )) {
      cjk++;
    }
  }
  const ratio = cjk / text.length;
  if (ratio > CJK_RATIO_THRESHOLD) return 'zh';
  if (ratio < CODE_INDICATOR_RATIO_THRESHOLD) {
    // 检查是否以代码为主（包含大量符号、缩进等）
    const codeIndicators = (text.match(/[{}\[\]();=<>\/\\]/g) || []).length;
    if (codeIndicators > text.length * CODE_INDICATOR_RATIO_THRESHOLD) return 'code';
    return 'en';
  }
  return 'mixed';
}

/** 估算纯文本字符串的 token 数（使用通用比率 3.0）。 */
export function estimateTokens(text: string): number {
  return text.length / CHARS_PER_TOKEN;
}

/**
 * 模型感知的 token 估算，根据文本内容检测语言类型并选用不同的比率。
 *
 * @param text 待估算的文本
 * @param model 可选模型名，用于未来扩展精确 tokenizer（如 tiktoken）
 */
export function estimateTokensModelAware(text: string, model?: string): number {
  const mode = detectTextMode(text);
  const ratio = CHARS_PER_TOKEN_BY_LANG[mode] ?? CHARS_PER_TOKEN;
  return text.length / ratio;
}

/** 四舍五入到最接近的整数 token。 */
export function roundTokens(text: string): number {
  return Math.round(estimateTokens(text));
}

/**
 * 模型感知的 token 估算（四舍五入）。
 */
export function roundTokensModelAware(text: string, model?: string): number {
  return Math.round(estimateTokensModelAware(text, model));
}

// ---------------------------------------------------------------------------
// Tool classification
// ---------------------------------------------------------------------------

/** Returns true if the tool name indicates a sub-agent spawn. */
export function isSubAgentTool(name: string): boolean {
  return name === 'Agent' || name === 'Workflow';
}

/** Returns true if the tool name is a Task-management command
 *  (TaskCreate, TaskUpdate, etc.), NOT a sub-agent spawn. */
export function isTaskTool(name: string): boolean {
  return name.startsWith('Task');
}

// ---------------------------------------------------------------------------
// Content extraction
// ---------------------------------------------------------------------------

/** Extract plain text from message content (`string | ContentBlock[]`).
 *  Adds per-block JSON wrapper overhead (`BLOCK_WRAPPER_CHARS`) and recurses
 *  into nested `tool_result` blocks. Used by compute-context and compute-timeline. */
export function extractContentText(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content;
  let result = '';
  for (const block of content) {
    if (block.type === 'text') {
      result += block.text;
      result += ' '.repeat(BLOCK_WRAPPER_CHARS);
    } else if (block.type === 'tool_result') {
      result += extractContentText(block.content);
    }
  }
  return result;
}

/** Extract plain prompt text from a user line's message content.
 *  Unlike `extractContentText`, this strips tool_result blocks and returns
 *  only user-visible text without wrapper overhead. */
export function extractPromptText(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content;
  const texts = content
    .filter((b): b is ContentBlock & { type: 'text' } => b.type === 'text')
    .map((b) => b.text);
  return texts.join('\n');
}
