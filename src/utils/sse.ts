/**
 * SSE (Server-Sent Events) consumer utility.
 *
 * POSTs a JSON body to a streaming endpoint and dispatches parsed events
 * to the provided handler callbacks.
 */

export interface SSEHandlers {
  onExtracted?: (data: {
    totalTurns: number;
    shardCount: number;
    activeShards?: number;
    rootDir: string;
    extractionDepth?: 'refined' | 'deep';
    shardSize?: number;
    maxShardChars?: number;
    shards: Array<{
      index: number;
      filename: string;
      turnRange: string;
      turnCount: number;
    }>;
  }) => void;
  onStart?: (data: { shards: number; totalTurns: number }) => void;
  onShardStart?: (data: { shardIndex: number }) => void;
  onShardDone?: (data: {
    shardIndex: number;
    candidates: unknown;
    relations: unknown;
  }) => void;
  onShardRetry?: (data: { shardIndex: number; attempt: number }) => void;
  onShardError?: (data: { shardIndex: number; error: string }) => void;
  onMerge?: (data: { candidates: unknown; relations: unknown }) => void;
  onBuild?: () => void;
  onComplete?: (data: {
    sessionId: string;
    meta: unknown;
    stats: unknown;
    data: unknown;
  }) => void;
  onError?: (data: { stage: string; message: string; detail?: string }) => void;
}

export interface SSEConsumeOptions {
  /** 指数退避重连最大次数，默认 3 */
  maxRetries?: number;
  /** 缓冲区最大字节数，超过时清理旧数据，0 表示不限制，默认 512KB */
  maxBufferSize?: number;
  /** 外部 AbortSignal 用于取消 */
  signal?: AbortSignal;
}

/** 默认最大重试次数 */
const DEFAULT_MAX_RETRIES = 3;
/** 指数退避重试间隔（毫秒） */
const RETRY_BACKOFF_MS = [1_000, 2_000, 4_000];
/** 默认缓冲区最大字节数 */
const DEFAULT_MAX_BUFFER_SIZE = 512 * 1024; // 512KB

/**
 * Consume a Server-Sent Events stream from a POST endpoint.
 *
 * 支持指数退避断线重连，缓冲区上限管理。
 *
 * @param url      - The endpoint URL.
 * @param body     - JSON-serialisable request body.
 * @param handlers - Callbacks for each SSE event type.
 * @param options  - 可选配置：重连次数、缓冲区上限、AbortSignal
 */
export async function consumeSSE(
  url: string,
  body: Record<string, unknown>,
  handlers: SSEHandlers,
  options?: SSEConsumeOptions,
): Promise<void> {
  await consumeSSEWithRetry(url, body, handlers, options ?? {});
}

/**
 * 内部实现：带重连的 SSE 消费
 */
async function consumeSSEWithRetry(
  url: string,
  body: Record<string, unknown>,
  handlers: SSEHandlers,
  options: SSEConsumeOptions,
): Promise<void> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const maxBufferSize = options.maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE;
  const signal = options.signal;
  let lastEventId: string | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // 检查是否已被取消
    if (signal?.aborted) return;

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      };
      // 断线重连时发送 Last-Event-ID
      if (lastEventId) {
        headers['Last-Event-ID'] = lastEventId;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
      });

      if (!response.ok) {
        const errorBody = await readErrorBody(response);
        const detail = errorBody
          ? `HTTP ${response.status}: ${errorBody}`
          : `HTTP ${response.status}: ${response.statusText}`;
        handlers.onError?.({
          stage: 'connect',
          message: `Request failed with status ${response.status}`,
          detail,
        });
        throw new Error(detail);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        handlers.onError?.({
          stage: 'connect',
          message: 'Response body is not readable',
        });
        return;
      }

      // 流式处理，如果正常完成（收到 complete/error 事件）则返回
      const streamResult = await readSSEStream(reader, handlers, maxBufferSize);
      reader.releaseLock();
      if (streamResult.lastEventId) {
        lastEventId = streamResult.lastEventId;
      }

      if (streamResult.status === 'finished') {
        return; // 正常结束
      }

      // streamResult.status === 'disconnected'：流异常断开，进入重连逻辑
      if (attempt < maxRetries) {
        handlers.onError?.({
          stage: 'stream',
          message: `连接中断，${(RETRY_BACKOFF_MS[attempt] ?? 8000) / 1000}s 后重连（第 ${attempt + 1} 次）`,
        });
        await sleep(RETRY_BACKOFF_MS[attempt] ?? 8000);
        continue;
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // Aborted by caller — not an error
        return;
      }

      if (attempt < maxRetries) {
        handlers.onError?.({
          stage: 'stream',
          message: err instanceof Error ? err.message : String(err),
          detail: `${(RETRY_BACKOFF_MS[attempt] ?? 8000) / 1000}s 后重连（第 ${attempt + 1} 次）`,
        });
        await sleep(RETRY_BACKOFF_MS[attempt] ?? 8000);
        continue;
      }

      // 所有重试已用尽
      handlers.onError?.({
        stage: 'stream',
        message: `连接失败，已达最大重试次数 (${maxRetries}): ${err instanceof Error ? err.message : String(err)}`,
      });
      throw err;
    }
  }

  // 所有重试已用尽
  handlers.onError?.({
    stage: 'stream',
    message: `重连失败，已达最大重试次数 (${maxRetries})`,
  });
}

/**
 * 读取 SSE 流并分发事件，返回 'finished'（正常完成）或 'disconnected'（异常断开）
 */
async function readSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  handlers: SSEHandlers,
  maxBufferSize: number,
): Promise<{ status: 'finished' | 'disconnected'; lastEventId: string | null }> {
  const decoder = new TextDecoder();
  let buffer = '';
  let currentId: string | null = null;
  let lastEventId: string | null = null;
  let currentEvent: string | null = null;
  let currentData: string | null = null;
  let closedCleanly = false;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // 限制缓冲区最大大小，防止内存无限增长
      if (maxBufferSize > 0 && buffer.length > maxBufferSize) {
        // 保留后半部分，丢弃前半部分
        const keepStart = buffer.length - Math.floor(maxBufferSize / 2);
        buffer = buffer.slice(keepStart);
      }

      // Process complete lines
      const lines = buffer.split('\n');
      // The last element may be an incomplete line — keep it in the buffer
      buffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;

        if (line.startsWith('id: ')) {
          currentId = line.slice(4).trim();
        } else if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          currentData = line.slice(6);
        } else if (line === '' || line === '\r') {
          // Empty line signals end of event
          if (currentEvent && currentData !== null) {
            dispatchEvent(currentEvent, currentData, handlers);
            if (currentId) lastEventId = currentId;
            if (currentEvent === 'complete' || currentEvent === 'error') {
              closedCleanly = true;
            }
          }
          currentId = null;
          currentEvent = null;
          currentData = null;
        }
        // Lines starting with ":" are comments per SSE spec — ignored
      }
    }

    // Flush any remaining partial line in the buffer after stream ends
    if (buffer.length > 0) {
      const line =
        buffer.endsWith('\r') ? buffer.slice(0, -1).trim() : buffer.trim();
      if (line.startsWith('id: ')) {
        currentId = line.slice(4).trim();
      } else if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        currentData = line.slice(6);
      }
    }

    // Flush the last pending event if any
    if (currentEvent && currentData !== null) {
      dispatchEvent(currentEvent, currentData, handlers);
      if (currentId) lastEventId = currentId;
      if (currentEvent === 'complete' || currentEvent === 'error') {
        closedCleanly = true;
      }
    }

    // Connection closed without complete or error event
    if (!closedCleanly) {
      handlers.onError?.({
        stage: 'stream',
        message: 'Connection closed unexpectedly before receiving complete or error event',
      });
    }

    return { status: closedCleanly ? 'finished' : 'disconnected', lastEventId };
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { status: 'finished', lastEventId }; // 被取消视为正常结束
    }
    handlers.onError?.({
      stage: 'stream',
      message: err instanceof Error ? err.message : String(err),
    });
    return { status: 'disconnected', lastEventId };
  }
}

/** Helper: safely extract a number from parsed SSE JSON. */
function asNumber(v: unknown): number {
  return typeof v === 'number' ? v : 0;
}

/** Helper: safely extract a string from parsed SSE JSON. */
function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Helper: safely extract a number or undefined from parsed SSE JSON. */
function asOptionalNumber(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}

/** Helper: safely extract a string or undefined from parsed SSE JSON. */
function asOptionalString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/**
 * Parse the JSON data string and route to the matching handler.
 */
function dispatchEvent(
  event: string,
  data: string,
  handlers: SSEHandlers,
): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    handlers.onError?.({
      stage: 'parse',
      message: `Failed to parse JSON for event "${event}"`,
      detail: data,
    });
    return;
  }

  const d = parsed as Record<string, unknown>;

  switch (event) {
    case 'extracted':
      handlers.onExtracted?.({
        totalTurns: asNumber(d.totalTurns),
        shardCount: asNumber(d.shardCount),
        activeShards: asOptionalNumber(d.activeShards),
        rootDir: asString(d.rootDir),
        extractionDepth: typeof d.extractionDepth === 'string' && (d.extractionDepth === 'refined' || d.extractionDepth === 'deep') ? d.extractionDepth : undefined,
        shardSize: asOptionalNumber(d.shardSize),
        maxShardChars: asOptionalNumber(d.maxShardChars),
        shards: Array.isArray(d.shards) ? d.shards as Array<{
          index: number;
          filename: string;
          turnRange: string;
          turnCount: number;
        }> : [],
      });
      break;
    case 'start':
      handlers.onStart?.({
        shards: asNumber(d.shards),
        totalTurns: asNumber(d.totalTurns),
      });
      break;
    case 'shard-start':
      handlers.onShardStart?.({ shardIndex: asNumber(d.shardIndex) });
      break;
    case 'shard-done':
      handlers.onShardDone?.({
        shardIndex: asNumber(d.shardIndex),
        candidates: d.candidates,
        relations: d.relations,
      });
      break;
    case 'shard-retry':
      handlers.onShardRetry?.({
        shardIndex: asNumber(d.shardIndex),
        attempt: asNumber(d.attempt),
      });
      break;
    case 'shard-error':
      handlers.onShardError?.({
        shardIndex: asNumber(d.shardIndex),
        error: asString(d.error),
      });
      break;
    case 'merge':
      handlers.onMerge?.({
        candidates: d.candidates,
        relations: d.relations,
      });
      break;
    case 'build':
      handlers.onBuild?.();
      break;
    case 'complete':
      handlers.onComplete?.({
        sessionId: asString(d.sessionId),
        meta: d.meta,
        stats: d.stats,
        data: d.data,
      });
      break;
    case 'error':
      handlers.onError?.({
        stage: asString(d.stage),
        message: asString(d.message),
        detail: asOptionalString(d.detail),
      });
      break;
    default:
      // Unknown event type — silently ignored per SSE spec
      break;
  }
}

/** 异步 sleep，用于指数退避等待 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 安全读取 HTTP 错误响应正文 */
async function readErrorBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}
