/**
 * build-ontology-data.ts — 一次性脚本，构建指定会话的本体数据
 * 用法: npx tsx scripts/build-ontology-data.ts <session-id>
 */
import { getDb } from '../server/db.js';
import { buildOntology } from '../src/pipeline/build-ontology.js';
import { writeFileSync } from 'fs';

const sessionId = process.argv[2];
if (!sessionId) { console.error('用法: npx tsx scripts/build-ontology-data.ts <session-id>'); process.exit(1); }

const db = getDb();
const row = db.prepare('SELECT id FROM sessions WHERE id = ?').get(sessionId);
if (!row) { console.error('会话不存在:', sessionId); process.exit(1); }

const data = db.prepare('SELECT ontology_json FROM ontology WHERE session_id = ?').get(sessionId) as any;
if (data?.ontology_json) {
  const existing = JSON.parse(data.ontology_json);
  console.log('已有本体数据:', existing.nodes?.length, 'nodes,', existing.edges?.length, 'edges');
  console.log('请先运行 ./scripts/extract-ontology.sh ' + sessionId + ' 再 POST 到 /ontology/build');
  process.exit(0);
}

console.log('会话存在但无本体数据。请先提取会话内容生成 Prompt，交给 LLM 输出 candidates+relations，再 POST 到 /api/sessions/' + sessionId + '/ontology/build');
