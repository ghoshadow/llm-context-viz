const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  parseConnectAuthority,
  isSensitiveHeader,
  redactHeaders,
  makeLogFilePath,
  chooseWritableLogFilePath,
  resolveCaptureTarget,
  cleanForwardHeaders,
  tryParse,
} = require('./calibration-proxy-utils.cjs');

test('parseConnectAuthority handles host and port', () => {
  assert.deepEqual(parseConnectAuthority('api.deepseek.com:443'), {
    host: 'api.deepseek.com',
    port: 443,
  });
});

test('parseConnectAuthority defaults to 443', () => {
  assert.deepEqual(parseConnectAuthority('api.deepseek.com'), {
    host: 'api.deepseek.com',
    port: 443,
  });
});

test('redactHeaders redacts sensitive keys case-insensitively', () => {
  const redacted = redactHeaders({
    Authorization: 'Bearer abc',
    'x-api-key': 'secret',
    cookie: 'sid=1',
    'content-type': 'application/json',
  });
  assert.equal(redacted.Authorization, '[REDACTED]');
  assert.equal(redacted['x-api-key'], '[REDACTED]');
  assert.equal(redacted.cookie, '[REDACTED]');
  assert.equal(redacted['content-type'], 'application/json');
});

test('isSensitiveHeader catches token secret and auth names', () => {
  assert.equal(isSensitiveHeader('x-session-token'), true);
  assert.equal(isSensitiveHeader('client_secret'), true);
  assert.equal(isSensitiveHeader('proxy-authorization'), true);
  assert.equal(isSensitiveHeader('accept'), false);
});

test('makeLogFilePath stays under cwd .claude-trace', () => {
  const cwd = path.resolve('/tmp/example-project');
  const logFile = makeLogFilePath(cwd, new Date('2026-06-26T01:02:03.456Z'));
  assert.equal(
    logFile,
    path.join(cwd, '.claude-trace', 'api-log-2026-06-26-01-02-03.jsonl'),
  );
});

test('chooseWritableLogFilePath falls back when project trace dir is not writable', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-proxy-'));
  const homeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-proxy-home-'));
  const project = path.join(tmpRoot, 'demo-project');
  const traceDir = path.join(project, '.claude-trace');
  fs.mkdirSync(traceDir, { recursive: true });
  fs.chmodSync(traceDir, 0o555);
  try {
    const logFile = chooseWritableLogFilePath(project, new Date('2026-06-26T01:02:03.456Z'), homeRoot);
    assert.equal(logFile.startsWith(path.join(homeRoot, '.claude-trace', 'logs')), true);
    assert.equal(logFile.endsWith('api-log-2026-06-26-01-02-03.jsonl'), true);
  } finally {
    fs.chmodSync(traceDir, 0o755);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.rmSync(homeRoot, { recursive: true, force: true });
  }
});

test('cleanForwardHeaders removes proxy hop headers and sets host', () => {
  const headers = cleanForwardHeaders({
    host: '127.0.0.1',
    'proxy-authorization': 'Basic abc',
    'transfer-encoding': 'chunked',
    accept: 'application/json',
  }, 'api.deepseek.com');
  assert.deepEqual(headers, {
    host: 'api.deepseek.com',
    accept: 'application/json',
  });
});

test('tryParse parses json and leaves text untouched', () => {
  assert.deepEqual(tryParse('application/json', '{"a":1}'), { a: 1 });
  assert.equal(tryParse('text/plain', 'hello'), 'hello');
  assert.equal(tryParse('application/json', '{oops'), '{oops');
  assert.equal(tryParse('application/json', ''), null);
});

test('resolveCaptureTarget treats full URL as base-url mode', () => {
  assert.deepEqual(resolveCaptureTarget('http://127.0.0.1:15721'), {
    mode: 'base-url',
    upstreamBaseUrl: 'http://127.0.0.1:15721',
    targetHost: '127.0.0.1',
  });
});

test('resolveCaptureTarget treats bare host as connect mode', () => {
  assert.deepEqual(resolveCaptureTarget('api.deepseek.com'), {
    mode: 'connect',
    upstreamBaseUrl: null,
    targetHost: 'api.deepseek.com',
  });
});
