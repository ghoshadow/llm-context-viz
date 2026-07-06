import assert from 'node:assert/strict';
import test from 'node:test';
import { SCANNER_SOURCE_LABELS, filterScannerFiles } from './scannerFileFilters';

const files = [
  { path: 'claude-4.jsonl', source: 'claude' as const, turnCount: 4 },
  { path: 'claude-5.jsonl', source: 'claude' as const, turnCount: 5 },
  { path: 'claude-unknown.jsonl', source: 'claude' as const },
  { path: 'codex-3.jsonl', source: 'codex' as const, turnCount: 3 },
  { path: 'codex-7.jsonl', source: 'codex' as const, turnCount: 7 },
  { path: 'opencode-2.jsonl', source: 'opencode' as const, turnCount: 2 },
  { path: 'pi-6.jsonl', source: 'pi' as const, turnCount: 6 },
];

test('filters scanner files by active source without hiding short sessions', () => {
  assert.deepEqual(
    filterScannerFiles(files, { source: 'claude', hideShortSessions: false }).map((file) => file.path),
    ['claude-4.jsonl', 'claude-5.jsonl', 'claude-unknown.jsonl'],
  );

  assert.deepEqual(
    filterScannerFiles(files, { source: 'codex', hideShortSessions: false }).map((file) => file.path),
    ['codex-3.jsonl', 'codex-7.jsonl'],
  );

  assert.deepEqual(
    filterScannerFiles(files, { source: 'opencode', hideShortSessions: false }).map((file) => file.path),
    ['opencode-2.jsonl'],
  );

  assert.deepEqual(
    filterScannerFiles(files, { source: 'pi', hideShortSessions: false }).map((file) => file.path),
    ['pi-6.jsonl'],
  );
});

test('hides scanner files with fewer than five turns when enabled', () => {
  assert.deepEqual(
    filterScannerFiles(files, { source: 'claude', hideShortSessions: true }).map((file) => file.path),
    ['claude-5.jsonl', 'claude-unknown.jsonl'],
  );

  assert.deepEqual(
    filterScannerFiles(files, { source: 'codex', hideShortSessions: true }).map((file) => file.path),
    ['codex-7.jsonl'],
  );

  assert.deepEqual(
    filterScannerFiles(files, { source: 'opencode', hideShortSessions: true }).map((file) => file.path),
    [],
  );

  assert.deepEqual(
    filterScannerFiles(files, { source: 'pi', hideShortSessions: true }).map((file) => file.path),
    ['pi-6.jsonl'],
  );
});

test('provides scanner labels for all supported import sources', () => {
  assert.equal(SCANNER_SOURCE_LABELS.claude, 'Claude Code');
  assert.equal(SCANNER_SOURCE_LABELS.codex, 'Codex');
  assert.equal(SCANNER_SOURCE_LABELS.opencode, 'OpenCode');
  assert.equal(SCANNER_SOURCE_LABELS.pi, 'Pi');
});
