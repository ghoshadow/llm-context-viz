import assert from 'node:assert/strict';
import test from 'node:test';
import { collectParsedItems, parseJsonFromText } from './ontology-response-parser.js';

const extraction = {
  shardIndex: 0,
  phaseTheme: '结果收集修复',
  candidates: [],
  relations: [],
};

test('collectParsedItems unwraps text blocks containing fenced shard JSON', () => {
  const wrapped = [
    {
      type: 'text',
      text: '```json\n' + JSON.stringify(extraction) + '\n```',
    },
    {
      type: 'text',
      text: 'agentId: abc123',
    },
  ];

  const parsed = parseJsonFromText(JSON.stringify(wrapped));
  assert.deepEqual(collectParsedItems(parsed), [extraction]);
});

test('collectParsedItems preserves direct inline JSON items for schema validation', () => {
  const invalidExtraction = {
    shardIndex: 1,
    phaseTheme: '缺少 relations',
    candidates: [],
  };

  assert.deepEqual(collectParsedItems(invalidExtraction), [invalidExtraction]);
  assert.deepEqual(collectParsedItems({ results: [invalidExtraction] }), [invalidExtraction]);
});
