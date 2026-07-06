import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test, { mock } from 'node:test';
import express from 'express';

let hashLookups = 0;

mock.module('../repositories/session-repository', {
  namedExports: {
    getAllScannedFiles: () => [],
    upsertScannedFile: () => {},
    clearScannedFiles: () => {},
    getAllImportedFilenames: () => [],
    findSessionByHash: () => (++hashLookups === 1 ? undefined : { id: 'existing-session' }),
  },
});

mock.module('../services/pipeline-service', {
  namedExports: {
    createSession: async () => {
      const err = new Error('UNIQUE constraint failed: sessions.file_hash') as Error & { code: string };
      err.code = 'SQLITE_CONSTRAINT_UNIQUE';
      throw err;
    },
  },
});

const { default: scannerRouter } = await import('./scanner');

async function listen(app: express.Express) {
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server;
}

test('import returns existing session when raced insert hits file_hash constraint', async () => {
  hashLookups = 0;
  const dir = await mkdtemp(join(tmpdir(), 'scanner-import-race-'));
  const filePath = join(dir, 'session.jsonl');
  await writeFile(filePath, JSON.stringify({ type: 'user', message: { role: 'user', content: 'hello' } }) + '\n');

  const app = express();
  app.use(express.json());
  app.use('/scanner', scannerRouter);
  const server = await listen(app);

  try {
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/scanner/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: filePath }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      imported: false,
      sessionId: 'existing-session',
      message: '会话已存在',
    });
    assert.equal(hashLookups, 2);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
