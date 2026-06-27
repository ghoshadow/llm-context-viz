import assert from 'node:assert/strict';
import test from 'node:test';
import { translateWorkloadInBatches } from './translation-batch';

test('translates workload in separate batches and merges indexed responses', async () => {
  const prompts: string[] = [];
  const translated = await translateWorkloadInBatches(['alpha', 'bravo', 'charlie'], {
    batchSize: 2,
    callLLM: async (prompt) => {
      prompts.push(prompt);
      if (prompts.length === 1) return '[0] 甲\n%%%\n[1] 乙';
      return '[0] 丙';
    },
  });

  assert.equal(prompts.length, 2);
  assert.equal(translated.get(0), '甲');
  assert.equal(translated.get(1), '乙');
  assert.equal(translated.get(2), '丙');
});
