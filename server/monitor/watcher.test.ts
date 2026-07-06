import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { mock } from 'node:test';

const homeDir = await mkdtemp(join(tmpdir(), 'monitor-home-'));

mock.module('os', {
  namedExports: {
    homedir: () => homeDir,
  },
});

mock.module('../../shared/pipeline/index', {
  namedExports: {
    runPipeline: (raw: string) => {
      const count = Number(raw.trim());
      return {
        errors: [],
        summary: { session: { contextLimit: 1000 } },
        turns: Array.from({ length: count }, (_, i) => ({
          cumTotal: (i + 1) * 10,
          tools: {},
          compressionReset: false,
          cumCacheHit: 0,
        })),
      };
    },
  },
});

const { getSnapshot } = await import('./watcher');

test('monitor snapshot cache invalidates when active file mtime changes', async () => {
  const sessionDir = join(homeDir, '.claude', 'projects', 'project');
  const sessionPath = join(sessionDir, 'session.jsonl');
  await mkdir(sessionDir, { recursive: true });

  try {
    const firstMtime = new Date(Date.now() - 2000);
    await writeFile(sessionPath, '1\n');
    await utimes(sessionPath, firstMtime, firstMtime);

    const first = await getSnapshot();
    assert.equal(first.sessionPath, sessionPath);
    assert.equal(first.turnCount, 1);

    const secondMtime = new Date(Date.now() - 1000);
    await writeFile(sessionPath, '2\n');
    await utimes(sessionPath, secondMtime, secondMtime);

    const second = await getSnapshot();
    assert.equal(second.sessionPath, sessionPath);
    assert.equal(second.turnCount, 2);
    assert.notEqual(second.lastModified, first.lastModified);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});
