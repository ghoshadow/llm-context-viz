export interface TranslationSegment {
  zh: boolean;
  text: string;
}

export function reassembleTranslatedSegments(
  segments: TranslationSegment[],
  translatedSegments: string[],
): string {
  let ti = 0;
  const resultParts: string[] = [];
  let lastEndsWithNewline = true;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const part = preserveTrailingStructuralNewlines(
      seg.zh ? seg.text : translatedSegments[ti++] ?? seg.text,
      seg.text,
      segments[i + 1]?.text,
    );
    if (needsLeadingNewline(seg.text, part, lastEndsWithNewline)) {
      resultParts.push('\n');
      lastEndsWithNewline = true;
    }
    resultParts.push(part);
    lastEndsWithNewline = part.endsWith('\n');
  }

  return resultParts.join('').replace(/\n{3,}/g, '\n\n');
}

function preserveTrailingStructuralNewlines(
  text: string,
  sourceText: string,
  nextSourceText?: string,
): string {
  if (text.endsWith('\n')) return text;
  if (sourceText.endsWith('\n\n') && startsWithMarkdownList(nextSourceText)) return text.trimEnd() + '\n\n';
  if (sourceText.endsWith('\n')) return text.trimEnd() + '\n';
  return text;
}

function startsWithMarkdownList(text?: string): boolean {
  return /^(\s*)([-*+]|\d+[.)])\s+/.test(text ?? '');
}

function needsLeadingNewline(sourceText: string, text: string, lastEndsWithNewline: boolean): boolean {
  if (lastEndsWithNewline) return false;
  const sourceStart = sourceText.trimStart();
  return text.startsWith('```') || text.startsWith('# ') || /^#{1,6}\s/.test(sourceStart);
}
