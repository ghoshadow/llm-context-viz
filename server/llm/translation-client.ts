const DEFAULT_TRANSLATION_MODEL = 'deepseek-v4-flash';
const DEFAULT_TRANSLATION_BASE_URL = 'https://api.deepseek.com/anthropic';
const ANTHROPIC_VERSION = '2023-06-01';

interface TranslationEnv {
  LLM_API_KEY?: string;
  LLM_BASE_URL?: string;
}

export interface TranslationRequestConfig {
  apiKey: string;
  baseUrl: string;
  messagesUrl: string;
  model: string;
}

export interface TranslationCallOptions {
  env?: TranslationEnv;
  fetchImpl?: typeof fetch;
}

export function resolveTranslationRequestConfig(env: TranslationEnv = process.env): TranslationRequestConfig {
  const apiKey = env.LLM_API_KEY;
  if (!apiKey) throw new Error('未设置 LLM_API_KEY 环境变量');

  const baseUrl = (env.LLM_BASE_URL || DEFAULT_TRANSLATION_BASE_URL).replace(/\/+$/, '');
  return {
    apiKey,
    baseUrl,
    messagesUrl: `${baseUrl}/v1/messages`,
    model: DEFAULT_TRANSLATION_MODEL,
  };
}

export async function callTranslationLLM(
  prompt: string,
  options: TranslationCallOptions = {},
): Promise<string> {
  const config = resolveTranslationRequestConfig(options.env ?? process.env);
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(config.messagesUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 4096,
      messages: [
        { role: 'user', content: prompt },
      ],
    }),
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

  const result = extractAnthropicText(body);
  if (!result) throw new Error('LLM 未返回结果');
  return result;
}

function extractAnthropicText(body: any): string {
  const content = body?.content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => block?.type === 'text' && typeof block.text === 'string' ? block.text : '')
    .filter(Boolean)
    .join('\n')
    .trim();
}
