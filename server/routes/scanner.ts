import { Router } from 'express';
import { readdirSync, statSync, readFileSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import crypto from 'crypto';
import { getDb } from '../db';
import { createSession } from '../services/pipeline-service';

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

function scanDir(dir: string, maxDepth = 3): ScannedFile[] {
  const results: ScannedFile[] = [];
  if (!existsSync(dir)) return results;

  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const full = join(dir, entry);
      try {
        const st = statSync(full);
        if (st.isDirectory() && maxDepth > 0 && !entry.startsWith('.') && entry !== 'subagents') {
          results.push(...scanDir(full, maxDepth - 1));
        } else if (st.isFile() && entry.endsWith('.jsonl') && !entry.startsWith('agent-')) {
          results.push({
            path: full,
            name: entry,
            size: st.size,
            modified: st.mtime.toISOString(),
            source: inferSource(full),
          });
        }
      } catch {
        // skip inaccessible entries
      }
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
  hash: string;
  imported: boolean;
}

/** Quick metadata extraction from JSONL without running the full pipeline. */
function isQuickToolResult(obj: any): boolean {
  if (obj.message?.role !== 'user') return false;
  const content = obj.message?.content;
  if (typeof content === 'string') return false;
  if (Array.isArray(content)) {
    return content.some((b: any) => b.type === 'tool_result');
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
            // skip
          } else {
            if (!title && typeof c === 'string') {
              title = c.slice(0, 80);
            }
            turnCount++;
          }
        } else if (obj.type === 'user' && obj.message?.role === 'user' && !obj.isSidechain && !isQuickToolResult(obj) && obj.promptId) {
          // promptId fallback (pipeline: startsNewTurn returns true for promptId even without content)
          turnCount++;
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

router.get('/scan', (_req, res) => {
  try {
    const pathsParam = _req.query.paths as string | undefined;
    const dirs = pathsParam
      ? pathsParam.split(',').map(p => p.trim()).filter(Boolean)
      : DEFAULT_SCAN_PATHS;

    const maxDepth = parseInt((_req.query.depth as string) || '3', 10);
    const force = _req.query.force === '1';

    const allFiles: ScannedFile[] = [];
    for (const dir of dirs) {
      allFiles.push(...scanDir(dir, maxDepth));
    }
    allFiles.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());

    const db = getDb();

    // Load cached scan results
    const cache = new Map<string, { title?: string; model?: string; requests: number; peakTokens: number; turnCount: number; hash: string; modified: string }>();
    try {
      const rows = db.prepare('SELECT * FROM scanned_files').all() as any[];
      for (const r of rows) {
        cache.set(r.path, { title: r.title, model: r.model, requests: r.requests ?? 0, peakTokens: r.peak_tokens ?? 0, turnCount: r.turn_count ?? 0, hash: r.hash ?? '', modified: r.modified ?? '' });
      }
    } catch { /* table might not exist yet */ }

    // Check which files are already imported (by filename, since hash changes
    // as the JSONL grows during an active session)
    const dbImported = new Set<string>();
    try {
      const rows = db.prepare('SELECT filename FROM sessions').all() as { filename: string }[];
      for (const row of rows) dbImported.add(row.filename);
    } catch { }

    const upsertStmt = db.prepare(`
      INSERT INTO scanned_files (path, name, size, modified, hash, title, model, requests, peak_tokens, turn_count, last_seen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(path) DO UPDATE SET
        size=excluded.size, modified=excluded.modified, hash=excluded.hash,
        title=excluded.title, model=excluded.model, requests=excluded.requests,
        peak_tokens=excluded.peak_tokens, turn_count=excluded.turn_count,
        last_seen=excluded.last_seen
    `);

    // When forcing rescan, only clear the scanned_files cache so hashes
    // are recomputed.  Sessions are left intact — a file is "imported" iff
    // its current hash already exists in the sessions table.
    if (force) {
      try {
        db.prepare('DELETE FROM scanned_files').run();
        cache.clear();
      } catch { }
    }

    let cached = 0, scanned = 0;
    const files: FoundFile[] = [];
    for (const f of allFiles) {
      const cachedMeta = cache.get(f.path);
      let result: FoundFile;
      if (!force && cachedMeta && cachedMeta.modified === f.modified) {
        result = { ...f, ...cachedMeta, hash: cachedMeta.hash, imported: dbImported.has(f.name) };
      } else {
        let hash = '';
        let meta: ReturnType<typeof quickMeta> = { requests: 0, peakTokens: 0, turnCount: 0 };
        try {
          const content = readFileSync(f.path, 'utf-8');
          hash = crypto.createHash('sha256').update(content).digest('hex');
          meta = quickMeta(f.path, content);
        } catch { /* can't read */ }
        try {
          upsertStmt.run(f.path, f.name, f.size, f.modified, hash, meta.title || null, meta.model || null, meta.requests, meta.peakTokens, meta.turnCount);
        } catch { }
        result = { ...f, ...meta, hash, imported: dbImported.has(f.name) };
      }

      // Filter out sessions with 0 turns and 0 requests
      if ((result.turnCount ?? 0) === 0 && (result.requests ?? 0) === 0) continue;

      files.push(result);
      if (!force && cachedMeta && cachedMeta.modified === f.modified) {
        cached++;
      } else {
        scanned++;
      }
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
    res.status(500).json({ error: '扫描失败: ' + (err as Error).message });
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

/** Read sub-agent logs from the session directory and attach summaries to turns. */
export function enrichWithSubAgents(turns: any[], sessDir: string) {
  const subDir = join(sessDir, 'subagents');
  if (!existsSync(subDir)) return;

  // Collect all .jsonl files recursively (subagents + subagents/workflows/*)
  let subFiles: string[] = [];
  function collectJsonl(dir: string, depth: number) {
    if (depth > 3) return;
    try {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        try {
          const st = statSync(full);
          if (st.isDirectory() && !entry.startsWith('.')) {
            collectJsonl(full, depth + 1);
          } else if (st.isFile() && entry.endsWith('.jsonl')) {
            subFiles.push(full);
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }
  collectJsonl(subDir, 0);

  const subAgents: any[] = [];
  for (const f of subFiles) {
    try {
      const raw = readFileSync(f, 'utf-8');
      const lines = raw.split('\n').filter(l => l.trim());
      let model = '', firstPrompt = '', asstCount = 0, firstTs = '', lastTs = '';
      const toolCalls: string[] = [];

      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          const ts = obj.timestamp;
          if (ts) { if (!firstTs) firstTs = ts; lastTs = ts; }
          if (obj.type === 'assistant') {
            asstCount++;
            if (!model && obj.message?.model) model = obj.message.model;
            for (const b of (obj.message?.content ?? [])) {
              if (b.type === 'tool_use' && toolCalls.length < 5) {
                if (!toolCalls.includes(b.name)) toolCalls.push(b.name);
              }
            }
          }
          if (obj.type === 'user' && !obj.isSidechain && !firstPrompt) {
            const c = obj.message?.content;
            firstPrompt = typeof c === 'string' ? c.slice(0, 120) : '';
          }
        } catch { /* skip */ }
      }

      let dur = 0;
      if (firstTs && lastTs) {
        dur = Math.max(0, new Date(lastTs).getTime() - new Date(firstTs).getTime());
      }

      subAgents.push({ file: f, model, prompt: firstPrompt, asstCount, durMs: dur, toolCalls, firstTs, lastTs });
    } catch { /* skip */ }
  }

  if (subAgents.length === 0) return;

  // Separate workflow sub-agents (in subagents/workflows/) from direct ones
  const workflowAgents = subAgents.filter((sa: any) => sa.file.includes('/workflows/'));
  const directAgents = subAgents.filter((sa: any) => !sa.file.includes('/workflows/'));

  for (const turn of turns) {
    // Workflow sub-agents → attach to the LAST Workflow segment in the turn
    if (workflowAgents.length > 0) {
      let lastWfSeg: any = null;
      for (const seg of (turn.segs ?? [])) {
        if (seg.k === 's' && seg.n === 'Workflow') lastWfSeg = seg;
      }
      if (lastWfSeg && lastWfSeg.det) {
        lastWfSeg.det.subAgents = workflowAgents;
      }
    }

    // Direct sub-agents → match each to the LAST Agent call that
    // happened before the sub-agent started.  This correctly assigns
    // sub-agents to overlapping/consecutive Agent calls in the same turn.
    if (directAgents.length > 0) {
      // Collect all Agent call times (m-segment ts before each s-segment)
      const agentCalls: { seg: any; callMs: number }[] = [];
      for (let si = 0; si < (turn.segs ?? []).length; si++) {
        const seg = turn.segs![si]!;
        if (seg.k !== 's') continue;
        // Call time = timestamp of the last m-segment before this s-segment
        let callMs = new Date(seg.ts).getTime();
        for (let j = si - 1; j >= 0; j--) {
          if (turn.segs![j]!.k === 'm') {
            callMs = new Date(turn.segs![j]!.ts).getTime();
            break;
          }
        }
        agentCalls.push({ seg, callMs });
      }

      // Turn window: only match sub-agents that started within this turn
      const turnStartMs = new Date(turn.ts).getTime();
      const turnEndMs = turns.indexOf(turn) + 1 < turns.length
        ? new Date(turns[turns.indexOf(turn) + 1]!.ts).getTime()
        : Infinity;

      for (const sa of directAgents) {
        if (!sa.firstTs) continue;
        const saMs = new Date(sa.firstTs).getTime();
        if (saMs < turnStartMs || saMs >= turnEndMs) continue; // wrong turn

        // Find the last Agent call that happened before this sub-agent started
        let best: { seg: any; callMs: number } | null = null;
        for (const ac of agentCalls) {
          if (ac.callMs <= saMs) {
            if (!best || ac.callMs > best.callMs) {
              best = ac;
            }
          }
        }

        if (best && best.seg.det) {
          if (!best.seg.det.subAgents) best.seg.det.subAgents = [];
          best.seg.det.subAgents.push(sa);
        }
      }
    }
  }
}

// ── POST /import ───────────────────────────────────────────────────────────
// Body: { path: string } — absolute path to a .jsonl file

router.post('/import', (req, res) => {
  try {
    const filePath = (req.body as { path?: string }).path;
    if (!filePath) {
      return res.status(400).json({ error: '缺少文件路径' });
    }

    if (!existsSync(filePath)) {
      return res.status(404).json({ error: '文件不存在: ' + filePath });
    }

    const content = readFileSync(filePath, 'utf-8');
    const hash = crypto.createHash('sha256').update(content).digest('hex');

    // Check for duplicate
    const db = getDb();
    const existing = db.prepare('SELECT id FROM sessions WHERE file_hash = ?').get(hash) as { id: string } | undefined;
    if (existing) {
      return res.status(200).json({ imported: false, sessionId: existing.id, message: '会话已存在' });
    }

    const filename = basename(filePath);
    const aiTitle = extractSessionTitle(content);

    const { sessionId, summary, turns } = createSession({
      jsonlContent: content, filename, hash, aiTitle, rawJsonl: null,
    });

    res.status(201).json({
      imported: true,
      sessionId,
      model: summary.session.model,
      total_requests: summary.session.requests,
      peak_tokens: summary.session.peakTokens,
      turn_count: turns.length,
    });
  } catch (err) {
    res.status(500).json({ error: '导入失败: ' + (err as Error).message });
  }
});

export default router;
