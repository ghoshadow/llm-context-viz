import { Router } from 'express';
import { existsSync } from 'fs';
import { readFile, readdir, stat } from 'fs/promises';
import { join, basename } from 'path';
import { homedir } from 'os';
import crypto from 'crypto';
import { createSession } from '../services/pipeline-service';
import { sanitizeForLog } from '../utils/log-sanitizer.js';
import { validateBody, ImportRequestSchema } from '../middleware/validate.js';
import {
  getAllScannedFiles,
  upsertScannedFile,
  clearScannedFiles,
  getAllImportedFilenames,
  findSessionByHash,
} from '../repositories/session-repository';

const router = Router();

type SessionSource = 'claude' | 'codex';

interface ScannedFile {
  path: string;
  name: string;
  size: number;
  modified: string;
  source: SessionSource;
}

// Default scan paths — Claude Code and Codex store transcripts in different homes.
const DEFAULT_SCAN_PATHS = [
  join(homedir(), '.claude', 'projects'),
  join(homedir(), '.codex', 'sessions'),
  join(homedir(), '.codex', 'archived_sessions'),
];

/**
 * Recursively scan a directory for .jsonl files.
 * Returns an array of { path, name, size, modified } for each file found.
 */
function inferSource(filePath: string): SessionSource {
  return filePath.includes(`${join(homedir(), '.codex')}/`) ? 'codex' : 'claude';
}

async function scanDir(dir: string, maxDepth = 3): Promise<ScannedFile[]> {
  const results: ScannedFile[] = [];
  if (!existsSync(dir)) return results;

  try {
    const entries = await readdir(dir);
    const entryResults = await Promise.all(
      entries.map(async (entry) => {
        const full = join(dir, entry);
        try {
          const st = await stat(full);
          if (st.isDirectory() && maxDepth > 0 && !entry.startsWith('.') && entry !== 'subagents') {
            return await scanDir(full, maxDepth - 1);
          } else if (st.isFile() && entry.endsWith('.jsonl') && !entry.startsWith('agent-')) {
            return [{
              path: full,
              name: entry,
              size: st.size,
              modified: st.mtime.toISOString(),
              source: inferSource(full),
            }] as ScannedFile[];
          }
        } catch {
          // skip inaccessible entries
        }
        return [] as ScannedFile[];
      }),
    );
    for (const group of entryResults) {
      results.push(...group);
    }
  } catch {
    // skip inaccessible directories
  }

  return results;
}

interface FoundFile extends ScannedFile {
  title?: string;
  model?: string;
  requests?: number;
  peakTokens?: number;
  turnCount?: number;
  cwd?: string;
  hash: string;
  imported: boolean;
}

/** Extract cwd from first 50 lines of JSONL without full pipeline. */
function quickCwd(raw: string): string {
  const lines = raw.split('\n');
  for (let i = 0; i < Math.min(lines.length, 50); i++) {
    try {
      const obj = JSON.parse(lines[i]!);
      if (typeof obj.cwd === 'string' && obj.cwd) return obj.cwd;
      // Codex 格式：cwd 在 payload 内
      if (typeof obj.payload?.cwd === 'string' && obj.payload.cwd) return obj.payload.cwd;
    } catch { /* skip */ }
  }
  return '';
}

/** Quick metadata extraction from JSONL without running the full pipeline. */
function isQuickToolResult(obj: Record<string, unknown>): boolean {
  const message = obj.message as { role?: string; content?: unknown } | undefined;
  if (message?.role !== 'user') return false;
  const content = message?.content;
  if (typeof content === 'string') return false;
  if (Array.isArray(content)) {
    return content.some((b: unknown) => {
      if (typeof b === 'object' && b !== null) {
        return (b as Record<string, unknown>).type === 'tool_result';
      }
      return false;
    });
  }
  return false;
}

function textFromOpenAiContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      if (!block || typeof block !== 'object') return '';
      const b = block as { type?: string; text?: string };
      return (b.type === 'input_text' || b.type === 'output_text') && typeof b.text === 'string'
        ? b.text
        : '';
    })
    .filter(Boolean)
    .join('\n');
}

function quickMeta(filePath: string, raw: string): { title?: string; model?: string; requests: number; peakTokens: number; turnCount: number } {
  return inferSource(filePath) === 'codex' ? quickMetaCodex(raw) : quickMetaClaude(raw);
}

function quickMetaClaude(raw: string): { title?: string; model?: string; requests: number; peakTokens: number; turnCount: number } {
  let title: string | undefined;
  let model: string | undefined;
  let requests = 0;
  let peakTokens = 0;
  let turnCount = 0;

  try {
    const lines = raw.split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.type === 'ai-title' && !title) {
          title = obj.aiTitle as string;
        } else if (obj.type === 'assistant') {
          requests++;
          const tok = obj.message?.usage?.input_tokens;
          if (tok && tok > peakTokens) peakTokens = tok;
          if (!model && obj.message?.model) model = obj.message.model;
        } else if (obj.type === 'user' && obj.message?.role === 'user' && !obj.isSidechain && !isQuickToolResult(obj)) {
          // Skip task notifications (same as pipeline's startsNewTurn)
          const c = obj.message?.content;
          if (typeof c === 'string' && c.startsWith('<task-notification>')) {
            // promptId fallback: pipeline counts these as turns even without content
            if (obj.promptId) turnCount++;
            // else skip
          } else {
            if (!title && typeof c === 'string') {
              title = c.slice(0, 80);
            }
            turnCount++;
          }
        }
      } catch { /* skip malformed lines */ }
    }
  } catch { /* can't read */ }

  return { title, model, requests, peakTokens, turnCount };
}

function quickMetaCodex(raw: string): { title?: string; model?: string; requests: number; peakTokens: number; turnCount: number } {
  let title: string | undefined;
  let fallbackTitle: string | undefined;
  let model: string | undefined;
  let requests = 0;
  let peakTokens = 0;
  let turnCount = 0;
  const seenTurns = new Set<string>();

  try {
    const lines = raw.split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        const payload = obj.payload || {};

        if (obj.type === 'session_meta') {
          if (!fallbackTitle && typeof payload.id === 'string') fallbackTitle = payload.id;
          if (!model && typeof payload.model === 'string') model = payload.model;
        } else if (obj.type === 'turn_context') {
          if (!model && typeof payload.model === 'string') model = payload.model;
        }

        if (payload.type === 'task_started' && typeof payload.turn_id === 'string') {
          seenTurns.add(payload.turn_id);
          turnCount = seenTurns.size;
        } else if (payload.type === 'user_message' && !title && typeof payload.message === 'string') {
          title = payload.message.trim().slice(0, 120);
        } else if (obj.type === 'response_item' && payload.type === 'message' && payload.role === 'user' && !title) {
          const text = textFromOpenAiContent(payload.content).trim();
          if (text && !text.startsWith('<environment_context>')) title = text.slice(0, 120);
        } else if (obj.type === 'event_msg' && payload.type === 'token_count') {
          requests++;
          const usage = payload.info?.last_token_usage;
          const input = usage?.input_tokens;
          if (typeof input === 'number' && input > peakTokens) peakTokens = input;
        }
      } catch { /* skip malformed lines */ }
    }
  } catch { /* can't read */ }

  return { title: title || fallbackTitle, model: model || 'codex', requests, peakTokens, turnCount };
}

// ── GET /scan ──────────────────────────────────────────────────────────────
// Query params:
//   paths  - comma-separated list of directories to scan (optional)
//   depth  - max subdirectory depth (default 3)

router.get('/scan', async (_req, res) => {
  try {
    const pathsParam = _req.query.paths as string | undefined;
    const dirs = pathsParam
      ? pathsParam.split(',').map(p => p.trim()).filter(Boolean)
      : DEFAULT_SCAN_PATHS;

    const maxDepth = parseInt((_req.query.depth as string) || '3', 10);
    const force = _req.query.force === '1';

    const allFiles: ScannedFile[] = [];
    const dirResults = await Promise.all(dirs.map((dir) => scanDir(dir, maxDepth)));
    for (const group of dirResults) {
      allFiles.push(...group);
    }
    allFiles.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());

    // Load cached scan results
    const cache = new Map<string, { title?: string; model?: string; requests: number; peakTokens: number; turnCount: number; cwd?: string; hash: string; modified: string }>();
    try {
      const rows = getAllScannedFiles();
      for (const r of rows) {
        cache.set(r.path, { title: r.title, model: r.model, requests: r.requests ?? 0, peakTokens: r.peak_tokens ?? 0, turnCount: r.turn_count ?? 0, cwd: r.cwd, hash: r.hash ?? '', modified: r.modified ?? '' });
      }
    } catch { /* table might not exist yet */ }

    // Check which files are already imported (by filename, since hash changes
    // as the JSONL grows during an active session)
    const dbImported = new Set<string>();
    try {
      const filenames = getAllImportedFilenames();
      for (const fn of filenames) dbImported.add(fn);
    } catch { }

    // When forcing rescan, only clear the scanned_files cache so hashes
    // are recomputed.  Sessions are left intact — a file is "imported" iff
    // its current hash already exists in the sessions table.
    if (force) {
      try {
        clearScannedFiles();
        cache.clear();
      } catch { }
    }

    let cached = 0, scanned = 0;
    const files: FoundFile[] = [];
    const fileResults = await Promise.all(
      allFiles.map(async (f) => {
        const cachedMeta = cache.get(f.path);
        let result: FoundFile;
        if (!force && cachedMeta && cachedMeta.modified === f.modified) {
          result = { ...f, ...cachedMeta, hash: cachedMeta.hash, imported: dbImported.has(f.name) };
        } else {
          let hash = '';
          let meta: ReturnType<typeof quickMeta> = { requests: 0, peakTokens: 0, turnCount: 0 };
          let cwd = '';
          try {
            const content = await readFile(f.path, 'utf-8');
            hash = crypto.createHash('sha256').update(content).digest('hex');
            meta = quickMeta(f.path, content);
            cwd = quickCwd(content);
          } catch { /* can't read */ }
          try {
            upsertScannedFile({
              path: f.path, name: f.name, size: f.size, modified: f.modified, hash,
              title: meta.title || null, model: meta.model || null,
              requests: meta.requests, peakTokens: meta.peakTokens, turnCount: meta.turnCount,
              cwd: cwd || null,
            });
          } catch { }
          result = { ...f, ...meta, cwd: cwd || undefined, hash, imported: dbImported.has(f.name) };
        }

        // Filter out sessions with 0 turns and 0 requests
        if ((result.turnCount ?? 0) === 0 && (result.requests ?? 0) === 0) return null;

        return { result, wasCached: !force && cachedMeta && cachedMeta.modified === f.modified };
      }),
    );

    for (const item of fileResults) {
      if (!item) continue;
      files.push(item.result);
      if (item.wasCached) cached++; else scanned++;
    }

    res.json({
      scannedDirs: dirs,
      totalFiles: files.length,
      importedCount: files.filter(f => f.imported).length,
      cached,
      scanned,
      files,
    });
  } catch (err) {
    console.error('GET /scan error:', sanitizeForLog(err instanceof Error ? err.message : String(err)));
    res.status(500).json({ error: '扫描失败: ' + (err instanceof Error ? err.message : String(err)) });
  }
});

/** Extract session title: first user message (preferred) or ai-title. */
function extractSessionTitle(jsonlContent: string): string {
  try {
    let aiTitle = '';
    for (const line of jsonlContent.split('\n').slice(0, 50)) {
      if (!line.trim()) continue;
      const obj = JSON.parse(line);
      if (obj.type === 'event_msg' && obj.payload?.type === 'user_message' && typeof obj.payload.message === 'string') {
        return obj.payload.message.trim().slice(0, 120);
      }
      // First non-tool user message is the best title
      if (obj.type === 'user' && !obj.isSidechain && obj.message?.role === 'user') {
        const c = obj.message.content;
        if (typeof c === 'string' && c.trim()) return c.trim().slice(0, 120);
      }
      if (obj.type === 'ai-title' && obj.aiTitle && !aiTitle) {
        aiTitle = obj.aiTitle as string;
      }
    }
    return aiTitle;
  } catch { /* ignore */ }
  return '';
}

// Re-export from dedicated service module for backward compatibility.
export { enrichWithSubAgents } from '../services/sub-agent-enricher.js';

function isSessionUniqueConstraintError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const code = typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code?: unknown }).code)
    : '';
  return (
    code.startsWith('SQLITE_CONSTRAINT') &&
    /(?:UNIQUE constraint failed|PRIMARY KEY).+sessions\.(?:file_hash|id)/.test(message)
  ) || /UNIQUE constraint failed: sessions\.(?:file_hash|id)/.test(message);
}

// ── POST /import ───────────────────────────────────────────────────────────
// Body: { path: string } — absolute path to a .jsonl file

router.post('/import', validateBody(ImportRequestSchema), async (req, res) => {
  try {
    const filePath = req.body.path;

    if (!existsSync(filePath)) {
      return res.status(404).json({ error: '文件不存在: ' + filePath });
    }

    const content = await readFile(filePath, 'utf-8');
    const hash = crypto.createHash('sha256').update(content).digest('hex');

    // Check for duplicate
    const existing = findSessionByHash(hash);
    if (existing) {
      return res.status(200).json({ imported: false, sessionId: existing.id, message: '会话已存在' });
    }

    const filename = basename(filePath);
    const aiTitle = extractSessionTitle(content);

    let created: Awaited<ReturnType<typeof createSession>>;
    try {
      created = await createSession({
        jsonlContent: content, filename, hash, aiTitle, rawJsonl: null,
      });
    } catch (err) {
      const racedExisting = isSessionUniqueConstraintError(err) ? findSessionByHash(hash) : undefined;
      if (racedExisting) {
        return res.status(200).json({ imported: false, sessionId: racedExisting.id, message: '会话已存在' });
      }
      throw err;
    }

    const { sessionId, summary, turns, errors } = created;

    res.status(201).json({
      imported: true,
      sessionId,
      model: summary.session.model,
      total_requests: summary.session.requests,
      peak_tokens: summary.session.peakTokens,
      turn_count: turns.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error('POST /import error:', sanitizeForLog(err instanceof Error ? err.message : String(err)));
    res.status(500).json({ error: '导入失败: ' + (err instanceof Error ? err.message : String(err)) });
  }
});

export default router;
