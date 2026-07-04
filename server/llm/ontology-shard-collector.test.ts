import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { mock } from 'node:test';
import type { ExtractionManifest, ShardFile } from '../content/extract-to-files.js';

const extraction = {
  shardIndex: 2,
  phaseTheme: '大结果文件恢复',
  candidates: [],
  relations: [],
};

let sdkMessages: unknown[] = [];
mock.module('@anthropic-ai/claude-agent-sdk', {
  namedExports: {
    query: () => (async function* () {
      for (const msg of sdkMessages) yield msg;
    })(),
  },
});

const {
  collectShardTextResults,
  isAgentToolResultPath,
  readShardItemsFromAgentToolResultPath,
} = await import('./ontology-shard-collector.js');

test('isAgentToolResultPath only accepts Agent SDK tool result JSON files', () => {
  assert.equal(isAgentToolResultPath('/tmp/session/tool-results/call_00_abc.json'), true);
  assert.equal(isAgentToolResultPath('/tmp/session/tool-results/not_call.json'), false);
  assert.equal(isAgentToolResultPath('/tmp/session/other/call_00_abc.json'), false);
  assert.equal(isAgentToolResultPath('/tmp/session/tool-results/call_00_abc.txt'), false);
});

test('readShardItemsFromAgentToolResultPath extracts text-wrapped shard JSON', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ontology-tool-result-'));
  try {
    const dir = join(root, 'tool-results');
    await mkdir(dir);
    const file = join(dir, 'call_00_abc.json');
    await writeFile(file, JSON.stringify([
      { type: 'text', text: '```json\n' + JSON.stringify(extraction) + '\n```' },
      { type: 'text', text: 'agentId: abc' },
    ]), 'utf8');

    assert.deepEqual(await readShardItemsFromAgentToolResultPath(file), [extraction]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('readShardItemsFromAgentToolResultPath skips matching symlinks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ontology-tool-result-'));
  try {
    const dir = join(root, 'tool-results');
    await mkdir(dir);
    const target = join(root, 'target.json');
    const link = join(dir, 'call_00_link.json');
    await writeFile(target, JSON.stringify(extraction), 'utf8');
    await symlink(target, link);

    assert.deepEqual(await readShardItemsFromAgentToolResultPath(link), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('collectShardTextResults recovers Read tool-result file and emits shard-done', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ontology-tool-result-'));
  try {
    const dir = join(root, 'tool-results');
    await mkdir(dir);
    const file = join(dir, 'call_00_abc.json');
    await writeFile(file, JSON.stringify([
      { type: 'text', text: '```json\n' + JSON.stringify(extraction) + '\n```' },
    ]), 'utf8');

    sdkMessages = [
      { type: 'system', subtype: 'init', session_id: 'sdk-session' },
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'toolu_read_1', name: 'Read', input: { file_path: file } },
          ],
        },
      },
      {
        type: 'user',
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_read_1', content: 'file too large to render inline' },
          ],
        },
      },
    ];

    const shard: ShardFile = {
      index: extraction.shardIndex,
      path: join(root, 'shard.md'),
      filename: 'shard.md',
      turnRange: '1-30',
      turnCount: 30,
      startTurn: 1,
      endTurn: 30,
    };
    const manifest: ExtractionManifest = {
      sessionId: 's1',
      extractedAt: new Date(0).toISOString(),
      totalTurns: 30,
      shardCount: 1,
      shards: [shard],
      rootDir: join(root, 'data', 'extractions', 's1'),
    };
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];

    const result = await collectShardTextResults({
      manifest,
      shards: [shard],
      model: 'test-model',
      apiKey: 'test-key',
      baseUrl: 'http://127.0.0.1',
      depth: 'deep',
      attempt: 1,
      onEvent: (event, data) => events.push({ event, data }),
    });

    assert.equal(result.results.size, 1);
    assert.equal(JSON.parse(result.results.get(extraction.shardIndex)!).phaseTheme, extraction.phaseTheme);
    assert.deepEqual(
      events.filter((e) => e.event === 'shard-done').map((e) => e.data.shardIndex),
      [extraction.shardIndex],
    );
  } finally {
    sdkMessages = [];
    await rm(root, { recursive: true, force: true });
  }
});
