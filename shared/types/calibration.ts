/**
 * shared/types/calibration.ts — 校准相关的共享类型定义。
 *
 * 被 server/ 和 src/ 共同引用，消除双向依赖。
 */

export type AgentSource = 'claude' | 'codex' | 'opencode' | 'pi' | 'openclaw';

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

export type CalibrationCategoryKey =
  | 'sysPrompt'
  | 'tool_defs'
  | 'skills'
  | 'memory'
  | 'memoryGlobal'
  | 'memoryProject'
  | 'mcp'
  | 'reminders'
  | 'userMsgs';

export interface NormalizedCalibrationSummary {
  categories: Partial<Record<CalibrationCategoryKey, CalibrationCategory>>;
  usage?: CalibrationUsage;
  toolNames?: string[];
  hashes?: Record<string, string>;
}

export interface NormalizedCalibration extends NormalizedCalibrationSummary {
  schemaVersion: 1;
  source: AgentSource;
  constantsSource?: 'project' | 'defaults' | 'capture';
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

/** 校准常量默认值 — 唯一真实来源。 */
export const CALIBRATION_DEFAULTS = {
  SYS_PROMPT_CHARS: 5768,
  TOOL_DEFS_CHARS: 98949,
  USER_WRAPPER_CHARS: 612,
  SKILLS_CHARS: 9122,
  MCP_CHARS: 222,
  REMINDERS_CHARS: 409,
  MEMORY_CHARS: 2474,
};
