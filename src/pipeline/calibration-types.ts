export type AgentSource = 'claude' | 'codex' | 'opencode' | 'openclaw';

export type CalibrationCategoryKey =
  | 'sysPrompt'
  | 'tool_defs'
  | 'skills'
  | 'memory'
  | 'mcp'
  | 'reminders'
  | 'userMsgs';

export interface CalibrationCategory {
  chars: number;
  tokens?: number;
  detailKey?: string;
  origin?: 'capture' | 'jsonl' | 'default';
}

export interface CalibrationUsage {
  firstRequestInputTokens?: number;
  firstRequestCachedTokens?: number;
  firstRequestOutputTokens?: number;
  firstRequestReasoningTokens?: number;
}

export interface NormalizedCalibrationSummary {
  categories: Partial<Record<CalibrationCategoryKey, CalibrationCategory>>;
  usage?: CalibrationUsage;
  toolNames?: string[];
  hashes?: Record<string, string>;
}

export interface NormalizedCalibration extends NormalizedCalibrationSummary {
  schemaVersion: 1;
  source: AgentSource;
  constantsSource?: 'project' | 'defaults';
  path?: string;
  cwd?: string;
  note?: string;
  appliedAt?: string;
  cliVersion?: string;
  ccVersion?: string;
  model?: string;
  wireApi?: string;
  rawLogPath?: string;
  details?: Record<string, string>;
}

export interface LegacyClaudeSummary {
  SYS_PROMPT_FALLBACK_CHARS: number;
  TOOL_DEFS_FALLBACK_CHARS: number;
  SYSTEM_REMINDER_CHROME_CHARS: number;
}

export type LegacyClaudeDetails = Partial<Record<keyof LegacyClaudeSummary, string>>;

export function normalizeAgentSource(value: unknown): AgentSource {
  if (value == null || value === '') return 'claude';
  if (value === 'claude' || value === 'codex' || value === 'opencode' || value === 'openclaw') {
    return value;
  }
  throw new Error(`Unsupported calibration source: ${String(value)}`);
}

export function categoryChars(
  calibration: Pick<NormalizedCalibrationSummary, 'categories'> | null | undefined,
  key: CalibrationCategoryKey,
): number {
  const chars = calibration?.categories?.[key]?.chars;
  return typeof chars === 'number' && Number.isFinite(chars) && chars > 0 ? chars : 0;
}

export function legacyClaudeSummaryToNormalized(
  summary: LegacyClaudeSummary,
  details?: LegacyClaudeDetails,
): NormalizedCalibrationSummary & { details?: Record<string, string> } {
  const normalizedDetails: Record<string, string> = {};
  if (details?.SYS_PROMPT_FALLBACK_CHARS) normalizedDetails['claude.sysPrompt'] = details.SYS_PROMPT_FALLBACK_CHARS;
  if (details?.TOOL_DEFS_FALLBACK_CHARS) normalizedDetails['claude.tool_defs'] = details.TOOL_DEFS_FALLBACK_CHARS;
  if (details?.SYSTEM_REMINDER_CHROME_CHARS) normalizedDetails['claude.userMsgs'] = details.SYSTEM_REMINDER_CHROME_CHARS;

  return {
    categories: {
      sysPrompt: { chars: Number(summary.SYS_PROMPT_FALLBACK_CHARS || 0), detailKey: 'claude.sysPrompt', origin: 'capture' },
      tool_defs: { chars: Number(summary.TOOL_DEFS_FALLBACK_CHARS || 0), detailKey: 'claude.tool_defs', origin: 'capture' },
      userMsgs: { chars: Number(summary.SYSTEM_REMINDER_CHROME_CHARS || 0), detailKey: 'claude.userMsgs', origin: 'capture' },
    },
    ...(Object.keys(normalizedDetails).length ? { details: normalizedDetails } : {}),
  };
}

export function normalizedToLegacyClaudeSummary(summary: NormalizedCalibrationSummary): LegacyClaudeSummary {
  return {
    SYS_PROMPT_FALLBACK_CHARS: categoryChars(summary, 'sysPrompt'),
    TOOL_DEFS_FALLBACK_CHARS: categoryChars(summary, 'tool_defs'),
    SYSTEM_REMINDER_CHROME_CHARS: categoryChars(summary, 'userMsgs'),
  };
}
