import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import type { ExtractedConstants } from '../../src/pipeline/extract-constants';

export const DEFAULT_CALIBRATION_CONSTANTS = {
  SYS_PROMPT_FALLBACK_CHARS: 5768,
  TOOL_DEFS_FALLBACK_CHARS: 98949,
  SYSTEM_REMINDER_CHROME_CHARS: 612,
};

export type CalibrationConstantsSource = 'project' | 'defaults';

export interface ProjectCalibrationConstants {
  source: CalibrationConstantsSource;
  path: string;
  cwd: string;
  note?: string;
  appliedAt?: string;
  ccVersion?: string;
  model?: string;
  SYS_PROMPT_FALLBACK_CHARS: number;
  TOOL_DEFS_FALLBACK_CHARS: number;
  SYSTEM_REMINDER_CHROME_CHARS: number;
  details?: ExtractedConstants['details'];
}

export interface WriteProjectConstantsInput {
  summary: ExtractedConstants['summary'];
  details?: ExtractedConstants['details'];
  ccVersion?: string;
  model?: string;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function normalizeProjectCwd(cwd: string): string {
  if (!cwd || typeof cwd !== 'string') {
    throw new Error('缺少 cwd，无法确定当前项目。');
  }
  const normalized = resolve(cwd);
  if (!existsSync(normalized) || !statSync(normalized).isDirectory()) {
    throw new Error(`cwd 不是有效目录: ${normalized}`);
  }
  return normalized;
}

export function resolveProjectTraceDir(cwd: string): string {
  return join(normalizeProjectCwd(cwd), '.claude-trace');
}

export function resolveProjectConstantsPath(cwd: string): string {
  return join(resolveProjectTraceDir(cwd), 'system-constants.json');
}

function ensureWritableTraceDir(cwd: string): string {
  const traceDir = resolveProjectTraceDir(cwd);
  try {
    mkdirSync(traceDir, { recursive: true });
    if (!statSync(traceDir).isDirectory()) {
      throw new Error('path exists but is not a directory');
    }
  } catch (err) {
    throw new Error(
      `项目日志目录不可写: ${traceDir}。请执行: sudo chown -R "$USER":staff ${shellQuote(traceDir)}。原因: ${(err as Error).message}`,
    );
  }
  return traceDir;
}

export function readProjectConstants(cwd: string): ProjectCalibrationConstants {
  const normalized = normalizeProjectCwd(cwd);
  const path = resolveProjectConstantsPath(normalized);
  if (!existsSync(path)) {
    return {
      source: 'defaults',
      path,
      cwd: normalized,
      note: '当前项目尚未应用校准常量。',
      ...DEFAULT_CALIBRATION_CONSTANTS,
    };
  }

  const data = JSON.parse(readFileSync(path, 'utf-8')) as Partial<ProjectCalibrationConstants>;
  return {
    source: 'project',
    path,
    cwd: normalized,
    appliedAt: data.appliedAt,
    ccVersion: data.ccVersion,
    model: data.model,
    SYS_PROMPT_FALLBACK_CHARS: Number(data.SYS_PROMPT_FALLBACK_CHARS ?? DEFAULT_CALIBRATION_CONSTANTS.SYS_PROMPT_FALLBACK_CHARS),
    TOOL_DEFS_FALLBACK_CHARS: Number(data.TOOL_DEFS_FALLBACK_CHARS ?? DEFAULT_CALIBRATION_CONSTANTS.TOOL_DEFS_FALLBACK_CHARS),
    SYSTEM_REMINDER_CHROME_CHARS: Number(data.SYSTEM_REMINDER_CHROME_CHARS ?? DEFAULT_CALIBRATION_CONSTANTS.SYSTEM_REMINDER_CHROME_CHARS),
    details: data.details,
  };
}

export function writeProjectConstants(cwd: string, input: WriteProjectConstantsInput): ProjectCalibrationConstants {
  const normalized = normalizeProjectCwd(cwd);
  ensureWritableTraceDir(normalized);
  const path = resolveProjectConstantsPath(normalized);
  const data = {
    source: 'project' as const,
    path,
    cwd: normalized,
    appliedAt: new Date().toISOString(),
    ccVersion: input.ccVersion || 'unknown',
    model: input.model || 'unknown',
    ...input.summary,
    ...(input.details ? { details: input.details } : {}),
  };
  try {
    writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
  } catch (err) {
    const traceDir = resolveProjectTraceDir(normalized);
    throw new Error(
      `项目日志目录不可写: ${traceDir}。请执行: sudo chown -R "$USER":staff ${shellQuote(traceDir)}。原因: ${(err as Error).message}`,
    );
  }
  return data;
}
