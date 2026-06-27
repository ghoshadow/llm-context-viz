import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNumberedTranslationResponse } from './translation-response';

test('parses numbered translation segments separated by delimiters', () => {
  const parsed = parseNumberedTranslationResponse('[0] 你好\n%%%\n[1] 世界', 2);

  assert.equal(parsed.get(0), '你好');
  assert.equal(parsed.get(1), '世界');
});

test('rejects incomplete numbered translation responses', () => {
  assert.throws(
    () => parseNumberedTranslationResponse('[0] 你好', 2),
    /翻译结果不完整，缺少段落: 1/,
  );
});

test('allows raw fallback only when one segment was requested', () => {
  const parsed = parseNumberedTranslationResponse('你好', 1);

  assert.equal(parsed.get(0), '你好');
});
