/**
 * calibration-types.ts — 校准类型。
 *
 * 类型定义已迁移到 shared/types/calibration.ts。
 * 本文件保留独有工具函数并重导出共享类型。
 */

// Re-export all shared types
export type {
  AgentSource,
  CalibrationCategory,
  CalibrationUsage,
  CalibrationCategoryKey,
  NormalizedCalibrationSummary,
  NormalizedCalibration,
} from '../types/calibration';

export { CALIBRATION_DEFAULTS } from '../types/calibration';

// ── 本文件独有的工具函数 ──────────────────────────────────────────────────────

import type { NormalizedCalibrationSummary, CalibrationCategoryKey, AgentSource } from '../types/calibration';

export interface LegacyClaudeSummary {
  SYS_PROMPT_FALLBACK_CHARS: number;
  TOOL_DEFS_FALLBACK_CHARS: number;
  SYSTEM_REMINDER_CHROME_CHARS: number;
}

export type LegacyClaudeDetails = Partial<Record<keyof LegacyClaudeSummary, string>>;

export function normalizeAgentSource(value: unknown): AgentSource {
  if (value == null || value === '') return 'claude';
  if (value === 'claude' || value === 'codex' || value === 'opencode' || value === 'pi' || value === 'openclaw') {
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

export function memoryCategoryChars(
  calibration: Pick<NormalizedCalibrationSummary, 'categories'> | null | undefined,
): number {
  const split = categoryChars(calibration, 'memoryGlobal') + categoryChars(calibration, 'memoryProject');
  return split > 0 ? split : categoryChars(calibration, 'memory');
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
