/**
 * pipeline-service.test.ts — 管道服务测试
 *
 * 覆盖：
 * - extractCwdFromJsonl 各场景
 * - computeMemoryChars / computeMemoryCharsSync
 * - persistTurns 纯逻辑
 * - runPipelineOnContent Claude vs Codex 分支
 *
 * 注意：需要使用 --experimental-test-module-mocks 标志运行此测试
 *   node --import tsx --experimental-test-module-mocks --test <this-file>
 */
import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import Database from 'better-sqlite3';

// ── 创建内存数据库 ────────────────────────────────────────────────────

const memDb = new Database(':memory:');
memDb.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, filename TEXT, file_hash TEXT,
    source TEXT, model TEXT, version TEXT, ai_title TEXT, cwd TEXT,
    total_requests INTEGER, peak_index INTEGER, peak_tokens INTEGER,
    peak_cache_hit INTEGER DEFAULT 0, peak_turn_idx INTEGER DEFAULT 0,
    peak_step INTEGER DEFAULT 0, total_output INTEGER, context_limit INTEGER DEFAULT 200000,
    turn_count INTEGER, raw_size INTEGER,
    categories_json TEXT, tools_json TEXT, series_json TEXT, raw_jsonl TEXT,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS turns (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    turn_index INTEGER NOT NULL, prompt TEXT, timestamp TEXT,
    asst_reqs INTEGER, max_input INTEGER,
    max_cache_hit INTEGER DEFAULT 0, max_req_idx INTEGER DEFAULT 0,
    max_req_step INTEGER DEFAULT 0, out_tok INTEGER,
    cum_total INTEGER, cum_cache_hit INTEGER DEFAULT 0,
    cum_tools_json TEXT, compression_reset INTEGER DEFAULT 0,
    dur_ms INTEGER, model_ms INTEGER, tool_ms INTEGER, sub_ms INTEGER,
    step_count INTEGER, comp_json TEXT, delta_json TEXT,
    tools_json TEXT, segs_json TEXT, longest_json TEXT
  );
`);

// mock getDb 返回内存数据库
mock.module('../db', {
  namedExports: {
    getDb: () => memDb,
    initDb: () => {},
  },
});

const pipelineService = await import('../services/pipeline-service');

const {
  extractCwdFromJsonl,
  computeMemoryCharsSync,
  persistTurns,
  runPipelineOnContentSync,
  createSession,
} = pipelineService;

// ── extractCwdFromJsonl 测试 ─────────────────────────────────────────────

test('extractCwdFromJsonl Claude JSONL 第一行有 cwd 字段', () => {
  const jsonl = JSON.stringify({ cwd: '/home/user/project' }) + '\n' +
    JSON.stringify({ type: 'assistant', message: {} });
  assert.equal(extractCwdFromJsonl(jsonl), '/home/user/project');
});

test('extractCwdFromJsonl Codex session_meta 提取 cwd', () => {
  const jsonl = JSON.stringify({
    type: 'session_meta',
    payload: { cwd: '/Users/dev/codex-project' },
  }) + '\n';
  assert.equal(extractCwdFromJsonl(jsonl), '/Users/dev/codex-project');
});

test('extractCwdFromJsonl 空输入返回空字符串', () => {
  assert.equal(extractCwdFromJsonl(''), '');
});

test('extractCwdFromJsonl undefined 返回空字符串', () => {
  assert.equal(extractCwdFromJsonl(undefined), '');
});

test('extractCwdFromJsonl 无 cwd 字段返回空字符串', () => {
  const jsonl = JSON.stringify({ type: 'assistant', message: {} }) + '\n';
  assert.equal(extractCwdFromJsonl(jsonl), '');
});

test('extractCwdFromJsonl cwd 为空字符串视为无 cwd', () => {
  const jsonl = JSON.stringify({ cwd: '' }) + '\n';
  assert.equal(extractCwdFromJsonl(jsonl), '');
});

test('extractCwdFromJsonl 多行中找到 cwd', () => {
  const lines = [];
  for (let i = 0; i < 20; i++) {
    lines.push(JSON.stringify({ index: i }));
  }
  lines.push(JSON.stringify({ cwd: '/home/user/late-cwd' }));
  const jsonl = lines.join('\n');
  assert.equal(extractCwdFromJsonl(jsonl), '/home/user/late-cwd');
});

test('extractCwdFromJsonl 第一行优先于后续行', () => {
  const jsonl = JSON.stringify({ cwd: '/first' }) + '\n' +
    JSON.stringify({ cwd: '/second' });
  assert.equal(extractCwdFromJsonl(jsonl), '/first');
});

test('extractCwdFromJsonl 跳过空行和无效 JSON', () => {
  const jsonl = '\ninvalid json\n\n' + JSON.stringify({ cwd: '/valid' });
  assert.equal(extractCwdFromJsonl(jsonl), '/valid');
});

test('extractCwdFromJsonl 超过 50 行限制', () => {
  const lines = [];
  for (let i = 0; i < 60; i++) {
    lines.push(JSON.stringify({ index: i }));
  }
  // cwd 在第 51 行，但只扫描前 50 行
  const jsonl = lines.join('\n');
  assert.equal(extractCwdFromJsonl(jsonl), '');
});

// ── computeMemoryCharsSync 测试 ─────────────────────────────────────────

test('computeMemoryCharsSync Codex JSONL 直接返回 0', () => {
  const codexJsonl = JSON.stringify({
    type: 'session_meta',
    payload: { cwd: '/some/path' },
  }) + '\n';
  assert.equal(computeMemoryCharsSync(codexJsonl), 0);
});

test('computeMemoryCharsSync 空输入不崩溃', () => {
  const result = computeMemoryCharsSync('');
  assert.ok(typeof result === 'number');
  assert.ok(result >= 0);
});

// ── persistTurns 测试 ────────────────────────────────────────────────────

import type { TurnData } from '../../shared/types/session';

function makeTurn(overrides?: Partial<TurnData>): TurnData {
  return {
    i: 0,
    prompt: 'test prompt',
    ts: '2026-01-01T00:00:00Z',
    asstReqs: 1,
    maxInput: 10000,
    outTok: 500,
    tools: { Read: 3 },
    delta: { thinking: 100, asstText: 200 },
    durMs: 5000,
    modelMs: 3000,
    toolMs: 1000,
    subMs: 0,
    stepCount: 2,
    longest: { k: 't', n: 'text', ms: 2000 },
    segs: [],
    comp: { sysPrompt: 1000, memory: 500 },
    cumTotal: 15000,
    ...overrides,
  };
}

test('persistTurns 空 turns 不崩溃', () => {
  memDb.prepare('INSERT OR IGNORE INTO sessions (id) VALUES (?)').run('pt-s1');
  assert.doesNotThrow(() => {
    persistTurns('pt-s1', []);
  });
});

test('persistTurns 正常写入 turn 数据', () => {
  memDb.prepare('INSERT OR IGNORE INTO sessions (id) VALUES (?)').run('pt-s2');
  const turn = makeTurn({ i: 0 });
  persistTurns('pt-s2', [turn]);

  const row = memDb.prepare(
    'SELECT * FROM turns WHERE session_id = ? ORDER BY turn_index'
  ).get('pt-s2') as Record<string, unknown>;

  assert.equal(row.prompt, 'test prompt');
  assert.equal(row.max_input, 10000);
  assert.equal(row.out_tok, 500);
  assert.equal(row.cum_total, 15000);
  assert.equal(row.dur_ms, 5000);
  assert.equal(row.model_ms, 3000);
  assert.equal(row.tool_ms, 1000);
  assert.equal(row.sub_ms, 0);
  assert.equal(row.step_count, 2);
  assert.equal(row.compression_reset, 0);

  // JSON 字段应正确序列化
  const toolsParsed = JSON.parse(row.tools_json as string);
  assert.deepEqual(toolsParsed, { Read: 3 });

  const deltaParsed = JSON.parse(row.delta_json as string);
  assert.deepEqual(deltaParsed, { thinking: 100, asstText: 200 });

  const compParsed = JSON.parse(row.comp_json as string);
  assert.deepEqual(compParsed, { sysPrompt: 1000, memory: 500 });
});

test('persistTurns 写入多条 turn', () => {
  memDb.prepare('INSERT OR IGNORE INTO sessions (id) VALUES (?)').run('pt-s3');
  const turns = [
    makeTurn({ i: 0, prompt: 'first' }),
    makeTurn({ i: 1, prompt: 'second' }),
    makeTurn({ i: 2, prompt: 'third' }),
  ];
  persistTurns('pt-s3', turns);

  const count = memDb.prepare(
    'SELECT COUNT(*) as cnt FROM turns WHERE session_id = ?'
  ).get('pt-s3') as { cnt: number };

  assert.equal(count.cnt, 3);
});

test('persistTurns 存储 cumTools 序列化 JSON', () => {
  memDb.prepare('INSERT OR IGNORE INTO sessions (id) VALUES (?)').run('pt-s4');
  const turn = makeTurn({
    cumTools: { Read: { calls: 5, resultTokens: 1000, task: false } },
  });
  persistTurns('pt-s4', [turn]);

  const row = memDb.prepare(
    'SELECT cum_tools_json FROM turns WHERE session_id = ?'
  ).get('pt-s4') as { cum_tools_json: string };

  const parsed = JSON.parse(row.cum_tools_json);
  assert.deepEqual(parsed.Read, { calls: 5, resultTokens: 1000, task: false });
});

test('persistTurns 存储 segs 和 longest 序列化 JSON', () => {
  memDb.prepare('INSERT OR IGNORE INTO sessions (id) VALUES (?)').run('pt-s5');
  const turn = makeTurn({
    segs: [
      { k: 'm' as const, n: 'model', ms: 3000, ts: '2026-01-01', det: { text: 'thinking', textTok: 50 } },
    ],
    longest: { k: 'm', n: 'model', ms: 3000 },
  });
  persistTurns('pt-s5', [turn]);

  const row = memDb.prepare(
    'SELECT segs_json, longest_json FROM turns WHERE session_id = ?'
  ).get('pt-s5') as { segs_json: string; longest_json: string };

  const segsParsed = JSON.parse(row.segs_json);
  assert.equal(segsParsed.length, 1);
  assert.equal(segsParsed[0].k, 'm');

  const longestParsed = JSON.parse(row.longest_json);
  assert.equal(longestParsed.k, 'm');
});

test('persistTurns 存储 compressionReset 标记', () => {
  memDb.prepare('INSERT OR IGNORE INTO sessions (id) VALUES (?)').run('pt-s6');
  const turn = makeTurn({ compressionReset: true });
  persistTurns('pt-s6', [turn]);

  const row = memDb.prepare(
    'SELECT compression_reset FROM turns WHERE session_id = ?'
  ).get('pt-s6') as { compression_reset: number };

  assert.equal(row.compression_reset, 1);
});

// ── runPipelineOnContentSync 测试 ───────────────────────────────────────

test('runPipelineOnContentSync Codex 分支返回摘要', () => {
  const codexJsonl = JSON.stringify({
    type: 'session_meta',
    order: 0,
    timestamp: '2026-01-01T00:00:00Z',
    payload: { cwd: '/tmp', model: 'gpt-4' },
  }) + '\n' + JSON.stringify({
    type: 'message',
    order: 1,
    timestamp: '2026-01-01T00:01:00Z',
    payload: {
      role: 'user',
      content: [{ type: 'text', text: 'hello' }],
    },
  }) + '\n' + JSON.stringify({
    type: 'message',
    order: 2,
    timestamp: '2026-01-01T00:02:00Z',
    payload: {
      role: 'assistant',
      content: { type: 'text', text: 'hi there' },
      source: 'agent',
    },
  });

  const result = runPipelineOnContentSync(codexJsonl, 'test-codex.jsonl');
  assert.ok(result.summary, '应返回 session 摘要');
  assert.ok(Array.isArray(result.turns), 'turns 应为数组');
  assert.ok(result.summary.session.model.length > 0, '应有模型名');
});

test('runPipelineOnContentSync Claude 分支返回摘要', () => {
  const claudeJsonl = JSON.stringify({
    type: 'ai-title',
    text: 'Test Session',
  }) + '\n' + JSON.stringify({
    type: 'user',
    uuid: 'u1',
    sessionId: 's1',
    timestamp: '2026-01-01T00:00:01Z',
    message: { role: 'user', content: 'hello' },
  }) + '\n' + JSON.stringify({
    type: 'assistant',
    uuid: 'a1',
    parentUuid: 'u1',
    sessionId: 's1',
    timestamp: '2026-01-01T00:00:02Z',
    message: {
      model: 'claude-sonnet',
      usage: { input_tokens: 100, output_tokens: 50 },
      content: [{ type: 'text', text: 'hi' }],
      stop_reason: 'end_turn',
    },
  });

  const result = runPipelineOnContentSync(claudeJsonl, 'test-claude.jsonl');
  assert.ok(result.summary, '应返回 session 摘要');
  assert.ok(Array.isArray(result.turns), 'turns 应为数组');
  assert.equal(result.summary.session.model, 'claude-sonnet');
});

test('runPipelineOnContentSync OpenCode 分支返回摘要', () => {
  const opencodeJsonl = [
    {
      type: 'step_start',
      timestamp: 1767036059338,
      sessionID: 'ses_open',
      part: { id: 'prt_1', sessionID: 'ses_open', messageID: 'msg_1', type: 'step-start' },
    },
    {
      type: 'text',
      timestamp: 1767036064268,
      sessionID: 'ses_open',
      part: { id: 'prt_2', sessionID: 'ses_open', messageID: 'msg_2', type: 'text', text: 'OpenCode reply' },
    },
    {
      type: 'step_finish',
      timestamp: 1767036064273,
      sessionID: 'ses_open',
      part: { id: 'prt_3', sessionID: 'ses_open', messageID: 'msg_2', type: 'step-finish', tokens: { input: 321, output: 9 } },
    },
  ].map((line) => JSON.stringify(line)).join('\n');

  const result = runPipelineOnContentSync(opencodeJsonl, 'opencode.jsonl');

  assert.equal(result.summary.session.model, 'opencode');
  assert.equal(result.summary.session.peakTokens, 321);
  assert.equal(result.turns.length, 1);
  assert.equal(result.turns[0]!.segs.some((seg) => seg.det.text === 'OpenCode reply'), true);
});

test('runPipelineOnContentSync Pi session 分支返回摘要', () => {
  const piJsonl = [
    { type: 'header', version: 3, workingDirectory: '/repo/pi' },
    { type: 'message', id: 'u1', parentId: null, message: { role: 'user', content: [{ type: 'text', text: 'Pi prompt' }] } },
    { type: 'message', id: 'a1', parentId: 'u1', message: { role: 'assistant', content: [{ type: 'text', text: 'Pi reply' }] } },
  ].map((line) => JSON.stringify(line)).join('\n');

  const result = runPipelineOnContentSync(piJsonl, 'pi.jsonl');

  assert.equal(result.summary.session.model, 'pi');
  assert.equal(result.summary.session.cwd, '/repo/pi');
  assert.equal(result.turns.length, 1);
  assert.equal(result.turns[0]!.prompt, 'Pi prompt');
});

test('createSession persists explicit OpenClaw source for Pi-shaped OpenClaw JSONL', async () => {
  const jsonl = [
    { type: 'session', version: 3, id: 'openclaw_local', timestamp: '2026-07-06T03:46:26.390Z', cwd: '/repo/openclaw' },
    { type: 'model_change', id: 'model1', parentId: null, modelId: 'deepseek-v4-pro' },
    { type: 'message', id: 'u1', parentId: 'model1', message: { role: 'user', content: [{ type: 'text', text: 'OpenClaw prompt' }] } },
    { type: 'message', id: 'a1', parentId: 'u1', message: { role: 'assistant', content: [{ type: 'text', text: 'OpenClaw reply' }] } },
  ].map((line) => JSON.stringify(line)).join('\n');

  const created = await createSession({
    jsonlContent: jsonl,
    filename: 'openclaw-pi-shaped.jsonl',
    hash: 'openclaw-source-hash',
    source: 'openclaw',
  });

  const row = memDb.prepare('SELECT source, model FROM sessions WHERE id = ?').get(created.sessionId) as { source: string; model: string };
  assert.equal(row.source, 'openclaw');
  assert.equal(row.model, 'openclaw');
  assert.equal(created.summary.session.model, 'openclaw');
});

test('runPipelineOnContentSync OpenClaw 分支返回摘要', () => {
  const openClawJsonl = [
    { type: 'openclaw_session', sessionId: 'oc_1', sessionKey: 'agent:main', cwd: '/repo/openclaw' },
    {
      type: 'session_update',
      timestamp: '2026-07-06T00:00:00.000Z',
      sessionId: 'oc_1',
      runId: 'run_1',
      update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'OpenClaw prompt' } },
    },
    {
      type: 'session_update',
      timestamp: '2026-07-06T00:00:01.000Z',
      sessionId: 'oc_1',
      runId: 'run_1',
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'OpenClaw reply' } },
    },
  ].map((line) => JSON.stringify(line)).join('\n');

  const result = runPipelineOnContentSync(openClawJsonl, 'openclaw.jsonl');

  assert.equal(result.summary.session.model, 'openclaw');
  assert.equal(result.summary.session.cwd, '/repo/openclaw');
  assert.equal(result.turns.length, 1);
  assert.equal(result.turns[0]!.prompt, 'OpenClaw prompt');
  assert.equal(result.turns[0]!.segs.find((seg) => seg.k === 'm')?.det.text, 'OpenClaw reply');
});

test('runPipelineOnContentSync unknown JSONL throws unsupported format error', () => {
  const unknownJsonl = JSON.stringify({ type: 'message', value: 'not an agent log' }) + '\n';

  assert.throws(
    () => runPipelineOnContentSync(unknownJsonl, 'unknown.jsonl'),
    /Unsupported JSONL session format/,
  );
});
