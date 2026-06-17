import { Router } from 'express';
import { readdirSync, statSync, readFileSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import crypto from 'crypto';
import { getDb } from '../db';
import { runPipeline } from '../../src/pipeline/index';

const router = Router();

// Default scan paths — Claude Code stores transcripts under ~/.claude/projects/
const DEFAULT_SCAN_PATHS = [
  join(homedir(), '.claude', 'projects'),
];

/**
 * Recursively scan a directory for .jsonl files.
 * Returns an array of { path, name, size, modified } for each file found.
 */
function scanDir(dir: string, maxDepth = 3): FoundFile[] {
  const results: FoundFile[] = [];
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

interface FoundFile {
  path: string;
  name: string;
  size: number;
  modified: string;
  title?: string;
  model?: string;
  requests?: number;
  peakTokens?: number;
  turnCount?: number;
  hash: string;
  imported: boolean;
}

/** Quick metadata extraction from JSONL without running the full pipeline. */
function quickMeta(filePath: string): { title?: string; model?: string; requests: number; peakTokens: number; turnCount: number } {
  let title: string | undefined;
  let model: string | undefined;
  let requests = 0;
  let peakTokens = 0;
  let turnCount = 0;

  try {
    const raw = readFileSync(filePath, 'utf-8');
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
        } else if (obj.type === 'user' && obj.message?.role === 'user' && !obj.isSidechain) {
          if (!title && typeof obj.message?.content === 'string') {
            title = (obj.message.content as string).slice(0, 80);
          }
          turnCount++;
        }
      } catch { /* skip malformed lines */ }
    }
  } catch { /* can't read */ }

  return { title, model, requests, peakTokens, turnCount };
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

    const allFiles: FoundFile[] = [];
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

    // Check which files are already imported
    const dbImported = new Set<string>();
    try {
      const rows = db.prepare('SELECT file_hash FROM sessions').all() as { file_hash: string }[];
      for (const row of rows) dbImported.add(row.file_hash);
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

    let cached = 0, scanned = 0;
    const files: FoundFile[] = allFiles.map(f => {
      const cachedMeta = cache.get(f.path);
      // Use cache if mtime unchanged and not forcing rescan
      if (!force && cachedMeta && cachedMeta.modified === f.modified) {
        cached++;
        return { ...f, ...cachedMeta, hash: cachedMeta.hash, imported: dbImported.has(cachedMeta.hash) };
      }

      // Compute hash and metadata for new/changed files
      let hash = '';
      let meta: ReturnType<typeof quickMeta> = { requests: 0, peakTokens: 0, turnCount: 0 };
      try {
        const content = readFileSync(f.path, 'utf-8');
        hash = crypto.createHash('sha256').update(content).digest('hex');
        meta = quickMeta(f.path);
      } catch { /* can't read */ }

      // Persist to cache
      try {
        upsertStmt.run(f.path, f.name, f.size, f.modified, hash, meta.title || null, meta.model || null, meta.requests, meta.peakTokens, meta.turnCount);
      } catch { }

      scanned++;
      return { ...f, ...meta, hash, imported: dbImported.has(hash) };
    });

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

  // Match sub-agents to turns by timestamp
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i]!;
    const turnEnd = (i + 1 < turns.length) ? turns[i + 1]!.ts : '9999';
    for (const sa of subAgents) {
      if (sa.firstTs && sa.firstTs >= turn.ts && sa.firstTs < turnEnd) {
        if (!(turn as any)._subAgents) (turn as any)._subAgents = [];
        (turn as any)._subAgents.push(sa);
      }
    }
  }

  // Embed per-turn sub-agent summaries into s-type segments
  for (const turn of turns) {
    const agents = (turn as any)._subAgents as any[] | undefined;
    if (!agents || agents.length === 0) continue;
    const segs = turn.segs ?? [];
    for (const seg of segs) {
      if (seg.k === 's' && seg.det) {
        seg.det.subAgents = agents;
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
    const { summary, turns } = runPipeline(content, filename);
    const sessionId = hash.substring(0, 16);

    // Extract ai-title from raw JSONL
    const aiTitle = extractSessionTitle(content);

    // Enrich turns with sub-agent summaries from the session directory
    const sessDir = filePath.replace(/\.jsonl$/, '');
    enrichWithSubAgents(turns, sessDir);

    // Insert session
    const insertSession = db.prepare(`
      INSERT INTO sessions (
        id, filename, file_hash, model, version, ai_title, cwd,
        total_requests, peak_index, peak_tokens, peak_cache_hit, peak_turn_idx, peak_step, total_output, context_limit,
        turn_count, raw_size, categories_json, tools_json, series_json, raw_jsonl
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertSession.run(
      sessionId,
      filename,
      hash,
      summary.session.model,
      summary.session.version,
      aiTitle,
      summary.session.cwd,
      summary.session.requests,
      summary.session.peakIndex,
      summary.session.peakTokens,
      summary.session.peakCacheHit,
      summary.session.peakTurnIdx,
      summary.session.peakStep,
      summary.session.totalOutput,
      summary.session.contextLimit,
      turns.length,
      content.length,
      JSON.stringify(summary.categories),
      JSON.stringify(summary.tools),
      JSON.stringify(summary.series),
      null,  // raw_jsonl: skip to save space
    );

    // Insert turns
    const insertTurn = db.prepare(`
      INSERT INTO turns (
        id, session_id, turn_index, prompt, timestamp, asst_reqs,
        max_input, max_cache_hit, max_req_idx, max_req_step, out_tok, cum_total, cum_cache_hit, cum_tools_json, dur_ms, model_ms, tool_ms, sub_ms,
        step_count, comp_json, delta_json, tools_json, segs_json, longest_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertTurns = db.transaction(() => {
      for (const turn of turns) {
        insertTurn.run(
          `${sessionId}_${turn.i}`,
          sessionId,
          turn.i,
          turn.prompt,
          turn.ts,
          turn.asstReqs,
          turn.maxInput,
          turn.maxCacheHit ?? 0,
          turn.maxReqIdx ?? 0,
          turn.maxReqStep ?? 0,
          turn.outTok,
          turn.cumTotal,
          (turn as any).cumCacheHit ?? 0,
          JSON.stringify((turn as any).cumTools ?? {}),
          turn.durMs,
          turn.modelMs,
          turn.toolMs,
          turn.subMs,
          turn.stepCount,
          JSON.stringify(turn.comp),
          JSON.stringify(turn.delta),
          JSON.stringify(turn.tools),
          JSON.stringify(turn.segs),
          JSON.stringify(turn.longest),
        );
      }
    });

    insertTurns();

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
