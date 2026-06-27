import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, '..', 'data', 'llm-context.db');

const db = new Database(dbPath, { readonly: true });

const stats = {
  sessions: (db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n,
  turns: (db.prepare('SELECT COUNT(*) AS n FROM turns').get() as { n: number }).n,
  dbMb: db.prepare('SELECT ROUND(page_count * page_size / 1024.0 / 1024.0, 2) AS mb FROM pragma_page_count(), pragma_page_size()').get(),
  maxTurns: db.prepare('SELECT MAX(turn_count) AS n FROM sessions').get(),
  maxOntologyMb: db.prepare('SELECT ROUND(MAX(LENGTH(ontology_json)) / 1024.0 / 1024.0, 2) AS mb FROM ontology').get(),
  maxSegsKb: db.prepare('SELECT ROUND(MAX(LENGTH(segs_json)) / 1024.0, 2) AS kb FROM turns').get(),
};

const indexes = db.prepare("PRAGMA index_list('turns')").all() as Array<{ name: string }>;
const hasTurnIndex = indexes.some((row) => row.name === 'idx_turns_session_turn_index');

const largestSession = db.prepare('SELECT id FROM sessions ORDER BY turn_count DESC LIMIT 1').get() as { id: string } | undefined;

const planRows = largestSession ? db.prepare(`
  EXPLAIN QUERY PLAN
  SELECT id, turn_index, prompt, timestamp, asst_reqs, max_input, max_cache_hit,
         max_req_idx, max_req_step, out_tok, cum_total, cum_cache_hit,
         compression_reset, dur_ms, step_count
  FROM turns
  WHERE session_id = ?
  ORDER BY turn_index DESC
  LIMIT 200 OFFSET 0
`).all(largestSession.id) as Array<{ detail: string }> : [];

const plan = planRows.map((row) => row.detail).join('\n');
const usesTempSort = plan.includes('USE TEMP B-TREE FOR ORDER BY');

console.log(JSON.stringify({ stats, hasTurnIndex, planRows }, null, 2));

if (!hasTurnIndex) {
  console.error('Missing idx_turns_session_turn_index');
  process.exitCode = 1;
} else if (usesTempSort) {
  console.error('Turn list query still uses a temp B-tree sort');
  process.exitCode = 1;
}
