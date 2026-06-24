/**
 * extract-session-content.ts
 *
 * 从 JSONL 会话转录中提取自然语言内容（用户消息、模型回复、思考过程），
 * 无截断，用于喂给 LLM 做本体提取。
 *
 * 用法：
 *   npx tsx scripts/extract-session-content.ts <session-id|file.jsonl>
 *   npx tsx scripts/extract-session-content.ts <session-id|file.jsonl> --to-files
 *   npx tsx scripts/extract-session-content.ts <session-id|file.jsonl> --to-files --force
 *
 * 参数可以是 session-id（从 DB 读取）或 .jsonl 文件路径（直接读取）。
 * --to-files  将内容按 30 轮分组写入持久化文件树（data/extractions/<id>/）
 * --force     强制覆盖已有文件树（需配合 --to-files）
 *
 * 数据来源优先级（session-id 模式）：
 *   1. DB sessions.raw_jsonl（上传的会话）
 *   2. 磁盘原始 JSONL（scanner 导入的会话）
 */

import { getDb } from '../server/db.js';
import { extractSessionContent } from '../server/content/extract-session.js';
import { extractToFiles } from '../server/content/extract-to-files.js';
import { readFileSync, existsSync } from 'fs';

const args = process.argv.slice(2);
const toFiles = args.includes('--to-files');
const force = args.includes('--force');
const arg = args.find((a) => a && !a.startsWith('--'));

if (!arg) {
  console.error('用法: npx tsx scripts/extract-session-content.ts <session-id|file.jsonl> [--to-files] [--force]');
  process.exit(1);
}

// ── 获取原始 JSONL 内容 ────────────────────────────────────────────────

let rawJsonl: string;
let sessionId: string;

if (arg.endsWith('.jsonl')) {
  if (!existsSync(arg)) {
    console.error('文件不存在:', arg);
    process.exit(1);
  }
  rawJsonl = readFileSync(arg, 'utf-8');
  // 从文件名提取 session ID（取最后一个路径段，去掉扩展名）
  sessionId = arg.replace(/^.*[/]/, '').replace(/\.jsonl$/, '');
} else {
  const db = getDb();
  const session = db
    .prepare('SELECT id, raw_jsonl, file_hash FROM sessions WHERE id = ?')
    .get(arg) as { id: string; raw_jsonl: string | null; file_hash: string } | undefined;

  if (!session) {
    console.error('会话不存在:', arg);
    process.exit(1);
  }

  sessionId = session.id;

  if (session.raw_jsonl) {
    rawJsonl = session.raw_jsonl;
  } else {
    const scanned = db
      .prepare('SELECT path FROM scanned_files WHERE hash = ?')
      .get(session.file_hash) as { path: string } | undefined;

    if (!scanned?.path || !existsSync(scanned.path)) {
      console.error('无法获取原始 JSONL 内容');
      process.exit(1);
    }
    rawJsonl = readFileSync(scanned.path, 'utf-8');
  }
}

// ── 输出 ────────────────────────────────────────────────────────────────

if (toFiles) {
  const manifest = extractToFiles(rawJsonl, sessionId, { force });
  console.log(JSON.stringify(manifest, null, 2));
  console.error(`\n已写入 ${manifest.shardCount} 个分片文件到: ${manifest.rootDir}`);
} else {
  process.stdout.write(extractSessionContent(rawJsonl));
}
