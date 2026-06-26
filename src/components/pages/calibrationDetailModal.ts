export type CalibrationDetailLayout = 'single' | 'side-by-side';
export type CalibrationDetailDisplay = { text: string; markdown: boolean };

export type CalibrationDetailKey =
  | 'SYS_PROMPT_FALLBACK_CHARS'
  | 'TOOL_DEFS_FALLBACK_CHARS'
  | 'SYSTEM_REMINDER_CHROME_CHARS';

export function getCalibrationDetailLayout(translatedText?: string): CalibrationDetailLayout {
  return translatedText?.trim() ? 'side-by-side' : 'single';
}

export function getCalibrationDetailDisplay(key: CalibrationDetailKey, detail: string): CalibrationDetailDisplay {
  if (key === 'TOOL_DEFS_FALLBACK_CHARS') {
    return { text: detail, markdown: true };
  }

  return {
    text: unwrapPlainTextDetail(key, detail),
    markdown: false,
  };
}

export function getCalibrationDetailSectionIndex(key: CalibrationDetailKey, text: string): number {
  const base: Record<CalibrationDetailKey, number> = {
    SYS_PROMPT_FALLBACK_CHARS: 920100000,
    TOOL_DEFS_FALLBACK_CHARS: 920200000,
    SYSTEM_REMINDER_CHROME_CHARS: 920300000,
  };
  return base[key] + hashText(text);
}

function hashText(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 100000;
}

function unwrapPlainTextDetail(key: CalibrationDetailKey, detail: string): string {
  const title = escapeRegExp(key);
  const legacy = new RegExp(`^# ${title}\\n\\n字符数: \\d+\\n\\n\`\`\`text\\n([\\s\\S]*)\\n\`\`\`$`).exec(detail);
  if (legacy) return legacy[1]!;

  const current = new RegExp(`^# ${title}\\n\\n字符数: \\d+\\n\\n([\\s\\S]*)$`).exec(detail);
  return current?.[1] ?? detail;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
