import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTranslationWorkload,
  mergeTranslatedWorkload,
  splitTranslationText,
} from './translation-workload';

test('splits long translation text on line boundaries', () => {
  const chunks = splitTranslationText('alpha\n\nbravo\n\ncharlie', 12);

  assert.deepEqual(chunks, ['alpha\n\n', 'bravo\n\n', 'charlie']);
});

test('splits very long lines when no boundary exists', () => {
  const chunks = splitTranslationText('abcdefghij', 4);

  assert.deepEqual(chunks, ['abcd', 'efgh', 'ij']);
});

test('builds request items and merges them back per original non-Chinese segment', () => {
  const workload = buildTranslationWorkload([
    { zh: false, text: 'alpha\n\nbravo' },
    { zh: true, text: '中文' },
    { zh: false, text: 'charlie' },
  ], 8);

  assert.deepEqual(workload.requestItems, ['alpha\n\n', 'bravo', 'charlie']);
  assert.deepEqual(workload.segmentItemIndexes, [[0, 1], [2]]);

  const translated = mergeTranslatedWorkload(workload, new Map([
    [0, '甲\n\n'],
    [1, '乙'],
    [2, '丙'],
  ]));

  assert.deepEqual(translated, ['甲\n\n乙', '丙']);
});
