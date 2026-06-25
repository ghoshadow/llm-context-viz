import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/**
 * Search ~/.claude/projects/ for a JSONL file by filename.
 * Returns the absolute path, or null if not found.
 */
export function findJsonlFile(filename: string): string | null {
  const dirs = [join(homedir(), '.claude', 'projects')];
  for (const dir of dirs) {
    try {
      const queue = [dir];
      while (queue.length > 0) {
        const d = queue.shift()!;
        for (const entry of readdirSync(d)) {
          const full = join(d, entry);
          try {
            const st = statSync(full);
            if (st.isDirectory() && !entry.startsWith('.') && entry !== 'subagents') {
              if (queue.length < 50) queue.push(full);
            } else if (st.isFile() && entry === filename) {
              return full;
            }
          } catch {}
        }
      }
    } catch {}
  }
  return null;
}
