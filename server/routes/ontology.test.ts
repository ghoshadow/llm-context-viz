import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { startSseHeartbeat } from './ontology';

test('SSE heartbeat writes keepalive frames until stopped', () => {
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    const chunks: string[] = [];
    const res = {
      destroyed: false,
      writableEnded: false,
      write(chunk: string) {
        chunks.push(chunk);
        return true;
      },
    };

    const stopHeartbeat = startSseHeartbeat(res, 1000);

    mock.timers.tick(1000);
    assert.deepEqual(chunks, [': keepalive\n\n']);

    stopHeartbeat();
    mock.timers.tick(1000);
    assert.deepEqual(chunks, [': keepalive\n\n']);
  } finally {
    mock.timers.reset();
  }
});
