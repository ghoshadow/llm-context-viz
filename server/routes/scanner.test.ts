import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test, { mock } from 'node:test';
import express from 'express';
import Database from 'better-sqlite3';

let hashLookups = 0;
let scannedRows: Array<Record<string, unknown>> = [];
let createSessionImpl: (opts: {
  jsonlContent: string;
  filename: string;
  hash: string;
  aiTitle?: string;
  rawJsonl?: string | null;
  source?: 'claude' | 'codex' | 'opencode' | 'pi' | 'openclaw';
}) => Promise<{
  sessionId: string;
  summary: { session: { model: string; requests: number; peakTokens: number } };
  turns: unknown[];
  errors: unknown[];
}>;

function resetCreateSessionImpl() {
  createSessionImpl = async () => {
    const err = new Error('UNIQUE constraint failed: sessions.file_hash') as Error & { code: string };
    err.code = 'SQLITE_CONSTRAINT_UNIQUE';
    throw err;
  };
}

resetCreateSessionImpl();

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
    createSession: (opts: Parameters<typeof createSessionImpl>[0]) => createSessionImpl(opts),
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

function createOpenCodeDb(dbPath: string) {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      directory TEXT NOT NULL,
      title TEXT NOT NULL,
      model TEXT,
      tokens_input INTEGER DEFAULT 0 NOT NULL,
      tokens_output INTEGER DEFAULT 0 NOT NULL,
      tokens_cache_read INTEGER DEFAULT 0 NOT NULL,
      tokens_cache_write INTEGER DEFAULT 0 NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL
    );
    CREATE TABLE message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      data TEXT NOT NULL
    );
    CREATE TABLE part (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      data TEXT NOT NULL
    );
  `);
  db.prepare(`
    INSERT INTO session (id, directory, title, model, tokens_input, tokens_output, tokens_cache_read, tokens_cache_write, time_created, time_updated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'ses_db',
    '/repo/opencode',
    'DB prompt',
    JSON.stringify({ id: 'deepseek-v4-pro', providerID: 'deepseek' }),
    120,
    8,
    12,
    0,
    1767036059000,
    1767036075000,
  );
  db.prepare('INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)').run(
    'msg_user',
    'ses_db',
    1767036059000,
    1767036059000,
    JSON.stringify({ role: 'user' }),
  );
  db.prepare('INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)').run(
    'part_user',
    'msg_user',
    'ses_db',
    1767036059000,
    1767036059000,
    JSON.stringify({ type: 'text', text: 'DB prompt' }),
  );
  db.prepare('INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)').run(
    'msg_asst',
    'ses_db',
    1767036060000,
    1767036065000,
    JSON.stringify({ role: 'assistant', tokens: { input: 120, output: 8, cache: { read: 12, write: 0 } } }),
  );
  const insertPart = db.prepare('INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)');
  insertPart.run('part_start', 'msg_asst', 'ses_db', 1767036060000, 1767036060000, JSON.stringify({ type: 'step-start' }));
  insertPart.run('part_text', 'msg_asst', 'ses_db', 1767036061000, 1767036061000, JSON.stringify({ type: 'text', text: 'DB reply' }));
  insertPart.run('part_finish', 'msg_asst', 'ses_db', 1767036065000, 1767036065000, JSON.stringify({ type: 'step-finish' }));
  db.prepare('INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)').run(
    'msg_asst_2',
    'ses_db',
    1767036070000,
    1767036075000,
    JSON.stringify({ role: 'assistant', tokens: { input: 150, output: 10, cache: { read: 20, write: 0 } } }),
  );
  insertPart.run('part_start_2', 'msg_asst_2', 'ses_db', 1767036070000, 1767036070000, JSON.stringify({ type: 'step-start' }));
  insertPart.run('part_text_2', 'msg_asst_2', 'ses_db', 1767036071000, 1767036071000, JSON.stringify({ type: 'text', text: 'Second DB reply' }));
  insertPart.run('part_finish_2', 'msg_asst_2', 'ses_db', 1767036075000, 1767036075000, JSON.stringify({ type: 'step-finish' }));
  db.close();
}

function createOpenClawDb(dbPath: string) {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE acp_replay_sessions (
      session_id TEXT NOT NULL PRIMARY KEY,
      session_key TEXT NOT NULL,
      cwd TEXT NOT NULL,
      complete INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      next_seq INTEGER NOT NULL
    );
    CREATE TABLE acp_replay_events (
      session_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      at INTEGER NOT NULL,
      session_key TEXT NOT NULL,
      run_id TEXT,
      update_json TEXT NOT NULL,
      PRIMARY KEY (session_id, seq)
    );
  `);
  db.prepare(`
    INSERT INTO acp_replay_sessions (session_id, session_key, cwd, complete, created_at, updated_at, next_seq)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('oc_session', 'agent:main:work', '/repo/openclaw', 1, 1767036059000, 1767036065000, 5);
  const insertEvent = db.prepare(`
    INSERT INTO acp_replay_events (session_id, seq, at, session_key, run_id, update_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  insertEvent.run('oc_session', 1, 1767036060000, 'agent:main:work', 'run_1', JSON.stringify({
    sessionUpdate: 'user_message_chunk',
    content: { type: 'text', text: 'OpenClaw prompt' },
  }));
  insertEvent.run('oc_session', 2, 1767036061000, 'agent:main:work', 'run_1', JSON.stringify({
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text: 'OpenClaw reply' },
  }));
  insertEvent.run('oc_session', 3, 1767036065000, 'agent:main:work', 'run_1', JSON.stringify({
    sessionUpdate: 'usage_update',
    used: 456,
    size: 200000,
  }));
  db.close();
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

test('scan infers OpenCode, Pi, and OpenClaw sources from custom JSONL paths', async () => {
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
  await writeFile(join(dir, 'openclaw.jsonl'), toJsonl([
    { type: 'openclaw_session', sessionId: 'oc_1', sessionKey: 'agent:main', cwd: '/repo/openclaw' },
    { type: 'session_update', timestamp: '2026-07-06T00:00:00Z', sessionId: 'oc_1', runId: 'run_1', update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'OpenClaw prompt' } } },
    { type: 'session_update', timestamp: '2026-07-06T00:00:01Z', sessionId: 'oc_1', runId: 'run_1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'OpenClaw reply' } } },
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
    assert.equal(byName.get('openclaw.jsonl')?.source, 'openclaw');
    assert.equal(byName.get('openclaw.jsonl')?.turnCount, 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});

test('scan and import OpenCode local db sessions as virtual JSONL', async () => {
  scannedRows = [];
  hashLookups = 0;
  const dir = await mkdtemp(join(tmpdir(), 'scanner-opencode-db-'));
  const dbPath = join(dir, 'opencode.db');
  createOpenCodeDb(dbPath);
  scannedRows = [{
    path: `opencode-db:${encodeURIComponent(dbPath)}#ses_db`,
    title: 'stale db scan',
    model: 'opencode',
    requests: 2,
    peak_tokens: 150,
    turn_count: 11,
    cwd: '/repo/opencode',
    hash: 'stale-hash',
    modified: new Date(1767036075000).toISOString(),
  }];

  let importedJsonl = '';
  createSessionImpl = async (opts) => {
    importedJsonl = opts.jsonlContent;
    return {
      sessionId: 'created-opencode-db',
      summary: { session: { model: 'opencode', requests: 2, peakTokens: 150 } },
      turns: [{}],
      errors: [],
    };
  };

  const app = express();
  app.use(express.json());
  app.use('/scanner', scannerRouter);
  const server = await listen(app);

  try {
    const address = server.address() as AddressInfo;
    const scanResponse = await fetch(`http://127.0.0.1:${address.port}/scanner/scan?paths=${encodeURIComponent(dir)}&depth=1`);
    assert.equal(scanResponse.status, 200);

    const scanBody = await scanResponse.json() as { files: Array<{ path: string; name: string; source: string; turnCount: number; requests: number; cwd: string }> };
    assert.equal(scanBody.files.length, 1);
    assert.equal(scanBody.files[0]!.source, 'opencode');
    assert.equal(scanBody.files[0]!.turnCount, 1);
    assert.equal(scanBody.files[0]!.requests, 2);
    assert.equal(scanBody.files[0]!.cwd, '/repo/opencode');
    assert.match(scanBody.files[0]!.path, /^opencode-db:/);

    const importResponse = await fetch(`http://127.0.0.1:${address.port}/scanner/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: scanBody.files[0]!.path }),
    });
    assert.equal(importResponse.status, 201);
    assert.deepEqual(await importResponse.json(), {
      imported: true,
      sessionId: 'created-opencode-db',
      model: 'opencode',
      total_requests: 2,
      peak_tokens: 150,
      turn_count: 1,
    });
    assert.equal(importedJsonl.match(/"type":"step_start"/g)?.length, 1);
    assert.equal(importedJsonl.match(/"type":"step_finish"/g)?.length, 2);
    assert.match(importedJsonl, /"prompt":"DB prompt"/);
    assert.match(importedJsonl, /"text":"DB reply"/);
    assert.match(importedJsonl, /"text":"Second DB reply"/);
    assert.match(importedJsonl, /"tokens":\{"input":120,"output":8,"cache":\{"read":12,"write":0\}\}/);
    assert.match(importedJsonl, /"tokens":\{"input":150,"output":10,"cache":\{"read":20,"write":0\}\}/);
  } finally {
    scannedRows = [];
    resetCreateSessionImpl();
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});

test('scan and import OpenClaw local sqlite replay sessions as virtual JSONL', async () => {
  scannedRows = [];
  hashLookups = 0;
  const dir = await mkdtemp(join(tmpdir(), 'scanner-openclaw-db-'));
  const stateDir = join(dir, 'state');
  await mkdir(stateDir);
  const dbPath = join(stateDir, 'openclaw.sqlite');
  createOpenClawDb(dbPath);
  scannedRows = [{
    path: `openclaw-db:${encodeURIComponent(dbPath)}#oc_session`,
    title: 'stale openclaw scan',
    model: 'openclaw',
    requests: 1,
    peak_tokens: 456,
    turn_count: 9,
    cwd: '/repo/openclaw',
    hash: 'stale-openclaw-hash',
    modified: new Date(1767036065000).toISOString(),
  }];

  let importedJsonl = '';
  createSessionImpl = async (opts) => {
    importedJsonl = opts.jsonlContent;
    return {
      sessionId: 'created-openclaw-db',
      summary: { session: { model: 'openclaw', requests: 1, peakTokens: 456 } },
      turns: [{}],
      errors: [],
    };
  };

  const app = express();
  app.use(express.json());
  app.use('/scanner', scannerRouter);
  const server = await listen(app);

  try {
    const address = server.address() as AddressInfo;
    const scanResponse = await fetch(`http://127.0.0.1:${address.port}/scanner/scan?paths=${encodeURIComponent(dir)}&depth=2`);
    assert.equal(scanResponse.status, 200);

    const scanBody = await scanResponse.json() as { files: Array<{ path: string; name: string; source: string; turnCount: number; requests: number; peakTokens: number; cwd: string }> };
    assert.equal(scanBody.files.length, 1);
    assert.equal(scanBody.files[0]!.source, 'openclaw');
    assert.equal(scanBody.files[0]!.turnCount, 1);
    assert.equal(scanBody.files[0]!.requests, 1);
    assert.equal(scanBody.files[0]!.peakTokens, 456);
    assert.equal(scanBody.files[0]!.cwd, '/repo/openclaw');
    assert.match(scanBody.files[0]!.path, /^openclaw-db:/);

    const importResponse = await fetch(`http://127.0.0.1:${address.port}/scanner/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: scanBody.files[0]!.path }),
    });
    assert.equal(importResponse.status, 201);
    assert.deepEqual(await importResponse.json(), {
      imported: true,
      sessionId: 'created-openclaw-db',
      model: 'openclaw',
      total_requests: 1,
      peak_tokens: 456,
      turn_count: 1,
    });
    assert.match(importedJsonl, /"type":"openclaw_session"/);
    assert.match(importedJsonl, /"sessionUpdate":"user_message_chunk"/);
    assert.match(importedJsonl, /"text":"OpenClaw prompt"/);
    assert.match(importedJsonl, /"sessionUpdate":"agent_message_chunk"/);
    assert.match(importedJsonl, /"text":"OpenClaw reply"/);
    assert.match(importedJsonl, /"sessionUpdate":"usage_update"/);
  } finally {
    scannedRows = [];
    resetCreateSessionImpl();
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});

test('scan keeps cached OpenCode, Pi, and OpenClaw sources from cached model metadata', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'scanner-cache-sources-'));
  const openCodePath = join(dir, 'opencode.jsonl');
  const piPath = join(dir, 'pi.jsonl');
  const openClawPath = join(dir, 'openclaw.jsonl');
  await Promise.all([
    writeFile(openCodePath, '{}\n'),
    writeFile(piPath, '{}\n'),
    writeFile(openClawPath, '{}\n'),
  ]);
  const [openCodeStat, piStat, openClawStat] = await Promise.all([stat(openCodePath), stat(piPath), stat(openClawPath)]);
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
    {
      path: openClawPath,
      title: 'cached openclaw',
      model: 'openclaw',
      requests: 1,
      peak_tokens: 11,
      turn_count: 1,
      cwd: '',
      hash: 'hash-openclaw',
      modified: openClawStat.mtime.toISOString(),
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
    assert.equal(byName.get('openclaw.jsonl')?.source, 'openclaw');
  } finally {
    scannedRows = [];
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});

test('scan keeps known OpenClaw path source over stale Pi cache metadata', async () => {
  const openClawRoot = join(homedir(), '.openclaw');
  await mkdir(openClawRoot, { recursive: true });
  const dir = await mkdtemp(join(openClawRoot, 'scanner-cache-source-'));
  const openClawPath = join(dir, 'openclaw.jsonl');
  await writeFile(openClawPath, '{}\n');
  const openClawStat = await stat(openClawPath);
  scannedRows = [{
    path: openClawPath,
    title: 'stale pi cache',
    model: 'pi',
    requests: 1,
    peak_tokens: 9,
    turn_count: 1,
    cwd: '',
    hash: 'hash-stale-pi',
    modified: openClawStat.mtime.toISOString(),
  }];

  const app = express();
  app.use(express.json());
  app.use('/scanner', scannerRouter);
  const server = await listen(app);

  try {
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/scanner/scan?paths=${encodeURIComponent(dir)}&depth=1`);
    assert.equal(response.status, 200);

    const body = await response.json() as { files: Array<{ name: string; source: string }> };
    assert.deepEqual(body.files.map((file) => ({ name: file.name, source: file.source })), [{
      name: 'openclaw.jsonl',
      source: 'openclaw',
    }]);
  } finally {
    scannedRows = [];
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});

test('scan keeps OpenClaw path source for Pi-shaped OpenClaw session JSONL', async () => {
  scannedRows = [];
  const openClawRoot = join(homedir(), '.openclaw');
  await mkdir(openClawRoot, { recursive: true });
  const dir = await mkdtemp(join(openClawRoot, 'scanner-pi-shaped-source-'));
  const openClawPath = join(dir, 'openclaw-pi-shaped.jsonl');
  await writeFile(openClawPath, toJsonl([
    { type: 'session', version: 3, id: 'openclaw_local', timestamp: '2026-07-06T03:46:26.390Z', cwd: '/repo/openclaw' },
    { type: 'model_change', id: 'model1', parentId: null, modelId: 'deepseek-v4-pro' },
    { type: 'message', id: 'u1', parentId: 'model1', message: { role: 'user', content: [{ type: 'text', text: 'OpenClaw prompt' }] } },
    { type: 'message', id: 'a1', parentId: 'u1', message: { role: 'assistant', content: [{ type: 'text', text: 'OpenClaw reply' }] } },
  ]));

  const app = express();
  app.use(express.json());
  app.use('/scanner', scannerRouter);
  const server = await listen(app);

  try {
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/scanner/scan?paths=${encodeURIComponent(dir)}&depth=1&force=1`);
    assert.equal(response.status, 200);

    const body = await response.json() as { files: Array<{ name: string; source: string; model: string; turnCount: number; requests: number }> };
    assert.deepEqual(body.files.map((file) => ({
      name: file.name,
      source: file.source,
      model: file.model,
      turnCount: file.turnCount,
      requests: file.requests,
    })), [{
      name: 'openclaw-pi-shaped.jsonl',
      source: 'openclaw',
      model: 'openclaw',
      turnCount: 1,
      requests: 1,
    }]);
  } finally {
    scannedRows = [];
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});

test('import keeps OpenClaw path source for Pi-shaped OpenClaw session JSONL', async () => {
  hashLookups = 0;
  const openClawRoot = join(homedir(), '.openclaw');
  await mkdir(openClawRoot, { recursive: true });
  const dir = await mkdtemp(join(openClawRoot, 'scanner-import-source-'));
  const openClawPath = join(dir, 'openclaw-pi-shaped.jsonl');
  await writeFile(openClawPath, toJsonl([
    { type: 'session', version: 3, id: 'openclaw_local', timestamp: '2026-07-06T03:46:26.390Z', cwd: '/repo/openclaw' },
    { type: 'model_change', id: 'model1', parentId: null, modelId: 'deepseek-v4-pro' },
    { type: 'message', id: 'u1', parentId: 'model1', message: { role: 'user', content: [{ type: 'text', text: 'OpenClaw prompt' }] } },
    { type: 'message', id: 'a1', parentId: 'u1', message: { role: 'assistant', content: [{ type: 'text', text: 'OpenClaw reply' }] } },
  ]));

  let importedSource = '';
  createSessionImpl = async (opts) => {
    importedSource = opts.source ?? '';
    return {
      sessionId: 'created-openclaw-path',
      summary: { session: { model: 'openclaw', requests: 1, peakTokens: 100 } },
      turns: [{}],
      errors: [],
    };
  };

  const app = express();
  app.use(express.json());
  app.use('/scanner', scannerRouter);
  const server = await listen(app);

  try {
    const address = server.address() as AddressInfo;
    const importResponse = await fetch(`http://127.0.0.1:${address.port}/scanner/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: openClawPath }),
    });

    assert.equal(importResponse.status, 201);
    assert.equal(importedSource, 'openclaw');
  } finally {
    resetCreateSessionImpl();
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});

test('scan refreshes empty cached Pi metadata', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'scanner-empty-cache-'));
  const piPath = join(dir, 'pi-local.jsonl');
  await writeFile(piPath, toJsonl([
    { type: 'session', version: 3, id: 'pi_local', timestamp: '2026-07-06T03:46:26.390Z', cwd: '/repo/pi' },
    { type: 'model_change', id: 'model1', parentId: null, modelId: 'deepseek-v4-pro' },
    { type: 'message', id: 'u1', parentId: 'model1', message: { role: 'user', content: [{ type: 'text', text: 'Pi prompt' }] } },
    { type: 'message', id: 'a1', parentId: 'u1', message: { role: 'assistant', content: [{ type: 'text', text: 'Pi reply' }] } },
  ]));
  const piStat = await stat(piPath);
  scannedRows = [{
    path: piPath,
    title: null,
    model: 'pi',
    requests: 0,
    peak_tokens: 0,
    turn_count: 0,
    cwd: '',
    hash: 'old-empty-hash',
    modified: piStat.mtime.toISOString(),
  }];

  const app = express();
  app.use(express.json());
  app.use('/scanner', scannerRouter);
  const server = await listen(app);

  try {
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/scanner/scan?paths=${encodeURIComponent(dir)}&depth=1`);
    assert.equal(response.status, 200);

    const body = await response.json() as { cached: number; scanned: number; files: Array<{ name: string; source: string; turnCount: number; requests: number }> };

    assert.equal(body.cached, 0);
    assert.equal(body.scanned, 1);
    assert.deepEqual(body.files.map((file) => ({
      name: file.name,
      source: file.source,
      turnCount: file.turnCount,
      requests: file.requests,
    })), [{
      name: 'pi-local.jsonl',
      source: 'pi',
      turnCount: 1,
      requests: 1,
    }]);
  } finally {
    scannedRows = [];
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
