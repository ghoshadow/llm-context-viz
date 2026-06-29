/**
 * extraction-job.test.ts — 提取任务状态机测试
 *
 * 覆盖：
 * - updateExtractJob 各 event 分支
 * - isExtractActive 状态判断
 * - upsertOntologyShard 数据库操作
 * - loadOntologyShardCache 缓存加载
 *
 * 注意：需要使用 --experimental-test-module-mocks 标志运行此测试
 *   node --import tsx --experimental-test-module-mocks --test <this-file>
 */
import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import Database from 'better-sqlite3';

// ── 创建内存数据库并设置 schema ─────────────────────────────────────────

function setUpMemoryDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY
    );
    CREATE TABLE IF NOT EXISTS ontology_shards (
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      shard_index INTEGER NOT NULL,
      turn_range TEXT NOT NULL,
      start_turn INTEGER,
      end_turn INTEGER,
      status TEXT NOT NULL,
      phase_theme TEXT,
      candidates_json TEXT,
      relations_json TEXT,
      config_json TEXT,
      error TEXT,
      extraction_depth TEXT DEFAULT 'refined',
      shard_size INTEGER,
      max_shard_chars INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (session_id, shard_index, extraction_depth)
    );
  `);
  return db;
}

const memDb = setUpMemoryDb();

// mock getDb 返回内存数据库
const dbMock = mock.module('../db', {
  namedExports: {
    getDb: () => memDb,
    initDb: () => {},
  },
});

const extractionJob = await import('../services/extraction-job');

const {
  updateExtractJob,
  isExtractActive,
  upsertOntologyShard,
  loadOntologyShardCache,
} = extractionJob;

// ── updateExtractJob 测试 ────────────────────────────────────────────────

test('updateExtractJob extracted event 初始化 job', () => {
  const job = updateExtractJob('s1', 'extracted', {
    shards: [{ index: 0 }, { index: 1 }, { index: 2 }],
    rootDir: '/test',
    totalTurns: 100,
    activeShards: 3,
  });
  assert.equal(job.sessionId, 's1');
  assert.equal(job.phase, 'extracting');
  assert.equal(job.rootDir, '/test');
  assert.equal(job.totalTurns, 100);
  assert.equal(job.shardCount, 3);
  assert.equal(job.shardDetails.length, 3);
  assert.equal(job.shardDetails[0]!.status, 'pending');
  assert.equal(job.shardsCompleted, 0);
  assert.equal(job.error, null);
});

test('updateExtractJob extracted event 使用 data.shardCount 回退', () => {
  const job = updateExtractJob('s2', 'extracted', {
    shards: [{ index: 0 }],
    shardCount: 5,
  });
  assert.equal(job.shardCount, 5);
});

test('updateExtractJob start event 设置阶段状态', () => {
  updateExtractJob('s3', 'extracted', { shards: [{ index: 0 }], shardCount: 3 });

  const job = updateExtractJob('s3', 'start', {
    shards: 3,
    totalTurns: 50,
    extractionDepth: 'deep',
  });
  assert.equal(job.phase, 'extracting');
  assert.equal(job.shardCount, 3);
  assert.equal(job.totalTurns, 50);
  assert.equal(job.extractionDepth, 'deep');
  assert.equal(job.shardDetails.length, 3);
  assert.equal(job.shardsCompleted, 0);
});

test('updateExtractJob start event shardCount 变化时重建 shardDetails', () => {
  updateExtractJob('s3b', 'extracted', { shards: [{ index: 0 }], shardCount: 2 });

  const job = updateExtractJob('s3b', 'start', { shards: 5 });
  assert.equal(job.shardCount, 5);
  assert.equal(job.shardDetails.length, 5);
});

test('updateExtractJob shard-start event 标记分片为 running', () => {
  updateExtractJob('s4', 'extracted', { shards: [{ index: 0 }, { index: 1 }], shardCount: 2 });

  const job = updateExtractJob('s4', 'shard-start', { shardIndex: 1 });
  assert.equal(job.shardDetails[0]!.status, 'pending');
  assert.equal(job.shardDetails[1]!.status, 'running');
});

test('updateExtractJob shard-done event 标记分片完成', () => {
  updateExtractJob('s5', 'extracted', { shards: [{ index: 0 }, { index: 1 }], shardCount: 2 });

  const job = updateExtractJob('s5', 'shard-done', {
    shardIndex: 0,
    candidates: [{}, {}],
    relations: [{}],
  });
  assert.equal(job.shardDetails[0]!.status, 'done');
  assert.equal(job.shardDetails[0]!.candidates, 2);
  assert.equal(job.shardDetails[0]!.relations, 1);
  assert.equal(job.shardsCompleted, 1);
});

test('updateExtractJob shard-error event 标记分片错误', () => {
  updateExtractJob('s6', 'extracted', { shards: [{ index: 0 }], shardCount: 1 });

  const job = updateExtractJob('s6', 'shard-error', {
    shardIndex: 0,
    error: 'LLM 调用超时',
  });
  assert.equal(job.shardDetails[0]!.status, 'error');
  assert.equal(job.shardDetails[0]!.error, 'LLM 调用超时');
});

test('updateExtractJob shard-error event 无 error 消息时使用默认值', () => {
  updateExtractJob('s6b', 'extracted', { shards: [{ index: 0 }], shardCount: 1 });

  const job = updateExtractJob('s6b', 'shard-error', { shardIndex: 0 });
  assert.equal(job.shardDetails[0]!.error, '失败');
});

test('updateExtractJob shard-retry event 标记重试', () => {
  updateExtractJob('s7', 'extracted', { shards: [{ index: 0 }], shardCount: 1 });

  const job = updateExtractJob('s7', 'shard-retry', { shardIndex: 0, attempt: 3 });
  assert.equal(job.shardDetails[0]!.status, 'running');
  assert.ok(job.shardDetails[0]!.error?.includes('3'));
});

test('updateExtractJob merge event 切换到 merging 阶段', () => {
  updateExtractJob('s8', 'extracted', { shards: [{ index: 0 }], shardCount: 1 });

  const job = updateExtractJob('s8', 'merge', {});
  assert.equal(job.phase, 'merging');
});

test('updateExtractJob build event 切换到 building 阶段', () => {
  updateExtractJob('s9', 'extracted', { shards: [{ index: 0 }], shardCount: 1 });

  const job = updateExtractJob('s9', 'build', {});
  assert.equal(job.phase, 'building');
});

test('updateExtractJob complete event 全部成功切换到 complete', () => {
  updateExtractJob('s10', 'extracted', { shards: [{ index: 0 }], shardCount: 1 });
  updateExtractJob('s10', 'shard-done', { shardIndex: 0 });

  const job = updateExtractJob('s10', 'complete', {});
  assert.equal(job.phase, 'complete');
  assert.equal(job.error, null);
});

test('updateExtractJob complete event 有失败分片切换到 error', () => {
  updateExtractJob('s11', 'extracted', { shards: [{ index: 0 }, { index: 1 }], shardCount: 2 });
  updateExtractJob('s11', 'shard-done', { shardIndex: 0 });
  updateExtractJob('s11', 'shard-error', { shardIndex: 1 });

  const job = updateExtractJob('s11', 'complete', {});
  assert.equal(job.phase, 'error');
  assert.ok(job.error?.includes('1 个分片未完成'));
});

test('updateExtractJob error event 切换到 error 阶段', () => {
  updateExtractJob('s12', 'extracted', { shards: [{ index: 0 }], shardCount: 1 });

  const job = updateExtractJob('s12', 'error', { message: '严重错误' });
  assert.equal(job.phase, 'error');
  assert.equal(job.error, '严重错误');
});

test('updateExtractJob extracted event 设置 extractionDepth 为 deep', () => {
  const job = updateExtractJob('s13', 'extracted', {
    shards: [{ index: 0 }],
    extractionDepth: 'deep',
  });
  assert.equal(job.extractionDepth, 'deep');
});

test('updateExtractJob 无 job 时自动创建', () => {
  const job = updateExtractJob('s14', 'start', { shards: 2, totalTurns: 100 });
  assert.equal(job.sessionId, 's14');
  assert.equal(job.phase, 'extracting');
  assert.equal(job.shardCount, 2);
  assert.equal(job.shardDetails.length, 2);
});

test('updateExtractJob 无效 shards 数据时容错', () => {
  const job = updateExtractJob('s15', 'extracted', {
    shards: 'not_an_array',
  });
  assert.equal(job.sessionId, 's15');
  assert.equal(job.shardsCompleted, 0);
});

test('updateExtractJob extracted event 不提供 shardCount 时使用 activeShards', () => {
  const job = updateExtractJob('s16', 'extracted', {
    shards: [{ index: 0 }, { index: 1 }],
    activeShards: 5,
  });
  assert.equal(job.shardCount, 5);
});

// ── isExtractActive 测试 ────────────────────────────────────────────────

function makeJob(phase: string) {
  return {
    sessionId: 's',
    phase: phase as any,
    rootDir: null,
    totalTurns: 0,
    shardCount: 0,
    shardsCompleted: 0,
    shardDetails: [],
    error: null,
    extractionDepth: 'refined' as const,
    shardSize: null,
    maxShardChars: null,
    startedAt: '',
    updatedAt: '',
  };
}

test('isExtractActive undefined 返回 false', () => {
  assert.equal(isExtractActive(undefined), false);
});

test('isExtractActive idle 返回 false', () => {
  assert.equal(isExtractActive(makeJob('idle')), false);
});

test('isExtractActive complete 返回 false', () => {
  assert.equal(isExtractActive(makeJob('complete')), false);
});

test('isExtractActive error 返回 false', () => {
  assert.equal(isExtractActive(makeJob('error')), false);
});

test('isExtractActive extracting 返回 true', () => {
  assert.equal(isExtractActive(makeJob('extracting')), true);
});

test('isExtractActive merging 返回 true', () => {
  assert.equal(isExtractActive(makeJob('merging')), true);
});

test('isExtractActive building 返回 true', () => {
  assert.equal(isExtractActive(makeJob('building')), true);
});

// ── upsertOntologyShard 测试 ────────────────────────────────────────────

test('upsertOntologyShard 插入新分片记录', () => {
  memDb.prepare('INSERT OR IGNORE INTO sessions (id) VALUES (?)').run('upsert-s1');

  upsertOntologyShard('upsert-s1', {
    shardIndex: 0,
    turnRange: '0-50',
    phaseTheme: 'test theme',
    candidates: [{ name: 'c1' }],
    relations: [{ from: 'a', to: 'b' }],
    config: { model: 'deepseek' },
    extractionDepth: 'refined',
    shardSize: 1000,
    maxShardChars: 5000,
  }, 'done');

  const row = memDb.prepare(
    'SELECT * FROM ontology_shards WHERE session_id = ? AND shard_index = ?'
  ).get('upsert-s1', 0) as Record<string, unknown>;

  assert.ok(row, '应存在记录');
  assert.equal(row.status, 'done');
  assert.equal(row.phase_theme, 'test theme');
  assert.equal(row.extraction_depth, 'refined');
  assert.equal(row.shard_size, 1000);
  assert.equal(row.max_shard_chars, 5000);
  assert.equal(typeof row.candidates_json, 'string');
  assert.equal(typeof row.relations_json, 'string');
  assert.equal(typeof row.config_json, 'string');
});

test('upsertOntologyShard 不同 extractionDepth 共存', () => {
  memDb.prepare('INSERT OR IGNORE INTO sessions (id) VALUES (?)').run('upsert-s2');

  upsertOntologyShard('upsert-s2', {
    shardIndex: 0,
    turnRange: '0-30',
    phaseTheme: 'v1',
    extractionDepth: 'refined',
  }, 'done');

  upsertOntologyShard('upsert-s2', {
    shardIndex: 0,
    turnRange: '0-50',
    phaseTheme: 'v2',
    extractionDepth: 'deep',
  }, 'done');

  const rows = memDb.prepare(
    'SELECT * FROM ontology_shards WHERE session_id = ? AND shard_index = ?'
  ).all('upsert-s2', 0) as Array<Record<string, unknown>>;

  assert.equal(rows.length, 2);
});

test('upsertOntologyShard 无效 shardIndex 不执行操作', () => {
  upsertOntologyShard('upsert-s3', {
    turnRange: '0-10',
  }, 'done');

  const row = memDb.prepare(
    'SELECT COUNT(*) as cnt FROM ontology_shards WHERE session_id = ?'
  ).get('upsert-s3') as { cnt: number };

  assert.equal(row.cnt, 0);
});

test('upsertOntologyShard 负数 shardIndex 不执行操作', () => {
  upsertOntologyShard('upsert-s4', {
    shardIndex: -1,
    turnRange: '0-10',
  }, 'done');

  const row = memDb.prepare(
    'SELECT COUNT(*) as cnt FROM ontology_shards WHERE session_id = ?'
  ).get('upsert-s4') as { cnt: number };

  assert.equal(row.cnt, 0);
});

test('upsertOntologyShard 使用 fallback 的 shardIndex', () => {
  memDb.prepare('INSERT OR IGNORE INTO sessions (id) VALUES (?)').run('upsert-s5');

  upsertOntologyShard('upsert-s5', {}, 'done', { index: 3, turnRange: '100-150' });

  const row = memDb.prepare(
    'SELECT * FROM ontology_shards WHERE session_id = ? AND shard_index = ?'
  ).get('upsert-s5', 3) as Record<string, unknown>;

  assert.ok(row, '应使用 fallback 的 shardIndex');
  assert.equal(row.turn_range, '100-150');
});

test('upsertOntologyShard 错误状态记录 error 字段', () => {
  memDb.prepare('INSERT OR IGNORE INTO sessions (id) VALUES (?)').run('upsert-s6');

  upsertOntologyShard('upsert-s6', {
    shardIndex: 0,
    turnRange: '0-30',
    error: '分片处理超时',
  }, 'error');

  const row = memDb.prepare(
    'SELECT * FROM ontology_shards WHERE session_id = ? AND shard_index = ?'
  ).get('upsert-s6', 0) as Record<string, unknown>;

  assert.equal(row.status, 'error');
  assert.equal(row.error, '分片处理超时');
});

test('upsertOntologyShard 使用 fallback 的 startTurn 和 endTurn', () => {
  memDb.prepare('INSERT OR IGNORE INTO sessions (id) VALUES (?)').run('upsert-s7');

  upsertOntologyShard('upsert-s7', {
    shardIndex: 0,
  }, 'done', { index: 0, turnRange: '50-100', startTurn: 50, endTurn: 100 });

  const row = memDb.prepare(
    'SELECT * FROM ontology_shards WHERE session_id = ? AND shard_index = ?'
  ).get('upsert-s7', 0) as Record<string, unknown>;

  assert.equal(row.start_turn, 50);
  assert.equal(row.end_turn, 100);
});

// ── loadOntologyShardCache 测试 ─────────────────────────────────────────

test('loadOntologyShardCache 加载已完成分片', () => {
  memDb.prepare('INSERT OR IGNORE INTO sessions (id) VALUES (?)').run('cache-s1');

  memDb.prepare(`
    INSERT INTO ontology_shards (session_id, shard_index, turn_range, status,
      phase_theme, candidates_json, relations_json, extraction_depth, shard_size, max_shard_chars)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('cache-s1', 0, '0-50', 'done', 'theme0', '[{"name":"c1"}]', '[{"from":"a"}]', 'refined', 1000, 5000);

  memDb.prepare(`
    INSERT INTO ontology_shards (session_id, shard_index, turn_range, status,
      phase_theme, candidates_json, relations_json, extraction_depth, shard_size, max_shard_chars)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('cache-s1', 1, '51-100', 'error', null, '[]', '[]', 'refined', 1000, 5000);

  const cache = loadOntologyShardCache('cache-s1', 'refined', 1000, 5000);

  assert.equal(cache.previousShardResults.length, 1);
  assert.equal(cache.previousShardResults[0]!.shardIndex, 0);
  assert.equal(cache.previousShardResults[0]!.phaseTheme, 'theme0');
  assert.equal(cache.previousShardResults[0]!.candidates.length, 1);
  assert.equal(cache.previousShardResults[0]!.relations.length, 1);

  assert.equal(cache.failedShardIndices.length, 1);
  assert.equal(cache.failedShardIndices[0], 1);
});

test('loadOntologyShardCache 无匹配结果返回空', () => {
  const cache = loadOntologyShardCache('cache-none', 'refined', 1000, 5000);
  assert.equal(cache.previousShardResults.length, 0);
  assert.equal(cache.failedShardIndices.length, 0);
});

test('loadOntologyShardCache 提取深度不匹配返回空', () => {
  memDb.prepare('INSERT OR IGNORE INTO sessions (id) VALUES (?)').run('cache-s2');

  memDb.prepare(`
    INSERT INTO ontology_shards (session_id, shard_index, turn_range, status,
      candidates_json, relations_json, extraction_depth, shard_size, max_shard_chars)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('cache-s2', 0, '0-50', 'done', '[{}]', '[{}]', 'refined', 1000, 5000);

  const cache = loadOntologyShardCache('cache-s2', 'deep', 1000, 5000);
  assert.equal(cache.previousShardResults.length, 0);
});
