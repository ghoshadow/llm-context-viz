import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTurnListPagination } from './sessions';

test('defaults turn list pagination to the most recent 200 turns', () => {
  assert.deepEqual(parseTurnListPagination({}), {
    all: false,
    limit: 200,
    offset: 0,
  });
});

test('clamps invalid and excessive turn list pagination values', () => {
  assert.deepEqual(parseTurnListPagination({ limit: '9999', offset: '-4' }), {
    all: false,
    limit: 500,
    offset: 0,
  });
});

test('allows all turns only when all=1 is passed', () => {
  assert.deepEqual(parseTurnListPagination({ all: '1', limit: '20', offset: '5' }), {
    all: true,
    limit: null,
    offset: 0,
  });
});
