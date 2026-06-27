import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseConstantTranslationSections,
  isConstantTranslationSlot,
  normalizeTranslationProjectKey,
  translateRequestText,
} from './sessions';

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

test('detects calibration constant translation slots', () => {
  assert.equal(isConstantTranslationSlot(-100), true);
  assert.equal(isConstantTranslationSlot(0), false);
});

test('normalizes project translation cache keys by cwd and source', () => {
  assert.deepEqual(normalizeTranslationProjectKey('/tmp/project/', 'claude'), {
    project_cwd: '/tmp/project',
    source: 'claude',
  });
});

test('parses requested constant translation sections from query input', () => {
  assert.deepEqual(parseConstantTranslationSections('1, 2, nope, 2'), [1, 2]);
  assert.deepEqual(parseConstantTranslationSections(['3', '4,5']), [3, 4, 5]);
  assert.deepEqual(parseConstantTranslationSections(undefined), []);
});
