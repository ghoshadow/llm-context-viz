import type { TranslationSegment } from './translation-reassembly';

export interface TranslationWorkload {
  requestItems: string[];
  segmentItemIndexes: number[][];
}

export function buildTranslationWorkload(
  segments: TranslationSegment[],
  maxChunkChars = 20_000,
): TranslationWorkload {
  const requestItems: string[] = [];
  const segmentItemIndexes: number[][] = [];

  for (const seg of segments) {
    if (seg.zh) continue;
    const indexes: number[] = [];
    for (const chunk of splitTranslationText(seg.text, maxChunkChars)) {
      indexes.push(requestItems.length);
      requestItems.push(chunk);
    }
    segmentItemIndexes.push(indexes);
  }

  return { requestItems, segmentItemIndexes };
}

export function mergeTranslatedWorkload(
  workload: TranslationWorkload,
  translatedMap: Map<number, string>,
): string[] {
  return workload.segmentItemIndexes.map((indexes) => indexes.map((index) => translatedMap.get(index) ?? '').join(''));
}

export function splitTranslationText(text: string, maxChunkChars: number): string[] {
  if (text.length <= maxChunkChars) return [text];

  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const remaining = text.length - cursor;
    if (remaining <= maxChunkChars) {
      chunks.push(text.slice(cursor));
      break;
    }

    const limit = cursor + maxChunkChars;
    let end = text.lastIndexOf('\n\n', limit - 1);
    if (end < cursor + Math.floor(maxChunkChars * 0.45)) {
      end = text.lastIndexOf('\n', limit - 1);
    }
    if (end < cursor + Math.floor(maxChunkChars * 0.45)) {
      end = limit;
      chunks.push(text.slice(cursor, end));
      cursor = end;
      continue;
    }

    end += text.startsWith('\n\n', end) ? 2 : 1;
    chunks.push(text.slice(cursor, end));
    cursor = end;
  }

  return chunks.filter((chunk) => chunk.length > 0);
}
