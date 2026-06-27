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

  for (const seg of segments) {
    const part = seg.zh ? seg.text : translatedSegments[ti++] ?? seg.text;
    if (needsLeadingNewline(seg.text, part, lastEndsWithNewline)) {
      resultParts.push('\n');
      lastEndsWithNewline = true;
    }
    resultParts.push(part);
    lastEndsWithNewline = part.endsWith('\n');
  }

  return resultParts.join('').replace(/\n{3,}/g, '\n\n');
}

function needsLeadingNewline(sourceText: string, text: string, lastEndsWithNewline: boolean): boolean {
  if (lastEndsWithNewline) return false;
  const sourceStart = sourceText.trimStart();
  return text.startsWith('```') || text.startsWith('# ') || /^#{1,6}\s/.test(sourceStart);
}
