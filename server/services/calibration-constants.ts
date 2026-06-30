import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import {
  type AgentSource,
  type LegacyClaudeDetails,
  type LegacyClaudeSummary,
  type NormalizedCalibration,
  type NormalizedCalibrationSummary,
  CALIBRATION_DEFAULTS,
  legacyClaudeSummaryToNormalized,
  normalizeAgentSource,
  normalizedToLegacyClaudeSummary,
} from '../../src/pipeline/calibration-types';

export const DEFAULT_CALIBRATION_CONSTANTS = {
  SYS_PROMPT_FALLBACK_CHARS: CALIBRATION_DEFAULTS.SYS_PROMPT_CHARS,
  TOOL_DEFS_FALLBACK_CHARS: CALIBRATION_DEFAULTS.TOOL_DEFS_CHARS,
  SYSTEM_REMINDER_CHROME_CHARS: CALIBRATION_DEFAULTS.USER_WRAPPER_CHARS,
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

export interface ReadCalibrationConstantsOptions {
  homeDir?: string;
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

function readOptionalFile(path: string): string {
  try {
    return existsSync(path) ? readFileSync(path, 'utf-8') : '';
  } catch {
    return '';
  }
}

export function readClaudeMemoryConstants(cwd: string, homeDir = homedir()): Pick<NormalizedCalibration, 'categories' | 'details'> {
  const normalized = normalizeProjectCwd(cwd);
  const globalPath = join(homeDir, '.claude', 'CLAUDE.md');
  const projectPath = join(normalized, '.claude', 'CLAUDE.md');
  const globalText = readOptionalFile(globalPath);
  const projectText = readOptionalFile(projectPath);

  const categories: NormalizedCalibration['categories'] = {};
  const details: Record<string, string> = {};
  if (globalText.length > 0) {
    categories.memoryGlobal = { chars: globalText.length, detailKey: 'claude.memory.global', origin: 'default' };
    details['claude.memory.global'] = globalText;
  }
  if (projectText.length > 0) {
    categories.memoryProject = { chars: projectText.length, detailKey: 'claude.memory.project', origin: 'default' };
    details['claude.memory.project'] = projectText;
  }
  return {
    categories,
    ...(Object.keys(details).length > 0 ? { details } : {}),
  };
}

function withClaudeMemoryConstants(
  calibration: NormalizedCalibration,
  homeDir?: string,
): NormalizedCalibration {
  if (calibration.source !== 'claude') return calibration;
  const memory = readClaudeMemoryConstants(calibration.cwd || '', homeDir);
  const categories = { ...calibration.categories };
  if (!categories.memoryGlobal && memory.categories.memoryGlobal) {
    categories.memoryGlobal = memory.categories.memoryGlobal;
  }
  if (!categories.memoryProject && memory.categories.memoryProject) {
    categories.memoryProject = memory.categories.memoryProject;
  }
  const details = { ...(calibration.details ?? {}) };
  if (!details['claude.memory.global'] && memory.details?.['claude.memory.global']) {
    details['claude.memory.global'] = memory.details['claude.memory.global'];
  }
  if (!details['claude.memory.project'] && memory.details?.['claude.memory.project']) {
    details['claude.memory.project'] = memory.details['claude.memory.project'];
  }
  return {
    ...calibration,
    categories,
    ...(Object.keys(details).length ? { details } : {}),
  };
}

function defaultNormalizedConstants(cwd: string, source: AgentSource, path: string, homeDir?: string): NormalizedCalibration {
  if (source === 'claude') {
    const converted = legacyClaudeSummaryToNormalized(DEFAULT_CALIBRATION_CONSTANTS);
    return withClaudeMemoryConstants({
      schemaVersion: 1,
      source,
      constantsSource: 'defaults',
      path,
      cwd,
      note: '当前项目尚未应用校准常量。',
      ...converted,
    }, homeDir);
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

interface LoadedCalibrationData {
  schemaVersion?: number;
  categories?: Record<string, unknown>;
  constantsSource?: string;
  path?: string;
  cwd?: string;
  note?: string;
  appliedAt?: string;
  ccVersion?: string;
  model?: string;
  details?: Record<string, string>;
  SYS_PROMPT_FALLBACK_CHARS?: number;
  TOOL_DEFS_FALLBACK_CHARS?: number;
  SYSTEM_REMINDER_CHROME_CHARS?: number;
}

function normalizeLoadedConstants(
  data: LoadedCalibrationData,
  source: AgentSource,
  cwd: string,
  path: string,
  homeDir?: string,
): NormalizedCalibration {
  if (data?.schemaVersion === 1 && data?.categories && typeof data.categories === 'object') {
    return withClaudeMemoryConstants({
      ...data,
      schemaVersion: 1,
      source,
      constantsSource: 'project',
      path,
      cwd,
      categories: data.categories,
    }, homeDir);
  }

  if (source === 'claude') {
    const converted = legacyClaudeSummaryToNormalized({
      SYS_PROMPT_FALLBACK_CHARS: Number(data?.SYS_PROMPT_FALLBACK_CHARS ?? DEFAULT_CALIBRATION_CONSTANTS.SYS_PROMPT_FALLBACK_CHARS),
      TOOL_DEFS_FALLBACK_CHARS: Number(data?.TOOL_DEFS_FALLBACK_CHARS ?? DEFAULT_CALIBRATION_CONSTANTS.TOOL_DEFS_FALLBACK_CHARS),
      SYSTEM_REMINDER_CHROME_CHARS: Number(data?.SYSTEM_REMINDER_CHROME_CHARS ?? DEFAULT_CALIBRATION_CONSTANTS.SYSTEM_REMINDER_CHROME_CHARS),
    }, data?.details);
    return withClaudeMemoryConstants({
      schemaVersion: 1,
      source,
      constantsSource: 'project',
      path,
      cwd,
      appliedAt: data?.appliedAt,
      ccVersion: data?.ccVersion,
      model: data?.model,
      ...converted,
    }, homeDir);
  }

  return defaultNormalizedConstants(cwd, source, path, homeDir);
}

export function readCalibrationConstants(
  cwd: string,
  source: AgentSource = 'claude',
  options: ReadCalibrationConstantsOptions = {},
): NormalizedCalibration {
  const agent = normalizeAgentSource(source);
  const normalized = normalizeProjectCwd(cwd);
  const path = resolveProjectConstantsPath(normalized, agent);
  if (!existsSync(path)) return defaultNormalizedConstants(normalized, agent, path, options.homeDir);
  const data = JSON.parse(readFileSync(path, 'utf-8'));
  return normalizeLoadedConstants(data, agent, normalized, path, options.homeDir);
}

export function writeCalibrationConstants(cwd: string, input: WriteCalibrationConstantsInput): NormalizedCalibration {
  const agent = normalizeAgentSource(input.source);
  const normalized = normalizeProjectCwd(cwd);
  ensureWritableTraceDir(normalized, agent);
  const path = resolveProjectConstantsPath(normalized, agent);
  const memory = agent === 'claude' ? readClaudeMemoryConstants(normalized) : null;
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
    categories: {
      ...(memory?.categories ?? {}),
      ...input.summary.categories,
    },
    ...(input.summary.usage ? { usage: input.summary.usage } : {}),
    ...(input.summary.toolNames ? { toolNames: input.summary.toolNames } : {}),
    ...(input.summary.hashes ? { hashes: input.summary.hashes } : {}),
    ...((input.details || memory?.details) ? { details: { ...(memory?.details ?? {}), ...(input.details ?? {}) } } : {}),
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
