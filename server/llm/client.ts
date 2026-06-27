/**
 * client.ts — shared LLM invocation helper.
 *
 * Eliminates the duplicated query() boilerplate that was copy-pasted between
 * routes/sessions.ts (translate) and services/card-summary.ts (summary).
 */

import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';

const DEFAULT_MODEL = 'deepseek-v4-pro';
const DEFAULT_BASE_URL = 'https://api.deepseek.com/anthropic';

export interface LLMCallOptions {
  model?: string;
}

export function resolveLLMRequestConfig(
  env: Pick<NodeJS.ProcessEnv, 'LLM_MODEL' | 'LLM_BASE_URL'>,
  options: LLMCallOptions = {},
): { model: string; baseUrl: string } {
  return {
    model: options.model || env.LLM_MODEL || DEFAULT_MODEL,
    baseUrl: env.LLM_BASE_URL || DEFAULT_BASE_URL,
  };
}

/**
 * Send a single-turn prompt to the LLM and return the concatenated text reply.
 *
 * Throws if LLM_API_KEY is not set or the model returns an empty response.
 * The caller is responsible for catching errors and translating them into
 * appropriate HTTP responses.
 */
export async function callLLM(prompt: string, options: LLMCallOptions = {}): Promise<string> {
  const { model, baseUrl } = resolveLLMRequestConfig(process.env, options);
  const apiKey = process.env.LLM_API_KEY;

  if (!apiKey) throw new Error('未设置 LLM_API_KEY 环境变量');

  const q = query({
    prompt,
    options: {
      model,
      maxTurns: 1,
      thinking: { type: 'disabled' as const },
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: apiKey,
        ANTHROPIC_BASE_URL: baseUrl,
      } as Record<string, string>,
    },
  });

  const chunks: string[] = [];
  for await (const msg of q) {
    if (msg.type !== 'assistant') continue;
    const am = msg as SDKMessage & { type: 'assistant'; message?: { content?: unknown[] } };
    for (const block of am.message?.content || []) {
      const b = block as { type?: string; text?: string };
      if (b.type === 'text' && b.text) chunks.push(b.text);
    }
  }

  const result = chunks.join('\n').trim();
  if (!result) throw new Error('LLM 未返回结果');
  return result;
}
