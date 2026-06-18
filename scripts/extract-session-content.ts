/**
 * extract-session-content.ts
 *
 * 从 JSONL 会话转录中提取自然语言内容（用户消息、模型回复、思考过程），
 * 无截断，用于喂给 LLM 做本体提取。
 *
 * 用法：
 *   npx tsx scripts/extract-session-content.ts <session-id>
 *   npx tsx scripts/extract-session-content.ts <file-path>.jsonl
 *
 * 参数可以是 session-id（从 DB 读取）或 .jsonl 文件路径（直接读取）。
 * 数据来源优先级（session-id 模式）：
 *   1. DB sessions.raw_jsonl（上传的会话）
 *   2. 磁盘原始 JSONL（scanner 导入的会话）
 */

import { getDb } from '../server/db.js';
import { extractSessionContent } from '../server/content/extract-session.js';
import { readFileSync, existsSync } from 'fs';

const arg = process.argv[2];
if (!arg) {
  console.error('用法: npx tsx scripts/extract-session-content.ts <session-id|file.jsonl>');
  process.exit(1);
}

// ── 文件路径模式：直接读取 .jsonl 文件 ─────────────────────────────────

if (arg.endsWith('.jsonl')) {
  if (!existsSync(arg)) {
    console.error('文件不存在:', arg);
    process.exit(1);
  }
  const raw = readFileSync(arg, 'utf-8');
  process.stdout.write(extractSessionContent(raw));
  process.exit(0);
}

// ── Session ID 模式：从 DB 读取 ────────────────────────────────────────

const db = getDb();
const session = db
  .prepare('SELECT raw_jsonl, file_hash FROM sessions WHERE id = ?')
  .get(arg) as { raw_jsonl: string | null; file_hash: string } | undefined;

if (!session) {
  console.error('会话不存在:', arg);
  process.exit(1);
}

// 来源 1: raw_jsonl
if (session.raw_jsonl) {
  process.stdout.write(extractSessionContent(session.raw_jsonl));
  process.exit(0);
}

// 来源 2: 磁盘文件（scanner 导入的会话）
const scanned = db
  .prepare('SELECT path FROM scanned_files WHERE hash = ?')
  .get(session.file_hash) as { path: string } | undefined;

if (scanned?.path && existsSync(scanned.path)) {
  const content = readFileSync(scanned.path, 'utf-8');
  process.stdout.write(extractSessionContent(content));
  process.exit(0);
}

console.error('无法获取原始 JSONL 内容。尝试通过 API 兜底...');
process.exit(1);
