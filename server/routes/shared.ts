import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { sanitizeForLog } from '../utils/log-sanitizer.js';

/**
 * Search known local transcript roots for a JSONL file by filename.
 * Returns the absolute path, or null if not found.
 *
 * 使用异步 fs/promises API，避免阻塞事件循环。
 */
export async function findJsonlFile(filename: string): Promise<string | null> {
  const dirs = [
    join(homedir(), '.claude', 'projects'),
    join(homedir(), '.codex', 'sessions'),
    join(homedir(), '.codex', 'archived_sessions'),
  ];
  for (const dir of dirs) {
    try {
      const queue = [dir];
      while (queue.length > 0) {
        const d = queue.shift()!;
        let entries: string[];
        try {
          entries = await readdir(d);
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code !== 'ENOENT') {
            console.error(
              `findJsonlFile: 读取目录 ${sanitizeForLog(d)} 失败:`,
              sanitizeForLog(err instanceof Error ? err.message : String(err)),
            );
          }
          continue;
        }
        for (const entry of entries) {
          const full = join(d, entry);
          try {
            const st = await stat(full);
            if (st.isDirectory() && !entry.startsWith('.') && entry !== 'subagents') {
              if (queue.length < 50) queue.push(full);
            } else if (st.isFile() && entry === filename) {
              return full;
            }
          } catch (err) {
            const code = (err as NodeJS.ErrnoException).code;
            if (code !== 'ENOENT') {
              console.error(
                `findJsonlFile: stat ${sanitizeForLog(full)} 失败:`,
                sanitizeForLog(err instanceof Error ? err.message : String(err)),
              );
            }
          }
        }
      }
    } catch (err) {
      console.error(
        `findJsonlFile: 遍历 ${sanitizeForLog(dir)} 失败:`,
        sanitizeForLog(err instanceof Error ? err.message : String(err)),
      );
    }
  }
  return null;
}
