import { existsSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { extractConstants, type ExtractedConstants } from '../../src/pipeline/extract-constants';

type ProxyUtils = {
  pickPort: (host?: string) => Promise<number>;
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const require = createRequire(import.meta.url);
const { pickPort } = require('../../scripts/calibration-proxy-utils.cjs') as ProxyUtils;

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
  cleanupTimer?: NodeJS.Timeout;
}

export interface StartCalibrationJobOptions {
  cwd: string;
  prompt?: string;
  targetHost?: string;
  timeoutMs?: number;
  port?: number;
}

const jobs = new Map<string, CalibrationJob>();
const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, '..');
const PROJECT_ROOT = resolve(join(__dirname, '..', '..'));
const SCRIPT_PATH = join(PROJECT_ROOT, 'scripts', 'calibration-proxy.cjs');
const MAX_OUTPUT_LINES = 80;
const JOB_RETENTION_MS = 15 * 60 * 1000;

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
  if (preferred && Number.isFinite(preferred) && preferred > 0) return preferred;
  return pickPort('127.0.0.1');
}

export async function startCalibrationJob(options: StartCalibrationJobOptions): Promise<CalibrationJobSnapshot> {
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
  const port = await choosePort(options.port);
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
      job.error = `calibration proxy exited with code ${code}`;
      job.message = code === 2
        ? 'no target request captured; capture target may not match the active Claude Code base URL'
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
      scheduleCleanup(job);
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
    scheduleCleanup(job);
  }
  return snapshot(job);
}
