/**
 * client.ts — 共享 LLM 调用助手。
 *
 * 消除 routes/sessions.ts（translate）和 services/card-summary.ts（summary）
 * 中重复的 query() 模板代码。
 *
 * 安全：
 * - 用户数据通过 `<user_data>...</user_data>` XML 标签与系统指令分层，防止 Prompt 注入
 * - process.env 只传递白名单变量，禁止全量展开泄漏凭据
 */

import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { DEFAULT_MODEL, DEFAULT_BASE_URL, buildSafeEnv } from './config';

export interface LLMCallOptions {
  model?: string;
}

type LLMRequestEnv = Partial<Pick<NodeJS.ProcessEnv, 'LLM_MODEL' | 'LLM_BASE_URL'>>;

export function resolveLLMRequestConfig(
  env: LLMRequestEnv,
  options: LLMCallOptions = {},
): { model: string; baseUrl: string } {
  return {
    model: options.model || env.LLM_MODEL || DEFAULT_MODEL,
    baseUrl: env.LLM_BASE_URL || DEFAULT_BASE_URL,
  };
}

/**
 * 将用户来源数据用 XML 标签包裹，与系统指令明确分层，防止 Prompt 注入。
 */
export function wrapUserData(text: string): string {
  return `<user_data>\n${text}\n</user_data>`;
}

/**
 * 发送结构化 prompt（system + user 分层）到 LLM 并返回拼接的文本回复。
 *
 * 如果未设置 LLM_API_KEY 或模型返回空响应，则抛出错误。
 * 调用方负责捕获错误并将其转换为适当的 HTTP 响应。
 */
export async function callLLM(prompt: string, options: LLMCallOptions = {}): Promise<string> {
  return callLLMStructured({ user: prompt }, options);
}

/**
 * 发送结构化 prompt（system + user 分层）到 LLM 并返回拼接的文本回复。
 *
 * 与 callLLM 不同，此函数将系统指令和用户数据分开传递，
 * 用户数据会自动用 `<user_data>...</user_data>` 包裹以防止注入。
 */
export async function callLLMStructured(
  parts: { system?: string; user: string },
  options: LLMCallOptions = {},
): Promise<string> {
  const { model, baseUrl } = resolveLLMRequestConfig(process.env, options);
  const apiKey = process.env.LLM_API_KEY;

  if (!apiKey) throw new Error('未设置 LLM_API_KEY 环境变量');

  // 构建安全 prompt：系统指令与用户数据分层
  let fullPrompt = parts.system ? `${parts.system}\n\n` : '';
  fullPrompt += wrapUserData(parts.user);

  const q = query({
    prompt: fullPrompt,
    options: {
      model,
      maxTurns: 1,
      thinking: { type: 'disabled' as const },
      permissionMode: 'default',
      env: buildSafeEnv({
        ANTHROPIC_API_KEY: apiKey,
        ANTHROPIC_BASE_URL: baseUrl,
      }),
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
