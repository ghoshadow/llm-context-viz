import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test, { mock } from 'node:test';
import express from 'express';

let hashLookups = 0;
let scannedRows: Array<Record<string, unknown>> = [];

mock.module('../repositories/session-repository', {
  namedExports: {
    getAllScannedFiles: () => scannedRows,
    upsertScannedFile: () => {},
    clearScannedFiles: () => { scannedRows = []; },
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

function toJsonl(lines: unknown[]): string {
  return lines.map((line) => JSON.stringify(line)).join('\n');
}

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

test('scan infers OpenCode and Pi sources from custom JSONL paths', async () => {
  scannedRows = [];
  const dir = await mkdtemp(join(tmpdir(), 'scanner-sources-'));
  await writeFile(join(dir, 'opencode.jsonl'), toJsonl([
    { type: 'step_start', timestamp: 1767036059338, sessionID: 'ses_open', part: { type: 'step-start' } },
    { type: 'text', timestamp: 1767036064268, sessionID: 'ses_open', part: { type: 'text', text: 'OpenCode reply' } },
    { type: 'step_finish', timestamp: 1767036064273, sessionID: 'ses_open', part: { type: 'step-finish', tokens: { input: 12, output: 3 } } },
  ]));
  await writeFile(join(dir, 'pi.jsonl'), toJsonl([
    { type: 'header', version: 3, workingDirectory: '/repo/pi' },
    { type: 'message', id: 'u1', parentId: null, message: { role: 'user', content: [{ type: 'text', text: 'Pi prompt' }] } },
    { type: 'message', id: 'a1', parentId: 'u1', message: { role: 'assistant', content: [{ type: 'text', text: 'Pi reply' }] } },
  ]));

  const app = express();
  app.use(express.json());
  app.use('/scanner', scannerRouter);
  const server = await listen(app);

  try {
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/scanner/scan?paths=${encodeURIComponent(dir)}&depth=1&force=1`);
    assert.equal(response.status, 200);

    const body = await response.json() as { files: Array<{ name: string; source: string; turnCount: number; requests: number; peakTokens: number }> };
    const byName = new Map(body.files.map((file) => [file.name, file]));

    assert.equal(byName.get('opencode.jsonl')?.source, 'opencode');
    assert.equal(byName.get('opencode.jsonl')?.requests, 1);
    assert.equal(byName.get('opencode.jsonl')?.peakTokens, 12);
    assert.equal(byName.get('pi.jsonl')?.source, 'pi');
    assert.equal(byName.get('pi.jsonl')?.turnCount, 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});

test('scan keeps cached OpenCode and Pi sources from cached model metadata', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'scanner-cache-sources-'));
  const openCodePath = join(dir, 'opencode.jsonl');
  const piPath = join(dir, 'pi.jsonl');
  await writeFile(openCodePath, '{}\n');
  await writeFile(piPath, '{}\n');
  const [openCodeStat, piStat] = await Promise.all([stat(openCodePath), stat(piPath)]);
  scannedRows = [
    {
      path: openCodePath,
      title: 'cached opencode',
      model: 'opencode',
      requests: 1,
      peak_tokens: 12,
      turn_count: 1,
      cwd: '',
      hash: 'hash-open',
      modified: openCodeStat.mtime.toISOString(),
    },
    {
      path: piPath,
      title: 'cached pi',
      model: 'pi',
      requests: 1,
      peak_tokens: 9,
      turn_count: 1,
      cwd: '',
      hash: 'hash-pi',
      modified: piStat.mtime.toISOString(),
    },
  ];

  const app = express();
  app.use(express.json());
  app.use('/scanner', scannerRouter);
  const server = await listen(app);

  try {
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/scanner/scan?paths=${encodeURIComponent(dir)}&depth=1`);
    assert.equal(response.status, 200);

    const body = await response.json() as { files: Array<{ name: string; source: string }> };
    const byName = new Map(body.files.map((file) => [file.name, file]));

    assert.equal(byName.get('opencode.jsonl')?.source, 'opencode');
    assert.equal(byName.get('pi.jsonl')?.source, 'pi');
  } finally {
    scannedRows = [];
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
