import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import {
  type AgentSource,
  type LegacyClaudeDetails,
  type LegacyClaudeSummary,
  type NormalizedCalibration,
  type NormalizedCalibrationSummary,
  legacyClaudeSummaryToNormalized,
  normalizeAgentSource,
  normalizedToLegacyClaudeSummary,
} from '../../src/pipeline/calibration-types';

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
  details?: LegacyClaudeDetails | Record<string, string>;
}

export interface WriteProjectConstantsInput {
  summary: LegacyClaudeSummary | NormalizedCalibrationSummary;
  details?: LegacyClaudeDetails | Record<string, string>;
  ccVersion?: string;
  model?: string;
}

export interface WriteCalibrationConstantsInput {
  source?: AgentSource;
  summary: NormalizedCalibrationSummary;
  details?: Record<string, string>;
  ccVersion?: string;
  cliVersion?: string;
  model?: string;
  wireApi?: string;
  rawLogPath?: string;
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

export function resolveProjectTraceDir(cwd: string, source: AgentSource = 'claude'): string {
  const agent = normalizeAgentSource(source);
  return join(normalizeProjectCwd(cwd), agent === 'claude' ? '.claude-trace' : `.${agent}-trace`);
}

export function resolveProjectConstantsPath(cwd: string, source: AgentSource = 'claude'): string {
  const agent = normalizeAgentSource(source);
  const filename = agent === 'claude' ? 'system-constants.json' : `${agent}-system-constants.json`;
  return join(resolveProjectTraceDir(cwd, agent), filename);
}

function ensureWritableTraceDir(cwd: string, source: AgentSource): string {
  const traceDir = resolveProjectTraceDir(cwd, source);
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

function defaultNormalizedConstants(cwd: string, source: AgentSource, path: string): NormalizedCalibration {
  if (source === 'claude') {
    const converted = legacyClaudeSummaryToNormalized(DEFAULT_CALIBRATION_CONSTANTS);
    return {
      schemaVersion: 1,
      source,
      constantsSource: 'defaults',
      path,
      cwd,
      note: '当前项目尚未应用校准常量。',
      ...converted,
    };
  }

  return {
    schemaVersion: 1,
    source,
    constantsSource: 'defaults',
    path,
    cwd,
    note: '当前项目尚未应用校准常量。',
    categories: {},
  };
}

function normalizeLoadedConstants(
  data: any,
  source: AgentSource,
  cwd: string,
  path: string,
): NormalizedCalibration {
  if (data?.schemaVersion === 1 && data?.categories && typeof data.categories === 'object') {
    return {
      ...data,
      schemaVersion: 1,
      source,
      constantsSource: 'project',
      path,
      cwd,
    };
  }

  if (source === 'claude') {
    const converted = legacyClaudeSummaryToNormalized({
      SYS_PROMPT_FALLBACK_CHARS: Number(data?.SYS_PROMPT_FALLBACK_CHARS ?? DEFAULT_CALIBRATION_CONSTANTS.SYS_PROMPT_FALLBACK_CHARS),
      TOOL_DEFS_FALLBACK_CHARS: Number(data?.TOOL_DEFS_FALLBACK_CHARS ?? DEFAULT_CALIBRATION_CONSTANTS.TOOL_DEFS_FALLBACK_CHARS),
      SYSTEM_REMINDER_CHROME_CHARS: Number(data?.SYSTEM_REMINDER_CHROME_CHARS ?? DEFAULT_CALIBRATION_CONSTANTS.SYSTEM_REMINDER_CHROME_CHARS),
    }, data?.details);
    return {
      schemaVersion: 1,
      source,
      constantsSource: 'project',
      path,
      cwd,
      appliedAt: data?.appliedAt,
      ccVersion: data?.ccVersion,
      model: data?.model,
      ...converted,
    };
  }

  return defaultNormalizedConstants(cwd, source, path);
}

export function readCalibrationConstants(cwd: string, source: AgentSource = 'claude'): NormalizedCalibration {
  const agent = normalizeAgentSource(source);
  const normalized = normalizeProjectCwd(cwd);
  const path = resolveProjectConstantsPath(normalized, agent);
  if (!existsSync(path)) return defaultNormalizedConstants(normalized, agent, path);
  const data = JSON.parse(readFileSync(path, 'utf-8'));
  return normalizeLoadedConstants(data, agent, normalized, path);
}

export function writeCalibrationConstants(cwd: string, input: WriteCalibrationConstantsInput): NormalizedCalibration {
  const agent = normalizeAgentSource(input.source);
  const normalized = normalizeProjectCwd(cwd);
  ensureWritableTraceDir(normalized, agent);
  const path = resolveProjectConstantsPath(normalized, agent);
  const data: NormalizedCalibration = {
    schemaVersion: 1,
    source: agent,
    constantsSource: 'project',
    path,
    cwd: normalized,
    appliedAt: new Date().toISOString(),
    ccVersion: input.ccVersion,
    cliVersion: input.cliVersion,
    model: input.model || 'unknown',
    wireApi: input.wireApi,
    rawLogPath: input.rawLogPath,
    categories: input.summary.categories,
    ...(input.summary.usage ? { usage: input.summary.usage } : {}),
    ...(input.summary.toolNames ? { toolNames: input.summary.toolNames } : {}),
    ...(input.summary.hashes ? { hashes: input.summary.hashes } : {}),
    ...(input.details ? { details: input.details } : {}),
  };

  try {
    writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
  } catch (err) {
    const traceDir = resolveProjectTraceDir(normalized, agent);
    throw new Error(
      `项目日志目录不可写: ${traceDir}。请执行: sudo chown -R "$USER":staff ${shellQuote(traceDir)}。原因: ${(err as Error).message}`,
    );
  }
  return data;
}

export function readProjectConstants(cwd: string): ProjectCalibrationConstants {
  const normalized = readCalibrationConstants(cwd, 'claude');
  const legacy = normalizedToLegacyClaudeSummary(normalized);
  return {
    source: normalized.constantsSource ?? 'defaults',
    path: normalized.path || resolveProjectConstantsPath(cwd, 'claude'),
    cwd: normalized.cwd || normalizeProjectCwd(cwd),
    note: normalized.note,
    appliedAt: normalized.appliedAt,
    ccVersion: normalized.ccVersion,
    model: normalized.model,
    ...legacy,
    details: normalized.details,
  };
}

export function writeProjectConstants(cwd: string, input: WriteProjectConstantsInput): ProjectCalibrationConstants {
  const converted = 'categories' in input.summary
    ? { ...input.summary, details: input.details as Record<string, string> | undefined }
    : legacyClaudeSummaryToNormalized(input.summary, input.details as LegacyClaudeDetails | undefined);
  const normalized = writeCalibrationConstants(cwd, {
    source: 'claude',
    summary: converted,
    details: converted.details,
    ccVersion: input.ccVersion,
    model: input.model,
  });
  const legacy = normalizedToLegacyClaudeSummary(normalized);
  return {
    source: 'project',
    path: normalized.path!,
    cwd: normalized.cwd!,
    appliedAt: normalized.appliedAt,
    ccVersion: normalized.ccVersion,
    model: normalized.model,
    ...legacy,
    details: input.details,
  };
}
