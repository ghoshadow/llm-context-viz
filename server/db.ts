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
    CREATE INDEX IF NOT EXISTS idx_turns_session_turn_index
      ON turns(session_id, turn_index DESC);

    CREATE TABLE IF NOT EXISTS ontology (
      session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
      ontology_json TEXT NOT NULL,
      max_turn INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
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

    CREATE INDEX IF NOT EXISTS idx_ontology_shards_session
      ON ontology_shards(session_id, extraction_depth, shard_index);

    CREATE TABLE IF NOT EXISTS ontology_card_summaries (
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      topic_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'not_started',
      summary TEXT,
      error TEXT,
      model TEXT,
      prompt_hash TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      started_at TEXT,
      completed_at TEXT,
      PRIMARY KEY (session_id, topic_id)
    );

    CREATE INDEX IF NOT EXISTS idx_ontology_card_summaries_session
      ON ontology_card_summaries(session_id, status, updated_at);

    CREATE TABLE IF NOT EXISTS obsidian_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      vault_path TEXT,
      notes_dir TEXT NOT NULL DEFAULT 'LLM知识卡片',
      filename_template TEXT NOT NULL DEFAULT '第{{startTurn}}-{{endTurn}}轮 - {{title}} - {{topicHash}}.md',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ontology_obsidian_syncs (
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      topic_id TEXT NOT NULL,
      vault_path TEXT NOT NULL,
      note_path TEXT NOT NULL,
      content_hash TEXT,
      status TEXT NOT NULL,
      error TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      last_synced_at TEXT,
      PRIMARY KEY (session_id, topic_id)
    );

    CREATE INDEX IF NOT EXISTS idx_ontology_obsidian_syncs_session
      ON ontology_obsidian_syncs(session_id, status, updated_at);

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

    CREATE TABLE IF NOT EXISTS turn_translations (
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      turn_index INTEGER NOT NULL,
      step_index INTEGER NOT NULL,
      section_index INTEGER NOT NULL DEFAULT 0,
      translated_text TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (session_id, turn_index, step_index, section_index)
    );
  `);
}

export function migrate(): void {
  const conn = getDb();
  const userVersion = conn.pragma('user_version', { simple: true }) as number;

  // v0 → v1: add compression_reset column to turns (legacy)
  if (userVersion < 1) {
    const columns = conn.prepare('PRAGMA table_info(turns)').all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'compression_reset')) {
      conn.exec(`ALTER TABLE turns ADD COLUMN compression_reset INTEGER DEFAULT 0`);
    }
    conn.pragma('user_version = 1');
  }

  // v1 → v2: baseline for all current tables
  // New databases already get these via initDb()'s CREATE TABLE IF NOT EXISTS.
  // This step ensures older databases add any missing tables added post-v1.
  if (userVersion < 2) {
    conn.exec(`
      CREATE TABLE IF NOT EXISTS ontology (
        session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
        ontology_json TEXT NOT NULL,
        max_turn INTEGER NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
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

      CREATE INDEX IF NOT EXISTS idx_ontology_shards_session
        ON ontology_shards(session_id, extraction_depth, shard_index);

      CREATE TABLE IF NOT EXISTS ontology_card_summaries (
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        topic_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'not_started',
        summary TEXT,
        error TEXT,
        model TEXT,
        prompt_hash TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        started_at TEXT,
        completed_at TEXT,
        PRIMARY KEY (session_id, topic_id)
      );

      CREATE INDEX IF NOT EXISTS idx_ontology_card_summaries_session
        ON ontology_card_summaries(session_id, status, updated_at);

      CREATE TABLE IF NOT EXISTS obsidian_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        vault_path TEXT,
        notes_dir TEXT NOT NULL DEFAULT 'LLM知识卡片',
        filename_template TEXT NOT NULL DEFAULT '第{{startTurn}}-{{endTurn}}轮 - {{title}} - {{topicHash}}.md',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS ontology_obsidian_syncs (
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        topic_id TEXT NOT NULL,
        vault_path TEXT NOT NULL,
        note_path TEXT NOT NULL,
        content_hash TEXT,
        status TEXT NOT NULL,
        error TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        last_synced_at TEXT,
        PRIMARY KEY (session_id, topic_id)
      );

      CREATE INDEX IF NOT EXISTS idx_ontology_obsidian_syncs_session
        ON ontology_obsidian_syncs(session_id, status, updated_at);

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
    conn.pragma('user_version = 2');
  }

  // v2 → v3: add turn_translations table for persisting LLM translations
  if (userVersion < 3) {
    conn.exec(`
      CREATE TABLE IF NOT EXISTS turn_translations (
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        turn_index INTEGER NOT NULL,
        step_index INTEGER NOT NULL,
        translated_text TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (session_id, turn_index, step_index)
      );
    `);
    conn.pragma('user_version = 3');
  }

  // v3 → v4: add section_index column to turn_translations
  // Old table had (session_id, turn_index, step_index) PK — drop and recreate
  if (userVersion < 4) {
    conn.exec(`
      DROP TABLE IF EXISTS turn_translations;
      CREATE TABLE turn_translations (
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        turn_index INTEGER NOT NULL,
        step_index INTEGER NOT NULL,
        section_index INTEGER NOT NULL DEFAULT 0,
        translated_text TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (session_id, turn_index, step_index, section_index)
      );
    `);
    conn.pragma('user_version = 4');
  }

  // v4 → v5: support paginated turn lists without a temp sort.
  if (userVersion < 5) {
    conn.exec(`
      CREATE INDEX IF NOT EXISTS idx_turns_session_turn_index
        ON turns(session_id, turn_index DESC);
    `);
    conn.pragma('user_version = 5');
  }
}
