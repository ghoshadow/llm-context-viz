import assert from 'node:assert/strict';
import test from 'node:test';
import { translateRequestText } from './sessions';

test('translates the whole request text in one LLM call', async () => {
  const source = [
    'alpha',
    '中文不要被拆出来',
    '`literal_token`',
    'bravo',
  ].join('\n');
  const calls: string[] = [];

  const translated = await translateRequestText(source, async (prompt) => {
    calls.push(prompt);
    return '整段译文';
  });

  assert.equal(translated, '整段译文');
  assert.deepEqual(calls, [source]);
});
