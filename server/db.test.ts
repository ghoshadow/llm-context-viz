import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { migrateTurnTranslationsV7 } from './db';

test('turn translation v7 migration drops constant rows and created_at column', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY
    );
    CREATE TABLE turn_translations (
      session_id TEXT NOT NULL,
      turn_index INTEGER NOT NULL,
      step_index INTEGER NOT NULL,
      section_index INTEGER NOT NULL DEFAULT 0,
      translated_text TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (session_id, turn_index, step_index, section_index)
    );
    INSERT INTO sessions VALUES ('s1');
    INSERT INTO turn_translations VALUES ('s1', 1, -100, 10, 'constant', '2026-01-01');
    INSERT INTO turn_translations VALUES ('s1', 1, 0, 20, 'ordinary', '2026-01-01');
  `);

  migrateTurnTranslationsV7(db);

  const columns = db.prepare('PRAGMA table_info(turn_translations)').all() as Array<{ name: string }>;
  assert.deepEqual(columns.map((column) => column.name), [
    'session_id',
    'turn_index',
    'step_index',
    'section_index',
    'translated_text',
  ]);

  const rows = db.prepare('SELECT step_index, translated_text FROM turn_translations ORDER BY step_index').all();
  assert.deepEqual(rows, [
    { step_index: 0, translated_text: 'ordinary' },
  ]);
});
