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
    rootDir: string;
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

/**
 * Consume a Server-Sent Events stream from a POST endpoint.
 *
 * @param url      - The endpoint URL.
 * @param body     - JSON-serialisable request body.
 * @param handlers - Callbacks for each SSE event type.
 * @param signal   - Optional AbortSignal for cancellation.
 */
export async function consumeSSE(
  url: string,
  body: Record<string, unknown>,
  handlers: SSEHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    let errorBody = '';
    try {
      errorBody = await response.text();
    } catch {
      // ignore — response body may not be readable
    }
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

  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent: string | null = null;
  let currentData: string | null = null;
  let closedCleanly = false;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete lines
      const lines = buffer.split('\n');
      // The last element may be an incomplete line — keep it in the buffer
      buffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;

        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          currentData = line.slice(6);
        } else if (line === '' || line === '\r') {
          // Empty line signals end of event
          if (currentEvent && currentData !== null) {
            dispatchEvent(currentEvent, currentData, handlers);
            if (currentEvent === 'complete' || currentEvent === 'error') {
              closedCleanly = true;
            }
          }
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
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        currentData = line.slice(6);
      }
    }

    // Flush the last pending event if any
    if (currentEvent && currentData !== null) {
      dispatchEvent(currentEvent, currentData, handlers);
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
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      // Aborted by caller — not an error
      return;
    }
    handlers.onError?.({
      stage: 'stream',
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Lock may already be released
    }
  }
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
        totalTurns: d.totalTurns as number,
        shardCount: d.shardCount as number,
        rootDir: d.rootDir as string,
        shards: d.shards as Array<{
          index: number;
          filename: string;
          turnRange: string;
          turnCount: number;
        }>,
      });
      break;
    case 'start':
      handlers.onStart?.({
        shards: d.shards as number,
        totalTurns: d.totalTurns as number,
      });
      break;
    case 'shard-start':
      handlers.onShardStart?.({ shardIndex: d.shardIndex as number });
      break;
    case 'shard-done':
      handlers.onShardDone?.({
        shardIndex: d.shardIndex as number,
        candidates: d.candidates,
        relations: d.relations,
      });
      break;
    case 'shard-retry':
      handlers.onShardRetry?.({
        shardIndex: d.shardIndex as number,
        attempt: d.attempt as number,
      });
      break;
    case 'shard-error':
      handlers.onShardError?.({
        shardIndex: d.shardIndex as number,
        error: d.error as string,
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
        sessionId: d.sessionId as string,
        meta: d.meta,
        stats: d.stats,
        data: d.data,
      });
      break;
    case 'error':
      handlers.onError?.({
        stage: d.stage as string,
        message: d.message as string,
        detail: d.detail as string | undefined,
      });
      break;
    default:
      // Unknown event type — silently ignored per SSE spec
      break;
  }
}
