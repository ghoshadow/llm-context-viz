export function parseNumberedTranslationResponse(response: string, expectedCount: number): Map<number, string> {
  const translatedMap = new Map<number, string>();
  const lines = response.split('\n');
  let currentIdx: number | null = null;
  let currentLines: string[] = [];

  function flushCurrent(): void {
    if (currentIdx !== null && currentLines.length > 0) {
      translatedMap.set(currentIdx, currentLines.join('\n').trim());
    }
    currentIdx = null;
    currentLines = [];
  }

  for (const line of lines) {
    const marker = currentIdx === null ? /^\[(\d+)\]\s*/.exec(line) : null;
    if (marker) {
      flushCurrent();
      currentIdx = parseInt(marker[1]!, 10);
      currentLines = [line.slice(marker[0].length)];
    } else if (line.trim() === '%%%') {
      flushCurrent();
    } else if (currentIdx !== null) {
      currentLines.push(line);
    }
  }
  flushCurrent();

  if (translatedMap.size === 0 && expectedCount === 1) {
    translatedMap.set(0, response.trim());
  }

  const missing: number[] = [];
  for (let i = 0; i < expectedCount; i++) {
    const value = translatedMap.get(i);
    if (!value?.trim()) missing.push(i);
  }
  if (missing.length > 0) {
    const suffix = missing.length > 12 ? '...' : '';
    throw new Error(`翻译结果不完整，缺少段落: ${missing.slice(0, 12).join(', ')}${suffix}`);
  }

  return translatedMap;
}
