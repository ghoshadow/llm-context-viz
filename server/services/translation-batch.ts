import { callTranslationLLM } from '../llm/translation-client';
import { buildTranslationPrompt } from './translation-prompt';
import { parseNumberedTranslationResponse } from './translation-response';

export interface TranslateWorkloadOptions {
  batchSize?: number;
  callLLM?: (prompt: string) => Promise<string>;
}

export async function translateWorkloadInBatches(
  items: string[],
  options: TranslateWorkloadOptions = {},
): Promise<Map<number, string>> {
  const batchSize = options.batchSize ?? 2;
  const callLLM = options.callLLM ?? callTranslationLLM;
  const translated = new Map<number, string>();

  for (let start = 0; start < items.length; start += batchSize) {
    const batch = items.slice(start, start + batchSize);
    const response = await callLLM(buildTranslationPrompt(batch));
    const batchMap = parseNumberedTranslationResponse(response, batch.length);
    for (let i = 0; i < batch.length; i++) {
      translated.set(start + i, batchMap.get(i)!);
    }
  }

  return translated;
}
