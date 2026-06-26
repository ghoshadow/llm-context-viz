# Sudo-Free Claude Calibration Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a no-sudo automatic Claude Code calibration flow that launches Claude Code through an explicit local proxy, captures one API request, extracts constants, and reuses the existing apply flow.

**Architecture:** Add a focused proxy helper module plus a CLI script that can run without root. Add an in-memory calibration job service and three Express endpoints. Update `CalibratePage` to start and poll jobs while retaining manual upload fallback.

**Tech Stack:** Node.js `http`, `https`, `tls`, `net`, `child_process`; Express; React; existing `extractConstants()` calibration parser; Node built-in test runner through `tsx`.

---

## File Structure

- Create `scripts/calibration-proxy-utils.cjs`
  - Pure helper functions for redaction, CONNECT parsing, log-path generation, and port selection.
- Create `scripts/calibration-proxy.cjs`
  - No-sudo explicit proxy CLI. Generates/reuses certs, listens on a high port, launches `claude`, writes proxy capture JSONL.
- Create `scripts/calibration-proxy-utils.test.cjs`
  - Node tests for helper behavior.
- Create `server/services/calibration-job.ts`
  - In-memory job manager. Spawns `node scripts/calibration-proxy.cjs`, tracks status, calls `extractConstants()`.
- Modify `server/routes/calibrate.ts`
  - Add `POST /auto/start`, `GET /auto/:jobId`, and `POST /auto/:jobId/cancel`.
- Modify `src/components/pages/CalibratePage.tsx`
  - Add automatic calibration UI and polling. Keep manual upload as fallback.
- Modify `package.json`
  - Add focused test scripts for the proxy helper or rely on direct `node --test`.

## Task 1: Proxy Helper Module

**Files:**
- Create: `scripts/calibration-proxy-utils.cjs`
- Create: `scripts/calibration-proxy-utils.test.cjs`

- [ ] **Step 1: Write helper tests**

Create `scripts/calibration-proxy-utils.test.cjs`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  parseConnectAuthority,
  isSensitiveHeader,
  redactHeaders,
  makeLogFilePath,
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
```

- [ ] **Step 2: Run tests to confirm failure**

Run:

```bash
node --test scripts/calibration-proxy-utils.test.cjs
```

Expected: FAIL because `scripts/calibration-proxy-utils.cjs` does not exist.

- [ ] **Step 3: Implement helper module**

Create `scripts/calibration-proxy-utils.cjs`:

```js
"use strict";

const fs = require("fs");
const net = require("net");
const path = require("path");

function parseConnectAuthority(authority) {
  const raw = String(authority || "").trim();
  if (!raw) return { host: "", port: 443 };
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    const host = end >= 0 ? raw.slice(1, end) : raw;
    const rest = end >= 0 ? raw.slice(end + 1) : "";
    const port = rest.startsWith(":") ? Number(rest.slice(1)) : 443;
    return { host, port: Number.isFinite(port) && port > 0 ? port : 443 };
  }
  const idx = raw.lastIndexOf(":");
  if (idx > 0 && raw.indexOf(":") === idx) {
    const host = raw.slice(0, idx);
    const port = Number(raw.slice(idx + 1));
    return { host, port: Number.isFinite(port) && port > 0 ? port : 443 };
  }
  return { host: raw, port: 443 };
}

function isSensitiveHeader(name) {
  const key = String(name || "").toLowerCase();
  return key === "cookie"
    || key.includes("authorization")
    || key.includes("auth")
    || key.includes("key")
    || key.includes("token")
    || key.includes("secret");
}

function redactHeaders(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) {
    out[key] = isSensitiveHeader(key) ? "[REDACTED]" : value;
  }
  return out;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function timestampForFile(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-").replace("T", "-").slice(0, 19);
}

function makeLogFilePath(cwd, date = new Date()) {
  return path.join(path.resolve(cwd), ".claude-trace", `api-log-${timestampForFile(date)}.jsonl`);
}

function pickPort(host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, host, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      server.close(() => resolve(port));
    });
  });
}

module.exports = {
  parseConnectAuthority,
  isSensitiveHeader,
  redactHeaders,
  ensureDir,
  makeLogFilePath,
  pickPort,
};
```

- [ ] **Step 4: Run helper tests**

Run:

```bash
node --test scripts/calibration-proxy-utils.test.cjs
```

Expected: PASS.

- [ ] **Step 5: Commit helper module**

Run:

```bash
git add scripts/calibration-proxy-utils.cjs scripts/calibration-proxy-utils.test.cjs
git commit -m "feat(calibrate): add proxy helpers"
```

## Task 2: No-Sudo Calibration Proxy Script

**Files:**
- Create: `scripts/calibration-proxy.cjs`
- Modify: `scripts/calibration-proxy-utils.cjs`

- [ ] **Step 1: Extend helper module with JSON and header utilities**

Patch `scripts/calibration-proxy-utils.cjs` to export:

```js
function cleanForwardHeaders(headers, targetHost) {
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) {
    const lower = key.toLowerCase();
    if (lower === "transfer-encoding" || lower === "proxy-connection" || lower === "proxy-authorization") continue;
    out[key] = value;
  }
  out.host = targetHost;
  return out;
}

function tryParse(contentType, body) {
  if (!body) return null;
  if (String(contentType || "").includes("json")) {
    try { return JSON.parse(body); } catch { return body; }
  }
  return body;
}
```

Add them to `module.exports`.

- [ ] **Step 2: Add tests for new helpers**

Append to `scripts/calibration-proxy-utils.test.cjs`:

```js
const { cleanForwardHeaders, tryParse } = require('./calibration-proxy-utils.cjs');

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
```

- [ ] **Step 3: Run helper tests**

Run:

```bash
node --test scripts/calibration-proxy-utils.test.cjs
```

Expected: PASS.

- [ ] **Step 4: Implement proxy script**

Create `scripts/calibration-proxy.cjs`:

```js
#!/usr/bin/env node
"use strict";

const tls = require("tls");
const https = require("https");
const http = require("http");
const net = require("net");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync, spawn } = require("child_process");
const {
  parseConnectAuthority,
  redactHeaders,
  cleanForwardHeaders,
  tryParse,
  ensureDir,
  makeLogFilePath,
} = require("./calibration-proxy-utils.cjs");

const DEFAULT_TARGET_HOST = "api.deepseek.com";
const DEFAULT_PORT = 18443;
const CERT_DIR = path.join(os.homedir(), ".claude-trace", "certs");

function log(msg) {
  console.log(`[calibration-proxy] ${msg}`);
}

function parseArgs(argv) {
  const args = [...argv];
  const dashDashIdx = args.indexOf("--");
  const preArgs = dashDashIdx >= 0 ? args.slice(0, dashDashIdx) : args;
  const claudeArgs = dashDashIdx >= 0 ? args.slice(dashDashIdx + 1) : ["-p", "say hi"];
  const opts = {
    cwd: process.cwd(),
    targetHost: DEFAULT_TARGET_HOST,
    port: DEFAULT_PORT,
    timeoutMs: 45000,
    claudeArgs,
  };
  for (let i = 0; i < preArgs.length; i += 1) {
    const key = preArgs[i];
    const value = preArgs[i + 1];
    if (key === "--cwd" && value) { opts.cwd = path.resolve(value); i += 1; }
    else if (key === "--target-host" && value) { opts.targetHost = value; i += 1; }
    else if (key === "--port" && value) { opts.port = Number(value); i += 1; }
    else if (key === "--timeout-ms" && value) { opts.timeoutMs = Number(value); i += 1; }
  }
  return opts;
}

function getCACert() {
  ensureDir(CERT_DIR);
  const keyPath = path.join(CERT_DIR, "ca-key.pem");
  const certPath = path.join(CERT_DIR, "ca-cert.pem");
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return { key: fs.readFileSync(keyPath, "utf-8"), cert: fs.readFileSync(certPath, "utf-8"), keyPath, certPath };
  }
  execSync(`openssl genrsa -out "${keyPath}" 2048 2>/dev/null`, { stdio: "ignore", timeout: 5000 });
  execSync(
    `openssl req -x509 -new -nodes -key "${keyPath}" -sha256 -days 3650 -out "${certPath}" -subj "/CN=Claude Trace CA" -addext "basicConstraints=critical,CA:TRUE,pathlen:0" -addext "keyUsage=critical,keyCertSign,cRLSign"`,
    { stdio: "ignore", timeout: 5000 },
  );
  fs.chmodSync(keyPath, 0o600);
  log("CA certificate generated");
  return { key: fs.readFileSync(keyPath, "utf-8"), cert: fs.readFileSync(certPath, "utf-8"), keyPath, certPath };
}

function getHostCert(hostname) {
  ensureDir(CERT_DIR);
  const safe = hostname.replace(/[^a-zA-Z0-9.-]/g, "_");
  const keyPath = path.join(CERT_DIR, `${safe}-key.pem`);
  const certPath = path.join(CERT_DIR, `${safe}-cert.pem`);
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return { key: fs.readFileSync(keyPath, "utf-8"), cert: fs.readFileSync(certPath, "utf-8") };
  }
  const ca = getCACert();
  execSync(`openssl genrsa -out "${keyPath}" 2048 2>/dev/null`, { stdio: "ignore", timeout: 5000 });
  const cnf = path.join(CERT_DIR, `${safe}.cnf`);
  fs.writeFileSync(cnf, `[req]\ndistinguished_name=req\nreq_extensions=ext\n[req]\n[ext]\nsubjectAltName=DNS:${hostname}\n`);
  const csr = path.join(CERT_DIR, `${safe}.csr`);
  execSync(`openssl req -new -key "${keyPath}" -out "${csr}" -subj "/CN=${hostname}" -config "${cnf}" 2>/dev/null`, { stdio: "ignore", timeout: 5000 });
  execSync(`openssl x509 -req -in "${csr}" -CA "${ca.certPath}" -CAkey "${ca.keyPath}" -CAcreateserial -out "${certPath}" -days 365 -sha256 -extfile "${cnf}" -extensions ext 2>/dev/null`, { stdio: "ignore", timeout: 5000 });
  try { fs.unlinkSync(csr); fs.unlinkSync(cnf); } catch {}
  fs.chmodSync(keyPath, 0o600);
  return { key: fs.readFileSync(keyPath, "utf-8"), cert: fs.readFileSync(certPath, "utf-8") };
}

function writePair(logFile, reqData, resData) {
  fs.appendFileSync(logFile, JSON.stringify({ request: reqData, response: resData, logged_at: new Date().toISOString() }) + "\n");
}

function tunnelRaw(clientSocket, authority) {
  const { host, port } = parseConnectAuthority(authority);
  const upstream = net.connect(port, host, () => {
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });
  upstream.on("error", () => {
    try { clientSocket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"); } catch {}
  });
}

function createMitmHandler({ targetHost, logFile, onCapture }) {
  const hostCert = getHostCert(targetHost);
  return (clientSocket) => {
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    const tlsSocket = new tls.TLSSocket(clientSocket, {
      isServer: true,
      key: hostCert.key,
      cert: hostCert.cert,
      ALPNProtocols: ["http/1.1"],
    });

    const localHttp = http.createServer((req, res) => {
      const reqTs = Date.now();
      let body = "";
      req.on("data", (chunk) => { body += chunk.toString("utf-8"); });
      req.on("end", () => {
        const url = `https://${targetHost}${req.url}`;
        const proxyReq = https.request({
          hostname: targetHost,
          port: 443,
          path: req.url,
          method: req.method,
          servername: targetHost,
          headers: cleanForwardHeaders(req.headers, targetHost),
        }, (proxyRes) => {
          const resTs = Date.now();
          let resBody = "";
          proxyRes.on("data", (chunk) => { resBody += chunk.toString("utf-8"); });
          proxyRes.on("end", () => {
            writePair(logFile, {
              timestamp: reqTs / 1000,
              method: req.method,
              url,
              headers: redactHeaders(req.headers),
              body: tryParse(req.headers["content-type"], body),
            }, {
              timestamp: resTs / 1000,
              status_code: proxyRes.statusCode,
              headers: redactHeaders(proxyRes.headers),
              body: tryParse(proxyRes.headers["content-type"], resBody),
            });
            onCapture();
            res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
            res.end(resBody);
          });
        });
        proxyReq.on("error", (err) => {
          log(`Upstream error: ${err.message}`);
          if (!res.headersSent) res.writeHead(502);
          res.end();
        });
        if (body) proxyReq.write(body);
        proxyReq.end();
      });
    });
    localHttp.emit("connection", tlsSocket);
    tlsSocket.once("close", () => { try { localHttp.close(); } catch {} });
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!Number.isFinite(opts.port) || opts.port <= 0) throw new Error("Invalid --port");
  if (!fs.existsSync(opts.cwd) || !fs.statSync(opts.cwd).isDirectory()) throw new Error(`Invalid cwd: ${opts.cwd}`);

  const ca = getCACert();
  getHostCert(opts.targetHost);
  const logFile = makeLogFilePath(opts.cwd);
  ensureDir(path.dirname(logFile));

  let captured = false;
  const server = http.createServer();
  const handleMitm = createMitmHandler({
    targetHost: opts.targetHost,
    logFile,
    onCapture: () => { captured = true; },
  });

  server.on("connect", (req, clientSocket) => {
    const { host, port } = parseConnectAuthority(req.url);
    if (host === opts.targetHost && port === 443) handleMitm(clientSocket);
    else tunnelRaw(clientSocket, req.url);
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, "127.0.0.1", resolve);
  });

  const proxyUrl = `http://127.0.0.1:${opts.port}`;
  const claudePath = execSync("which claude", { encoding: "utf8" }).trim();
  log(`READY port=${opts.port} target=${opts.targetHost} log=${logFile}`);
  log(`Launching: ${claudePath} ${opts.claudeArgs.join(" ")}`);

  const child = spawn(claudePath, opts.claudeArgs, {
    cwd: opts.cwd,
    env: {
      ...process.env,
      HTTPS_PROXY: proxyUrl,
      HTTP_PROXY: proxyUrl,
      https_proxy: proxyUrl,
      http_proxy: proxyUrl,
      NODE_EXTRA_CA_CERTS: ca.certPath,
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));

  const timeout = setTimeout(() => {
    if (!captured) {
      log(`ERROR no target request captured before timeout (${opts.timeoutMs}ms); Claude Code may not honor HTTPS_PROXY`);
      try { child.kill("SIGTERM"); } catch {}
    }
  }, opts.timeoutMs);

  const code = await new Promise((resolve) => {
    child.on("exit", (exitCode) => resolve(exitCode || 0));
    child.on("error", () => resolve(1));
  });
  clearTimeout(timeout);
  server.close();

  if (!captured) process.exit(2);
  log(`CAPTURED log=${logFile}`);
  process.exit(code);
}

main().catch((err) => {
  console.error(`[calibration-proxy] ERROR ${err.message}`);
  process.exit(1);
});
```

- [ ] **Step 5: Run script syntax and helper tests**

Run:

```bash
node --check scripts/calibration-proxy.cjs
node --test scripts/calibration-proxy-utils.test.cjs
```

Expected: both PASS.

- [ ] **Step 6: Commit proxy script**

Run:

```bash
git add scripts/calibration-proxy.cjs scripts/calibration-proxy-utils.cjs scripts/calibration-proxy-utils.test.cjs
git commit -m "feat(calibrate): add sudo-free proxy"
```

## Task 3: Calibration Job Service

**Files:**
- Create: `server/services/calibration-job.ts`
- Modify: `server/routes/calibrate.ts`

- [ ] **Step 1: Implement job service**

Create `server/services/calibration-job.ts`:

```ts
import { existsSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { randomUUID } from 'crypto';
import { extractConstants, type ExtractedConstants } from '../../src/pipeline/extract-constants';

export type CalibrationJobStatus =
  | 'starting'
  | 'running'
  | 'captured'
  | 'extracting'
  | 'ready'
  | 'failed'
  | 'cancelled';

export interface CalibrationJobSnapshot {
  jobId: string;
  status: CalibrationJobStatus;
  cwd: string;
  targetHost: string;
  port: number;
  startedAt: string;
  completedAt?: string;
  logFile?: string;
  message: string;
  output: string[];
  result: ExtractedConstants | null;
  error: string | null;
}

interface CalibrationJob extends CalibrationJobSnapshot {
  child: ChildProcessWithoutNullStreams | null;
}

export interface StartCalibrationJobOptions {
  cwd: string;
  prompt?: string;
  targetHost?: string;
  timeoutMs?: number;
  port?: number;
}

const jobs = new Map<string, CalibrationJob>();
const PROJECT_ROOT = resolve(join(__dirname, '..', '..'));
const SCRIPT_PATH = join(PROJECT_ROOT, 'scripts', 'calibration-proxy.cjs');
const MAX_OUTPUT_LINES = 80;

function appendOutput(job: CalibrationJob, text: string): void {
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    job.output.push(line);
    if (line.includes('READY ') && line.includes(' log=')) {
      const match = line.match(/\slog=(.+)$/);
      if (match?.[1]) job.logFile = match[1].trim();
      job.status = 'running';
      job.message = 'waiting for Claude Code request';
    }
    if (line.includes('CAPTURED') && line.includes(' log=')) {
      const match = line.match(/\slog=(.+)$/);
      if (match?.[1]) job.logFile = match[1].trim();
      job.status = 'captured';
      job.message = 'captured request; extracting constants';
    }
  }
  if (job.output.length > MAX_OUTPUT_LINES) {
    job.output.splice(0, job.output.length - MAX_OUTPUT_LINES);
  }
}

function snapshot(job: CalibrationJob): CalibrationJobSnapshot {
  const { child: _child, ...rest } = job;
  return { ...rest, output: [...rest.output] };
}

export function startCalibrationJob(options: StartCalibrationJobOptions): CalibrationJobSnapshot {
  const cwd = resolve(options.cwd || '');
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
    throw new Error('cwd must be an existing absolute directory');
  }
  if (!existsSync(SCRIPT_PATH)) {
    throw new Error(`Missing calibration proxy script: ${SCRIPT_PATH}`);
  }

  const jobId = randomUUID();
  const targetHost = options.targetHost || 'api.deepseek.com';
  const timeoutMs = Math.max(5000, Math.min(options.timeoutMs || 45000, 180000));
  const port = options.port || 18443 + Math.floor(Math.random() * 1000);
  const prompt = options.prompt || 'say hi';

  const job: CalibrationJob = {
    jobId,
    status: 'starting',
    cwd,
    targetHost,
    port,
    startedAt: new Date().toISOString(),
    message: 'starting calibration proxy',
    output: [],
    result: null,
    error: null,
    child: null,
  };
  jobs.set(jobId, job);

  const args = [
    SCRIPT_PATH,
    '--cwd', cwd,
    '--target-host', targetHost,
    '--port', String(port),
    '--timeout-ms', String(timeoutMs),
    '--',
    '-p', prompt,
  ];

  const child = spawn(process.execPath, args, {
    cwd: PROJECT_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  job.child = child;

  child.stdout.on('data', (chunk) => appendOutput(job, chunk.toString('utf-8')));
  child.stderr.on('data', (chunk) => appendOutput(job, chunk.toString('utf-8')));
  child.on('error', (err) => {
    job.status = 'failed';
    job.completedAt = new Date().toISOString();
    job.error = err.message;
    job.message = 'failed to start calibration proxy';
    job.child = null;
  });
  child.on('exit', (code) => {
    job.child = null;
    if (job.status === 'cancelled') {
      job.completedAt = new Date().toISOString();
      return;
    }
    if (code !== 0 && job.status !== 'captured') {
      job.status = 'failed';
      job.completedAt = new Date().toISOString();
      job.error = `calibration proxy exited with code ${code}`;
      job.message = code === 2
        ? 'no target request captured; Claude Code may not honor HTTPS_PROXY'
        : 'calibration proxy failed';
      return;
    }
    if (!job.logFile) {
      job.status = 'failed';
      job.completedAt = new Date().toISOString();
      job.error = 'proxy finished without reporting a log file';
      job.message = 'calibration capture missing';
      return;
    }
    job.status = 'extracting';
    job.message = 'extracting constants from capture';
    try {
      const result = extractConstants(job.logFile);
      if (!result) throw new Error('capture log did not contain a valid API request');
      job.result = result;
      job.status = 'ready';
      job.message = 'calibration constants ready';
    } catch (err) {
      job.status = 'failed';
      job.error = (err as Error).message;
      job.message = 'failed to extract constants';
    } finally {
      job.completedAt = new Date().toISOString();
    }
  });

  return snapshot(job);
}

export function getCalibrationJob(jobId: string): CalibrationJobSnapshot | null {
  const job = jobs.get(jobId);
  return job ? snapshot(job) : null;
}

export function cancelCalibrationJob(jobId: string): CalibrationJobSnapshot | null {
  const job = jobs.get(jobId);
  if (!job) return null;
  if (job.child) {
    job.status = 'cancelled';
    job.message = 'calibration cancelled';
    job.completedAt = new Date().toISOString();
    try { job.child.kill('SIGTERM'); } catch { /* already gone */ }
    job.child = null;
  }
  return snapshot(job);
}
```

- [ ] **Step 2: Add route endpoints**

Patch `server/routes/calibrate.ts` imports:

```ts
import {
  cancelCalibrationJob,
  getCalibrationJob,
  startCalibrationJob,
} from '../services/calibration-job';
```

Add before `export default router;`:

```ts
router.post('/auto/start', (req, res) => {
  try {
    const job = startCalibrationJob(req.body || {});
    return res.json({ jobId: job.jobId, ...job });
  } catch (err) {
    return res.status(400).json({ error: (err as Error).message });
  }
});

router.get('/auto/:jobId', (req, res) => {
  const job = getCalibrationJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: '校准任务不存在' });
  return res.json(job);
});

router.post('/auto/:jobId/cancel', (req, res) => {
  const job = cancelCalibrationJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: '校准任务不存在' });
  return res.json(job);
});
```

- [ ] **Step 3: Run type check**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 4: Commit job service and routes**

Run:

```bash
git add server/services/calibration-job.ts server/routes/calibrate.ts
git commit -m "feat(calibrate): add auto job endpoints"
```

## Task 4: Automatic Calibration UI

**Files:**
- Modify: `src/components/pages/CalibratePage.tsx`

- [ ] **Step 1: Add auto job types**

Near existing interfaces in `CalibratePage.tsx`, add:

```ts
type AutoCalibrationStatus =
  | 'starting'
  | 'running'
  | 'captured'
  | 'extracting'
  | 'ready'
  | 'failed'
  | 'cancelled';

interface AutoCalibrationJob {
  jobId: string;
  status: AutoCalibrationStatus;
  cwd: string;
  targetHost: string;
  port: number;
  startedAt: string;
  completedAt?: string;
  logFile?: string;
  message: string;
  output: string[];
  result: ExtractedResult | null;
  error: string | null;
}
```

- [ ] **Step 2: Add automatic calibration state**

Inside `CalibratePage`, after current constants state, add:

```ts
const [autoPrompt, setAutoPrompt] = useState('say hi');
const [autoJob, setAutoJob] = useState<AutoCalibrationJob | null>(null);
const [autoRunning, setAutoRunning] = useState(false);
```

- [ ] **Step 3: Add start and polling handlers**

Inside `CalibratePage`, before `handleDrop`, add:

```ts
const handleAutoStart = useCallback(async () => {
  if (!sessionCwd) {
    setError('请先打开一个会话，以便自动检测项目目录。');
    return;
  }
  setError(null);
  setApplied(false);
  setAutoRunning(true);
  setResult(null);
  try {
    const job = await post<AutoCalibrationJob>('/calibrate/auto/start', {
      cwd: sessionCwd,
      prompt: autoPrompt.trim() || 'say hi',
      targetHost: 'api.deepseek.com',
      timeoutMs: 45000,
    });
    setAutoJob(job);
  } catch (err) {
    setError((err as Error).message);
    setAutoRunning(false);
  }
}, [autoPrompt, sessionCwd]);

useEffect(() => {
  if (!autoJob?.jobId) return;
  if (autoJob.status === 'ready' || autoJob.status === 'failed' || autoJob.status === 'cancelled') {
    setAutoRunning(false);
    if (autoJob.status === 'ready' && autoJob.result) {
      setResult(autoJob.result);
    }
    return;
  }
  const timer = window.setTimeout(async () => {
    try {
      const next = await get<AutoCalibrationJob>(`/calibrate/auto/${autoJob.jobId}`);
      setAutoJob(next);
    } catch (err) {
      setError((err as Error).message);
      setAutoRunning(false);
    }
  }, 1500);
  return () => window.clearTimeout(timer);
}, [autoJob]);

const handleAutoCancel = useCallback(async () => {
  if (!autoJob?.jobId) return;
  try {
    const next = await post<AutoCalibrationJob>(`/calibrate/auto/${autoJob.jobId}/cancel`);
    setAutoJob(next);
    setAutoRunning(false);
  } catch (err) {
    setError((err as Error).message);
  }
}, [autoJob?.jobId]);
```

- [ ] **Step 4: Add automatic section above upload**

Replace the first upload section heading area with a new automatic section, then keep upload below it. Add this before the existing upload section:

```tsx
<section style={{ marginTop: 28 }}>
  <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>1. 自动截获 API 请求</h2>
  <p style={{ fontSize: 13, color: S.textDesc3, marginBottom: 16, lineHeight: 1.6 }}>
    使用无 sudo 本地代理启动一次 Claude Code，请求成功后会自动解析捕获日志。不会修改 /etc/hosts，也不会监听 443 端口。
  </p>
  <div style={{
    border: `1px solid ${S.borderColor}`, borderRadius: 13, padding: '16px 18px',
    background: 'oklch(0.185 0.009 265)', display: 'grid', gap: 12,
  }}>
    <div style={{ fontSize: 12, color: S.textMuted, fontFamily: MONO, wordBreak: 'break-all' }}>
      cwd: {sessionCwd || '未选择会话'}
    </div>
    <input
      value={autoPrompt}
      onChange={(e) => setAutoPrompt(e.target.value)}
      disabled={autoRunning}
      style={{
        border: `1px solid ${S.borderColor}`, borderRadius: 8, padding: '10px 12px',
        background: 'oklch(0.16 0.01 265)', color: S.textPrimary3, fontFamily: MONO,
      }}
      aria-label="校准 prompt"
    />
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <button
        disabled={!sessionCwd || autoRunning}
        onClick={handleAutoStart}
        style={{
          border: 'none', borderRadius: 10, padding: '12px 24px',
          fontSize: 14, fontWeight: 600, fontFamily: SANS,
          cursor: (!sessionCwd || autoRunning) ? 'not-allowed' : 'pointer',
          background: (!sessionCwd || autoRunning) ? 'oklch(0.28 0.01 265)' : 'oklch(0.74 0.13 60)',
          color: (!sessionCwd || autoRunning) ? S.textMuted : 'oklch(0.12 0.01 265)',
        }}
      >
        {autoRunning ? '截获中...' : '自动截获并提取'}
      </button>
      {autoRunning && (
        <button
          onClick={handleAutoCancel}
          style={{
            border: `1px solid ${S.borderColor}`, borderRadius: 10, padding: '11px 18px',
            background: 'transparent', color: S.textSecondary, fontFamily: SANS, cursor: 'pointer',
          }}
        >
          取消
        </button>
      )}
      {autoJob && (
        <span style={{ fontSize: 12, color: autoJob.status === 'failed' ? 'oklch(0.72 0.14 25)' : S.textDesc3 }}>
          {autoJob.message}
        </span>
      )}
    </div>
    {autoJob?.logFile && (
      <div style={{ fontSize: 11, color: S.textMuted, fontFamily: MONO, wordBreak: 'break-all' }}>
        log: {autoJob.logFile}
      </div>
    )}
    {autoJob?.error && (
      <div style={{ fontSize: 12, color: 'oklch(0.72 0.14 25)' }}>
        {autoJob.error}
      </div>
    )}
  </div>
</section>
```

Then change the existing upload heading from `1. 上传截获的 API 日志` to `备用：上传截获的 API 日志`.

- [ ] **Step 5: Run build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit UI**

Run:

```bash
git add src/components/pages/CalibratePage.tsx
git commit -m "feat(calibrate): add auto capture UI"
```

## Task 5: Verification

**Files:**
- All files changed in previous tasks.

- [ ] **Step 1: Run proxy helper tests**

Run:

```bash
node --test scripts/calibration-proxy-utils.test.cjs
```

Expected: PASS.

- [ ] **Step 2: Run build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 3: Start server for manual smoke**

Run:

```bash
npm run server
```

Expected: server starts on `http://localhost:3001`.

- [ ] **Step 4: Start Vite for UI smoke**

Run in a second shell:

```bash
npm run dev -- --host 127.0.0.1
```

Expected: Vite starts and prints a local URL.

- [ ] **Step 5: Manual UI smoke**

In the browser:

1. Open the app.
2. Open an imported Claude Code session.
3. Go to `校准常量`.
4. Confirm the automatic section appears above manual upload.
5. Click `自动截获并提取`.
6. If the environment honors `HTTPS_PROXY`, confirm result cards appear.
7. If not, confirm the page shows the explicit no-capture failure instead of hanging.

- [ ] **Step 6: Final status**

Run:

```bash
git status --short
```

Expected: clean except for intentionally uncommitted runtime artifacts such as local trace logs.
