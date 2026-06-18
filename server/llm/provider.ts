/**
 * provider.ts
 *
 * 零依赖 LLM Provider — 用 Node 原生 fetch 调用 Anthropic Messages API。
 * 兼容 DeepSeek 端点 (api.deepseek.com/anthropic) 和 Anthropic 官方 API。
 *
 * 环境变量：
 *   LLM_BASE_URL  — API 基础地址，默认 https://api.deepseek.com/anthropic
 *   LLM_API_KEY    — API 密钥（必填）
 *   LLM_MODEL      — 模型名，默认 deepseek-v4-pro
 */

// ── 配置 ──────────────────────────────────────────────────────────────────────

function getConfig(overrides?: { baseUrl?: string; apiKey?: string; model?: string }) {
  const baseUrl = overrides?.baseUrl || process.env.LLM_BASE_URL || 'https://api.deepseek.com/anthropic';
  const apiKey = overrides?.apiKey || process.env.LLM_API_KEY;
  const model = overrides?.model || process.env.LLM_MODEL || 'deepseek-v4-pro';

  if (!apiKey) {
    throw new Error(
      '请设置环境变量 LLM_API_KEY。例如: export LLM_API_KEY=sk-...',
    );
  }

  return { baseUrl, apiKey, model };
}

// ── 类型 ──────────────────────────────────────────────────────────────────────

export interface ChatUsage {
  input: number;
  output: number;
}

export interface ChatResult {
  text: string;
  usage: ChatUsage;
}

// ── API 调用 ──────────────────────────────────────────────────────────────────

/**
 * 调用 Anthropic Messages API（兼容 DeepSeek 端点）。
 *
 * @param system    — 系统提示
 * @param messages  — 用户/助手消息列表
 * @param overrides — 可选，覆盖环境变量中的配置
 * @returns LLM 响应文本和 token 用量
 */
export async function chat(
  system: string,
  messages: { role: 'user' | 'assistant'; content: string }[],
  overrides?: { baseUrl?: string; apiKey?: string; model?: string },
): Promise<ChatResult> {
  const { baseUrl, apiKey, model } = getConfig(overrides);

  // 构建 Anthropic Messages API 请求体
  const body = {
    model,
    max_tokens: 32000,
    system: [{ type: 'text' as const, text: system }],
    messages: messages.map((m) => ({
      role: m.role,
      content: [{ type: 'text', text: m.content }],
    })),
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300_000); // 5 分钟

  try {
    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      let errorBody = '';
      try {
        errorBody = await response.text();
      } catch {
        // ignore
      }
      throw new Error(
        `LLM API 返回错误 ${response.status}: ${errorBody || response.statusText}`,
      );
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text?: string }>;
      usage?: { input_tokens: number; output_tokens: number };
    };

    const textBlock = data.content?.find((b) => b.type === 'text');
    const text = textBlock?.text || '';

    return {
      text,
      usage: {
        input: data.usage?.input_tokens ?? 0,
        output: data.usage?.output_tokens ?? 0,
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}
