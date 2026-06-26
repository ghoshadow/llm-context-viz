// ============================================================================
// Shared pipeline utilities — eliminates duplicated helpers across stage files.
// ============================================================================

import type { ContentBlock } from '../types/session';
import { BLOCK_WRAPPER_CHARS } from './constants';

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

/** Chars-per-token ratio. DeepSeek official: English ~3.33, Chinese ~1.67.
 *  3.0 is a weighted average for Claude Code sessions (mostly English/code). */
export const CHARS_PER_TOKEN = 3.0;

/** Estimate token count from a raw text string. */
export function estimateTokens(text: string): number {
  return text.length / CHARS_PER_TOKEN;
}

/** Round token estimate to nearest integer. */
export function roundTokens(text: string): number {
  return Math.round(estimateTokens(text));
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
