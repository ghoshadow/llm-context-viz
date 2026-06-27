const DEFAULT_TRANSLATION_MODEL = 'deepseek-v4-flash';
const DEFAULT_TRANSLATION_REQUEST_URL = 'https://api.deepseek.com/chat/completions';

const TRANSLATION_SYSTEM_PROMPT = `你是一位专业的技术文档翻译。请将以下英文技术文档翻译成中文，遵循以下规则：

1. 保留所有 Markdown 格式（标题、列表、代码块、行内代码等）
2. 保留所有技术术语和占位符不变（如 \`file_path:line_number\`、\`<system-reminder>\`、\`/<skill-name>\` 等）
3. 保留所有代码示例和路径不变
4. 保留 YAML frontmatter 结构不变
5. 专有名词（如 Claude Code、GitHub-flavored markdown、Playwright 等）不翻译
6. 翻译要准确、流畅，符合中文技术文档风格
7. 直接输出翻译结果，不要添加任何解释或说明`;

interface TranslationEnv {
  DEEPSEEK_API_KEY?: string;
  LLM_API_KEY?: string;
  LLM_BASE_URL?: string;
  TRANSLATION_API_KEY?: string;
  TRANSLATION_BASE_URL?: string;
  TRANSLATION_MAX_TOKENS?: string;
  TRANSLATION_MODEL?: string;
}

export interface TranslationRequestConfig {
  apiKey: string;
  requestUrl: string;
  model: string;
  maxTokens?: number;
}

export interface TranslationCallOptions {
  env?: TranslationEnv;
  fetchImpl?: typeof fetch;
}

export function resolveTranslationRequestConfig(env: TranslationEnv = process.env): TranslationRequestConfig {
  const apiKey = env.TRANSLATION_API_KEY || env.DEEPSEEK_API_KEY || env.LLM_API_KEY;
  if (!apiKey) throw new Error('未设置 TRANSLATION_API_KEY、DEEPSEEK_API_KEY 或 LLM_API_KEY 环境变量');

  return {
    apiKey,
    requestUrl: normalizeChatCompletionsUrl(env.TRANSLATION_BASE_URL || DEFAULT_TRANSLATION_REQUEST_URL),
    model: env.TRANSLATION_MODEL || DEFAULT_TRANSLATION_MODEL,
    maxTokens: parseOptionalPositiveInteger(env.TRANSLATION_MAX_TOKENS),
  };
}

export async function callTranslationLLM(
  prompt: string,
  options: TranslationCallOptions = {},
): Promise<string> {
  const config = resolveTranslationRequestConfig(options.env ?? process.env);
  const fetchImpl = options.fetchImpl ?? fetch;
  const requestBody: Record<string, unknown> = {
    model: config.model,
    messages: [
      { role: 'system', content: TRANSLATION_SYSTEM_PROMPT },
      { role: 'user', content: `请翻译以下文本：\n\n${prompt}` },
    ],
    stream: false,
  };

  if (config.maxTokens !== undefined) {
    requestBody.max_tokens = config.maxTokens;
  }

  const response = await fetchImpl(config.requestUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  const raw = await response.text();
  let body: any = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = null;
  }

  if (!response.ok) {
    const message = body?.error?.message || body?.message || raw || response.statusText;
    throw new Error(`翻译 API 请求失败 (${response.status}): ${message}`);
  }

  const choice = body?.choices?.[0];
  if (choice?.finish_reason === 'length') {
    throw new Error('翻译 API 返回被截断: length');
  }

  const result = typeof choice?.message?.content === 'string' ? choice.message.content.trim() : '';
  if (!result) throw new Error('LLM 未返回结果');
  return result;
}

function normalizeChatCompletionsUrl(url: string): string {
  const normalized = url.replace(/\/+$/, '');
  if (normalized.endsWith('/chat/completions')) return normalized;
  return `${normalized}/chat/completions`;
}

function parseOptionalPositiveInteger(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}
