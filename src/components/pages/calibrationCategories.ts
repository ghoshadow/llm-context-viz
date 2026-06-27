export type AgentSource = 'claude' | 'codex' | 'opencode' | 'openclaw';

export interface CalibrationCategoryValue {
  chars: number;
  tokens?: number;
  detailKey?: string;
  origin?: string;
}

export type CalibrationCategoryMap = Partial<Record<string, CalibrationCategoryValue>>;
export type CalibrationDetails = Record<string, string>;

export interface NormalizedCalibrationSummaryLike {
  categories: CalibrationCategoryMap;
  usage?: {
    firstRequestInputTokens?: number;
    firstRequestCachedTokens?: number;
    firstRequestOutputTokens?: number;
    firstRequestReasoningTokens?: number;
  };
  toolNames?: string[];
  hashes?: Record<string, string>;
}

export interface CalibrationResultLike {
  categories?: CalibrationCategoryMap;
  usage?: NormalizedCalibrationSummaryLike['usage'];
  toolNames?: string[];
  hashes?: Record<string, string>;
  summary?: NormalizedCalibrationSummaryLike | LegacyClaudeSummaryLike;
}

export interface CalibrationCategoryRow {
  key: string;
  label: string;
  chars: number;
  tokens?: number;
  detailKey: string;
  detail?: string;
  origin?: string;
}

interface LegacyClaudeSummaryLike {
  SYS_PROMPT_FALLBACK_CHARS?: number;
  TOOL_DEFS_FALLBACK_CHARS?: number;
  SYSTEM_REMINDER_CHROME_CHARS?: number;
}

const CATEGORY_ORDER = ['sysPrompt', 'tool_defs', 'memoryGlobal', 'memoryProject', 'skills', 'memory', 'mcp', 'reminders', 'userMsgs'];

const CATEGORY_LABELS: Record<string, string> = {
  sysPrompt: '系统提示',
  tool_defs: '工具定义',
  memoryGlobal: '全局 CLAUDE.md',
  memoryProject: '项目 CLAUDE.md',
  skills: '技能定义',
  memory: '记忆文件',
  mcp: 'MCP / 插件',
  reminders: '运行时提醒',
  userMsgs: '用户消息包装',
};

export function getNormalizedCalibrationSummary(result: CalibrationResultLike | null | undefined): NormalizedCalibrationSummaryLike {
  if (!result) return { categories: {} };
  if (hasNormalizedCategories(result.summary)) {
    return {
      categories: result.summary.categories ?? {},
      usage: result.summary.usage,
      toolNames: result.summary.toolNames,
      hashes: result.summary.hashes,
    };
  }
  if (hasTopLevelCategories(result)) {
    return {
      categories: result.categories ?? {},
      usage: result.usage,
      toolNames: result.toolNames,
      hashes: result.hashes,
    };
  }
  if (isLegacyClaudeSummary(result.summary)) {
    return {
      categories: {
        sysPrompt: {
          chars: Number(result.summary.SYS_PROMPT_FALLBACK_CHARS || 0),
          detailKey: 'SYS_PROMPT_FALLBACK_CHARS',
        },
        tool_defs: {
          chars: Number(result.summary.TOOL_DEFS_FALLBACK_CHARS || 0),
          detailKey: 'TOOL_DEFS_FALLBACK_CHARS',
        },
        userMsgs: {
          chars: Number(result.summary.SYSTEM_REMINDER_CHROME_CHARS || 0),
          detailKey: 'SYSTEM_REMINDER_CHROME_CHARS',
        },
      },
    };
  }
  return { categories: {} };
}

export function buildCalibrationCategoryRows(
  categories: CalibrationCategoryMap | null | undefined,
  details?: Partial<CalibrationDetails>,
): CalibrationCategoryRow[] {
  return Object.entries(categories ?? {})
    .filter(([, value]) => Boolean(value) && isPositiveFiniteNumber(value!.chars))
    .map(([key, value]) => {
      const detailKey = value!.detailKey ?? key;
      return {
        key,
        label: categoryLabel(key),
        chars: value!.chars,
        tokens: value!.tokens,
        detailKey,
        detail: details?.[detailKey],
        origin: value!.origin,
      };
    })
    .sort((a, b) => categoryRank(a.key) - categoryRank(b.key) || a.key.localeCompare(b.key));
}

export function sumCalibrationCategoryChars(rows: Array<Pick<CalibrationCategoryRow, 'chars'>>): number {
  return rows.reduce((total, row) => total + row.chars, 0);
}

function categoryLabel(key: string): string {
  return CATEGORY_LABELS[key] ?? key;
}

function categoryRank(key: string): number {
  const index = CATEGORY_ORDER.indexOf(key);
  return index === -1 ? CATEGORY_ORDER.length : index;
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function hasNormalizedCategories(value: unknown): value is NormalizedCalibrationSummaryLike {
  return Boolean(value && typeof value === 'object' && 'categories' in value);
}

function hasTopLevelCategories(value: CalibrationResultLike): value is CalibrationResultLike & NormalizedCalibrationSummaryLike {
  return Boolean(value.categories);
}

function isLegacyClaudeSummary(value: unknown): value is LegacyClaudeSummaryLike {
  return Boolean(
    value &&
    typeof value === 'object' &&
    (
      'SYS_PROMPT_FALLBACK_CHARS' in value ||
      'TOOL_DEFS_FALLBACK_CHARS' in value ||
      'SYSTEM_REMINDER_CHROME_CHARS' in value
    ),
  );
}
