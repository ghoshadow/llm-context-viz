import assert from 'node:assert/strict';
import test from 'node:test';
import { getScannerFileTitleDisplay } from './scannerFileTitle';

test('renders Codex plugin reference scan titles as structured previews', () => {
  assert.deepEqual(
    getScannerFileTitleDisplay(
      '[@superpowers](plugin://superpowers@openai-api-curated',
      'rollout-2026-06-29.jsonl',
    ),
    {
      kind: 'structured',
      label: '@superpowers',
      detail: 'openai-api-curated',
      icon: '@',
      tone: 'plugin',
      tooltip: '@superpowers · openai-api-curated',
    },
  );
});

test('falls back to filename for ordinary scan titles', () => {
  assert.deepEqual(getScannerFileTitleDisplay('', 'session.jsonl'), {
    kind: 'text',
    text: 'session.jsonl',
  });
});
