import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let db: Database.Database | null = null;

const DB_PATH = path.join(__dirname, '..', 'data', 'llm-context.db');

export function getDb(): Database.Database {
  if (db) return db;

  db = new Database(DB_PATH);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');

  // Enable foreign key enforcement
  db.pragma('foreign_keys = ON');

  return db;
}

export function initDb(): void {
  const conn = getDb();

  conn.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      file_hash TEXT NOT NULL UNIQUE,
      model TEXT,
      version TEXT,
      ai_title TEXT,
      cwd TEXT,
      total_requests INTEGER,
      peak_index INTEGER,
      peak_tokens INTEGER,
      peak_cache_hit INTEGER DEFAULT 0,
      peak_turn_idx INTEGER DEFAULT 0,
      peak_step INTEGER DEFAULT 0,
      total_output INTEGER,
      context_limit INTEGER DEFAULT 200000,
      turn_count INTEGER,
      raw_size INTEGER,
      categories_json TEXT,
      tools_json TEXT,
      series_json TEXT,
      raw_jsonl TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS turns (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      turn_index INTEGER NOT NULL,
      prompt TEXT,
      timestamp TEXT,
      asst_reqs INTEGER,
      max_input INTEGER,
      max_cache_hit INTEGER DEFAULT 0,
      max_req_idx INTEGER DEFAULT 0,
      max_req_step INTEGER DEFAULT 0,
      out_tok INTEGER,
      cum_total INTEGER,
      cum_cache_hit INTEGER DEFAULT 0,
      cum_tools_json TEXT,
      compression_reset INTEGER DEFAULT 0,
      dur_ms INTEGER,
      model_ms INTEGER,
      tool_ms INTEGER,
      sub_ms INTEGER,
      step_count INTEGER,
      comp_json TEXT,
      delta_json TEXT,
      tools_json TEXT,
      segs_json TEXT,
      longest_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id);

    CREATE TABLE IF NOT EXISTS ontology (
      session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
      ontology_json TEXT NOT NULL,
      max_turn INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS scanned_files (
      path TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      size INTEGER,
      modified TEXT,
      hash TEXT,
      title TEXT,
      model TEXT,
      requests INTEGER,
      peak_tokens INTEGER,
      peak_cache_hit INTEGER DEFAULT 0,
      turn_count INTEGER,
      last_seen TEXT DEFAULT (datetime('now'))
    );
  `);
}

export function migrate(): void {
  const conn = getDb();
  const userVersion = conn.pragma('user_version', { simple: true }) as number;

  if (userVersion < 1) {
    conn.exec(`ALTER TABLE turns ADD COLUMN compression_reset INTEGER DEFAULT 0`);
    conn.pragma('user_version = 1');
  }
}
