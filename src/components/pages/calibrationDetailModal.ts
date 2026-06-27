export type CalibrationDetailLayout = 'single' | 'side-by-side';
export type CalibrationDetailDisplay = { text: string; markdown: boolean };
export type CalibrationDetailTranslationSlot = { stepIndex: number; sectionIndex: number };

export type CalibrationDetailKey = string;
export const PURE_CODE_TRANSLATION_MESSAGE = '纯代码内容不支持翻译';

export function getCalibrationDetailLayout(translatedText?: string): CalibrationDetailLayout {
  return translatedText?.trim() ? 'side-by-side' : 'single';
}

export function getCalibrationDetailDisplay(key: CalibrationDetailKey, detail: string): CalibrationDetailDisplay {
  if (key.includes('tool_defs') || key.includes('tools') || key === 'TOOL_DEFS_FALLBACK_CHARS') {
    return { text: detail, markdown: true };
  }

  return {
    text: normalizePlainTextHeadings(unwrapPlainTextDetail(key, detail)),
    markdown: false,
  };
}

export function getCalibrationDetailSectionIndex(key: CalibrationDetailKey, text: string): number {
  return 930000000 + hashText(`${key}\n${text}`);
}

export function getCalibrationDetailTranslationSlot(
  key: CalibrationDetailKey,
  text: string,
): CalibrationDetailTranslationSlot {
  return {
    stepIndex: -100,
    sectionIndex: getCalibrationDetailSectionIndex(key, text),
  };
}

export function getCalibrationDetailTranslationBlockReason(
  _key: CalibrationDetailKey,
  display: CalibrationDetailDisplay,
): string | null {
  return isPureCodeContent(display.text, display.markdown) ? PURE_CODE_TRANSLATION_MESSAGE : null;
}

function hashText(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 100000;
}

function unwrapPlainTextDetail(_key: CalibrationDetailKey, detail: string): string {
  const legacy = /^# [^\n]+\n\n字符数: \d+\n\n```text\n([\s\S]*)\n```$/.exec(detail);
  if (legacy) return legacy[1]!;

  const current = /^# [^\n]+\n\n字符数: \d+\n\n([\s\S]*)$/.exec(detail);
  return current?.[1] ?? detail;
}

function normalizePlainTextHeadings(text: string): string {
  return text.replace(/([^\n])(#\s+[A-Za-z][^\n]*)/g, '$1\n$2');
}

function isPureCodeContent(text: string, markdown: boolean): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (isJsonLike(trimmed)) return true;

  if (!markdown) return false;

  const withoutCode = trimmed
    .replace(/^# [^\n]+\n*/gm, '')
    .replace(/^字符数:\s*\d+\s*$/gm, '')
    .replace(/^```[^\n]*\n[\s\S]*?\n```$/gm, '')
    .replace(/`[^`\n]+`/g, '')
    .trim();

  return withoutCode.length === 0;
}

function isJsonLike(text: string): boolean {
  if (!/^[\[{]/.test(text)) return false;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}
