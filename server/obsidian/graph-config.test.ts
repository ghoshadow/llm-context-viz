import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ensureOntologyGraphColorGroups } from './graph-config';

test('removes ontology-specific graph color groups and preserves shared vault groups', () => {
  const vaultRoot = mkdtempSync(path.join(tmpdir(), 'llm-context-viz-obsidian-'));
  const obsidianDir = path.join(vaultRoot, '.obsidian');
  mkdirSync(obsidianDir);
  const graphPath = path.join(obsidianDir, 'graph.json');

  writeFileSync(graphPath, JSON.stringify({
    showTags: true,
    'collapse-color-groups': true,
    colorGroups: [
      { query: 'tag:#领域/数字分身', color: { a: 1, rgb: 16347926 } },
      { query: 'tag:#类型/周报', color: { a: 1, rgb: 8161945 } },
      { query: 'tag:#来源/大模型上下文', color: { a: 1, rgb: 14701138 } },
      { query: 'tag:#本体颜色/主题', color: { a: 1, rgb: 16620730 } },
      { query: 'tag:#ontology-color/topic', color: { a: 1, rgb: 1 } },
      { query: 'tag:#ontology-color/how_to', color: { a: 1, rgb: 2 } },
    ],
  }, null, 2), 'utf-8');

  ensureOntologyGraphColorGroups(vaultRoot);

  const config = JSON.parse(readFileSync(graphPath, 'utf-8')) as {
    'collapse-color-groups': boolean;
    colorGroups: Array<{ query: string; color: { a: number; rgb: number } }>;
  };
  const queries = config.colorGroups.map((group) => group.query);

  assert.equal(config['collapse-color-groups'], true);
  assert.ok(queries.includes('tag:#领域/数字分身'));
  assert.ok(queries.includes('tag:#类型/周报'));
  assert.ok(!queries.includes('tag:#来源/大模型上下文'));
  assert.ok(!queries.includes('tag:#本体颜色/主题'));
  assert.ok(!queries.includes('tag:#ontology-color/topic'));
  assert.ok(!queries.includes('tag:#ontology-color/how_to'));
});
