import { existsSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { spawn, type ChildProcessByStdio } from 'child_process';
import type { Readable } from 'stream';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import type { AgentSource, NormalizedCalibration } from '../../shared/pipeline/calibration-types';
import { normalizeAgentSource } from '../../shared/pipeline/calibration-types';
import { extractConstants } from '../../shared/pipeline/extract-constants';
import { extractCodexConstants } from '../../shared/pipeline/extract-codex-constants';
import { extractOpenCodeConstants } from '../../shared/pipeline/extract-opencode-constants';
import { extractOpenClawConstants } from '../../shared/pipeline/extract-openclaw-constants';
import { extractPiConstants } from '../../shared/pipeline/extract-pi-constants';
import { readClaudeBaseUrl } from './claude-config';
import { readCodexBaseUrl } from './codex-config';

type ProxyUtils = {
  pickPort: (host?: string) => Promise<number>;
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const require = createRequire(import.meta.url);
let pickPort: (host?: string) => Promise<number>;
try {
  ({ pickPort } = require('../../scripts/calibration-proxy-utils.cjs') as ProxyUtils);
} catch {
  // ponytail: fallback if the helper cannot be loaded
  const { createServer } = await import('net');
  pickPort = (host = '127.0.0.1') => new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, host, () => { const port = (s.address() as any)?.port; s.close(() => resolve(port)); });
    s.on('error', reject);
  });
}

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
  source: AgentSource;
  status: CalibrationJobStatus;
  cwd: string;
  targetHost: string;
  port: number;
  startedAt: string;
  completedAt?: string;
  logFile?: string;
  message: string;
  output: string[];
  result: NormalizedCalibration | null;
  error: string | null;
}

interface CalibrationJob extends CalibrationJobSnapshot {
  child: ChildProcessByStdio<null, Readable, Readable> | null;
  cleanupTimer?: NodeJS.Timeout;
}

export interface StartCalibrationJobOptions {
  cwd: string;
  source?: AgentSource;
  prompt?: string;
  targetHost?: string;
  timeoutMs?: number;
  port?: number;
}

const jobs = new Map<string, CalibrationJob>();
const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, '..');
const SCRIPT_PATH = resolve(join(__dirname, '..', '..', 'scripts', 'calibration-proxy.cjs'));
const MAX_OUTPUT_LINES = 80;
const JOB_RETENTION_MS = 15 * 60 * 1000;
const DEFAULT_CALIBRATION_TARGET = 'api.deepseek.com';

function appendOutput(job: CalibrationJob, text: string): void {
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    job.output.push(line);
    if (line.includes('READY ') && line.includes(' log=')) {
      const match = line.match(/\slog=(.+)$/);
      if (match?.[1]) job.logFile = match[1].trim();
      job.status = 'running';
      job.message = `waiting for ${job.source} request`;
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

export function summarizeCalibrationProxyExit(code: number | null, output: string[]): string {
  const fallback = `calibration proxy exited with code ${code}`;
  const explicitError = [...output].reverse().find((line) => line.includes('[calibration-proxy] ERROR '));
  if (explicitError) {
    const detail = explicitError.replace(/^.*?\[calibration-proxy\] ERROR\s+/, '').trim();
    return detail ? `${detail}; ${fallback}` : fallback;
  }
  const childDetail = output
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('[calibration-proxy] READY '))
    .filter((line) => !line.startsWith('[calibration-proxy] Launching:'))
    .filter((line) => !line.startsWith('[calibration-proxy] CONNECT '))
    .slice(-6)
    .join('; ');
  return childDetail ? `${childDetail}; ${fallback}` : fallback;
}

function snapshot(job: CalibrationJob): CalibrationJobSnapshot {
  const { child: _child, cleanupTimer: _cleanupTimer, ...rest } = job;
  return { ...rest, output: [...rest.output] };
}

function scheduleCleanup(job: CalibrationJob): void {
  if (job.cleanupTimer) clearTimeout(job.cleanupTimer);
  job.cleanupTimer = setTimeout(() => {
    jobs.delete(job.jobId);
  }, JOB_RETENTION_MS);
}

async function choosePort(preferred?: number): Promise<number> {
  if (preferred && Number.isFinite(preferred) && preferred > 0) {
    // 尝试使用指定端口，被占用则回退
    const { createServer } = await import('net');
    try {
      await new Promise<void>((resolve, reject) => {
        const s = createServer();
        s.once('error', reject);
        s.listen(preferred, '127.0.0.1', () => { s.close(() => resolve()); });
      });
      return preferred;
    } catch { /* 端口占用，回退到随机 */ }
  }
  return pickPort('127.0.0.1');
}

export function defaultCalibrationPrompt(source: AgentSource): string {
  return source === 'claude' ? 'say hi' : 'Calibration probe: reply with "ok".';
}

export function defaultCalibrationTarget(
  source: AgentSource,
  readCodexTarget = readCodexBaseUrl,
  readClaudeTarget = readClaudeBaseUrl,
): string {
  if (source === 'codex') return readCodexTarget();
  if (source === 'claude') return readClaudeTarget();
  return DEFAULT_CALIBRATION_TARGET;
}

export function buildCalibrationProxyArgs(options: {
  source: AgentSource;
  scriptPath: string;
  cwd: string;
  targetHost: string;
  port: number;
  timeoutMs: number;
  prompt: string;
}): string[] {
  const base = [
    options.scriptPath,
    '--source', options.source,
    '--cwd', options.cwd,
    '--target-host', options.targetHost,
    '--port', String(options.port),
    '--timeout-ms', String(options.timeoutMs),
    '--',
  ];

  return options.source === 'claude'
    ? [...base, '-p', options.prompt]
    : [...base, options.prompt];
}

export async function startCalibrationJob(options: StartCalibrationJobOptions): Promise<CalibrationJobSnapshot> {
  const source = normalizeAgentSource(options.source);
  const cwd = resolve(options.cwd || '');
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
    throw new Error('cwd must be an existing absolute directory');
  }
  if (!existsSync(SCRIPT_PATH)) {
    throw new Error(`Missing calibration proxy script: ${SCRIPT_PATH}`);
  }

  const jobId = randomUUID();
  const targetHost = options.targetHost || defaultCalibrationTarget(source);
  const timeoutMs = Math.max(5000, Math.min(options.timeoutMs || 45000, 180000));
  const port = await choosePort(options.port);
  const prompt = options.prompt || defaultCalibrationPrompt(source);

  const job: CalibrationJob = {
    jobId,
    source,
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

  const args = buildCalibrationProxyArgs({
    source,
    scriptPath: SCRIPT_PATH,
    cwd,
    targetHost,
    port,
    timeoutMs,
    prompt,
  });

  const env: Record<string, string> = { ...process.env as Record<string, string> };

  const child = spawn(process.execPath, args, {
    cwd: __dirname,
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
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
    scheduleCleanup(job);
  });
  child.on('exit', (code) => {
    job.child = null;
    if (job.status === 'cancelled') {
      job.completedAt = new Date().toISOString();
      scheduleCleanup(job);
      return;
    }
    if (code !== 0 && job.status !== 'captured') {
      job.status = 'failed';
      job.completedAt = new Date().toISOString();
      job.error = summarizeCalibrationProxyExit(code, job.output);
      job.message = code === 2
        ? 'no target request captured; capture target may not match the active agent API host'
        : 'calibration proxy failed';
      scheduleCleanup(job);
      return;
    }
    if (!job.logFile) {
      job.status = 'failed';
      job.completedAt = new Date().toISOString();
      job.error = 'proxy finished without reporting a log file';
      job.message = 'calibration capture missing';
      scheduleCleanup(job);
      return;
    }
    job.status = 'extracting';
    job.message = 'extracting constants from capture';
    try {
      const extracted = extractCalibrationConstantsForSource(source, job.logFile);
      if (!extracted) throw new Error('capture log did not contain a valid API request');
      job.result = {
        schemaVersion: 1,
        source,
        constantsSource: 'project',
        cwd: job.cwd,
        rawLogPath: job.logFile,
        cliVersion: 'cliVersion' in extracted ? extracted.cliVersion : undefined,
        ccVersion: 'ccVersion' in extracted ? extracted.ccVersion : undefined,
        model: extracted.model,
        wireApi: 'wireApi' in extracted ? extracted.wireApi : undefined,
        categories: extracted.summary.categories,
        usage: extracted.summary.usage,
        toolNames: extracted.summary.toolNames,
        hashes: extracted.summary.hashes,
        details: extracted.details,
      };
      job.status = 'ready';
      job.message = 'calibration constants ready';
    } catch (err) {
      job.status = 'failed';
      job.error = (err as Error).message;
      job.message = 'failed to extract constants';
    } finally {
      job.completedAt = new Date().toISOString();
      scheduleCleanup(job);
    }
  });

  return snapshot(job);
}

function extractCalibrationConstantsForSource(source: AgentSource, logFile: string) {
  switch (source) {
    case 'claude':
      return extractConstants(logFile);
    case 'codex':
      return extractCodexConstants(logFile);
    case 'opencode':
      return extractOpenCodeConstants(logFile);
    case 'pi':
      return extractPiConstants(logFile);
    case 'openclaw':
      return extractOpenClawConstants(logFile);
  }
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
    scheduleCleanup(job);
  }
  return snapshot(job);
}
