import assert from 'node:assert/strict';
import test from 'node:test';
import { consumeSSE } from './sse';

function streamFromText(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

test('reconnect sends Last-Event-ID from the last received SSE id', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ headers: Record<string, string> }> = [];
  try {
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push({ headers: init?.headers as Record<string, string> });
      if (calls.length === 1) {
        return new Response(streamFromText(
          'id: evt-1\n' +
          'event: shard-start\n' +
          'data: {"shardIndex":1}\n\n',
        ), { status: 200 });
      }
      return new Response(streamFromText(
        'id: evt-2\n' +
        'event: complete\n' +
        'data: {"sessionId":"s1","meta":{},"stats":{},"data":{}}\n\n',
      ), { status: 200 });
    }) as typeof fetch;

    await consumeSSE('/api/test', {}, {}, { maxRetries: 1, maxBufferSize: 0 });

    assert.equal(calls.length, 2);
    assert.equal(calls[0]!.headers['Last-Event-ID'], undefined);
    assert.equal(calls[1]!.headers['Last-Event-ID'], 'evt-1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
