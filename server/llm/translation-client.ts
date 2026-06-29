const DEFAULT_TRANSLATION_MODEL = 'deepseek-v4-flash';
const DEFAULT_TRANSLATION_REQUEST_URL = 'https://api.deepseek.com/chat/completions';

/** 翻译 API 默认超时时间（毫秒） */
const DEFAULT_TRANSLATION_TIMEOUT_MS = 30_000;
/** 最大重试次数 */
const MAX_TRANSLATION_RETRIES = 3;
/** 指数退避重试间隔（毫秒），依次为 1s, 2s, 4s */
const RETRY_BACKOFF_MS = [1_000, 2_000, 4_000];

const TRANSLATION_SYSTEM_PROMPT = `你是一位专业的技术文档翻译。请将以下英文技术文档翻译成中文，遵循以下规则：

1. 保留所有 Markdown 格式（标题、列表、代码块、行内代码等）
2. 保留所有技术术语和占位符不变（如 \`file_path:line_number\`、\`<system-reminder>\`、\`/<skill-name>\` 等）
3. 保留所有代码示例和路径不变
4. 保留 YAML frontmatter 结构不变
5. 专有名词（如 Claude Code、GitHub-flavored markdown、Playwright 等）不翻译
6. 翻译要准确、流畅，符合中文技术文档风格
7. 直接输出翻译结果，不要添加任何解释或说明`;

interface TranslationEnv {
  LLM_API_KEY?: string;
  LLM_BASE_URL?: string;
  /** Legacy env var intentionally ignored; translations use the shared LLM_API_KEY. */
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
  const apiKey = env.LLM_API_KEY;
  if (!apiKey) throw new Error('未设置 LLM_API_KEY 环境变量');

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

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_TRANSLATION_RETRIES; attempt++) {
    try {
      // 每次请求使用独立的 AbortSignal，默认 30 秒超时
      const timeoutMs = config.maxTokens
        ? Math.max(DEFAULT_TRANSLATION_TIMEOUT_MS, config.maxTokens * 4)
        : DEFAULT_TRANSLATION_TIMEOUT_MS;
      const signal = AbortSignal.timeout(timeoutMs);

      const response = await fetchImpl(config.requestUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal,
      });

      const raw = await response.text();
      let body: Record<string, unknown> | null = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = null;
      }

      if (!response.ok) {
        const message = body?.error?.message || body?.message || raw || response.statusText;
        const statusCode = response.status;

        // 429 或 5xx 错误可重试
        if (attempt < MAX_TRANSLATION_RETRIES && (statusCode === 429 || statusCode >= 500)) {
          lastError = new Error(`翻译 API 请求失败 (${statusCode}): ${message}`);
          await sleep(RETRY_BACKOFF_MS[attempt] ?? 4_000);
          continue;
        }

        throw new Error(`翻译 API 请求失败 (${statusCode}): ${message}`);
      }

      const choice = body?.choices?.[0];
      if (choice?.finish_reason === 'length') {
        throw new Error('翻译 API 返回被截断: length');
      }

      const result = typeof choice?.message?.content === 'string' ? choice.message.content.trim() : '';
      if (!result) throw new Error('LLM 未返回结果');
      return result;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        // 超时错误：可重试
        if (attempt < MAX_TRANSLATION_RETRIES) {
          lastError = new Error(`翻译 API 请求超时 (${DEFAULT_TRANSLATION_TIMEOUT_MS / 1000}s)`);
          await sleep(RETRY_BACKOFF_MS[attempt] ?? 4_000);
          continue;
        }
        throw new Error(`翻译 API 请求超时，已达最大重试次数 (${MAX_TRANSLATION_RETRIES})`);
      }

      // 如果已经被包装成 Error（非重试场景），直接抛出
      if (err instanceof Error && err.message.startsWith('翻译 API')) {
        // 检查是否应该重试（上面 continue 的路径不会到达这里）
        if (lastError && attempt >= MAX_TRANSLATION_RETRIES) {
          throw err;
        }
        // 不可重试的错误直接抛出
        if (attempt >= MAX_TRANSLATION_RETRIES) {
          throw err;
        }
        lastError = err;
        // 检查是否是可重试的类型
        if (err.message.includes('超时') || err.message.includes('fetch')) {
          await sleep(RETRY_BACKOFF_MS[attempt] ?? 4_000);
          continue;
        }
        throw err;
      }

      // 网络级错误（如 fetch failed）可重试
      if (attempt < MAX_TRANSLATION_RETRIES) {
        lastError = err instanceof Error ? err : new Error(String(err));
        await sleep(RETRY_BACKOFF_MS[attempt] ?? 4_000);
        continue;
      }

      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  // 所有重试已用尽
  throw lastError || new Error('翻译 API 请求失败，未知原因');
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

/** 异步 sleep，用于指数退避等待 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
