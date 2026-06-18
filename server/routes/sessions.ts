import { Router } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import { getDb } from '../db';
import { runPipeline, setMemoryChars, loadCalibratedConstants } from '../../src/pipeline/index';
import { buildOntology } from '../../src/pipeline/build-ontology';
import { enrichWithSubAgents } from './scanner';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const router = Router();

// ---------------------------------------------------------------------------
// Multer setup: accept single file upload, max 50 MB
// ---------------------------------------------------------------------------

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// ---------------------------------------------------------------------------
// POST /upload
// ---------------------------------------------------------------------------

router.post('/upload', upload.single('file'), (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: '未上传文件' });
    }

    const content = file.buffer.toString('utf-8');
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    const originalFilename = file.originalname;

    const db = getDb();

    // Check for duplicate by file_hash
    const existing = db.prepare('SELECT id FROM sessions WHERE file_hash = ?').get(hash) as
      | { id: string }
      | undefined;
    if (existing) {
      return res.status(409).json({ error: '文件已存在', sessionId: existing.id });
    }

    // Run the full pipeline
    loadCalibratedConstants();
    try {
      const globalMd = join(homedir(), '.claude', 'CLAUDE.md');
      if (existsSync(globalMd)) setMemoryChars(readFileSync(globalMd, 'utf-8').length);
    } catch {}
    const { summary, turns } = runPipeline(content, originalFilename);

    const sessionId = hash.substring(0, 16);

    // Enrich with sub-agent data via temp file
    try {
      const tmpDir = mkdtempSync(join(tmpdir(), 'llm-viz-upload-'));
      writeFileSync(join(tmpDir, sessionId + '.jsonl'), content);
      enrichWithSubAgents(turns as any, tmpDir);
      rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* enrichment is best-effort */ }

    // Use a transaction for all inserts
    const insertSession = db.prepare(`
      INSERT INTO sessions (
        id, filename, file_hash, model, version, cwd,
        total_requests, peak_index, peak_tokens, peak_cache_hit, peak_turn_idx, peak_step, total_output, context_limit,
        turn_count, raw_size, categories_json, tools_json, series_json, raw_jsonl
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?
      )
    `);

    const insertTurn = db.prepare(`
      INSERT INTO turns (
        id, session_id, turn_index, prompt, timestamp, asst_reqs,
        max_input, max_cache_hit, max_req_idx, max_req_step, out_tok, cum_total, cum_cache_hit, cum_tools_json, compression_reset, dur_ms, model_ms, tool_ms, sub_ms,
        step_count, comp_json, delta_json, tools_json, segs_json, longest_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const txn = db.transaction(() => {
      insertSession.run(
        sessionId, originalFilename, hash,
        summary.session.model, summary.session.version, summary.session.cwd,
        summary.session.requests, summary.session.peakIndex,
        summary.session.peakTokens, summary.session.peakCacheHit ?? 0,
        summary.session.peakTurnIdx ?? 0, summary.session.peakStep ?? 0,
        summary.session.totalOutput, summary.session.contextLimit,
        turns.length, Buffer.byteLength(content, 'utf-8'),
        JSON.stringify(summary.categories), JSON.stringify(summary.tools), JSON.stringify(summary.series),
        content,
      );

      for (const turn of turns) {
        const turnId = `${sessionId}-${turn.i}`;
        insertTurn.run(
          turnId, sessionId, turn.i, turn.prompt, turn.ts, turn.asstReqs,
          turn.maxInput, turn.maxCacheHit ?? 0, turn.maxReqIdx ?? 0, turn.maxReqStep ?? 0,
          turn.outTok, turn.cumTotal, (turn as any).cumCacheHit ?? 0,
          JSON.stringify((turn as any).cumTools ?? {}),
          (turn as any).compressionReset ? 1 : 0,
          turn.durMs, turn.modelMs, turn.toolMs, turn.subMs, turn.stepCount,
          JSON.stringify(turn.comp), JSON.stringify(turn.delta), JSON.stringify(turn.tools),
          JSON.stringify(turn.segs), JSON.stringify(turn.longest),
        );
      }
    });

    txn();

    return res.status(201).json({
      id: sessionId,
      filename: originalFilename,
      model: summary.session.model,
      version: summary.session.version,
      total_requests: summary.session.requests,
      peak_tokens: summary.session.peakTokens,
      turn_count: turns.length,
    });
  } catch (err) {
    console.error('POST /upload error:', err);
    return res.status(500).json({ error: '处理上传文件时出错' });
  }
});

// ---------------------------------------------------------------------------
// GET /
// ---------------------------------------------------------------------------

router.get('/', (_req, res) => {
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, filename, model, version, ai_title, total_requests, peak_tokens, turn_count, created_at
         FROM sessions
         ORDER BY created_at DESC`,
      )
      .all();

    return res.json(rows);
  } catch (err) {
    console.error('GET / error:', err);
    return res.status(500).json({ error: '获取会话列表时出错' });
  }
});

// ---------------------------------------------------------------------------
// GET /:id
// ---------------------------------------------------------------------------

router.get('/:id', (req, res) => {
  try {
    const db = getDb();
    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id) as
      | Record<string, unknown>
      | undefined;

    if (!row) {
      return res.status(404).json({ error: '会话不存在' });
    }

    // Parse JSON string columns back to objects
    const {
      categories_json,
      tools_json,
      series_json,
      raw_jsonl,
      ...rest
    } = row as Record<string, unknown> & {
      categories_json?: string;
      tools_json?: string;
      series_json?: string;
      raw_jsonl?: string;
    };

    const detail = {
      ...rest,
      categories: categories_json ? JSON.parse(categories_json) : [],
      tools: tools_json ? JSON.parse(tools_json) : [],
      series: series_json ? JSON.parse(series_json) : [],
    };

    return res.json(detail);
  } catch (err) {
    console.error('GET /:id error:', err);
    return res.status(500).json({ error: '获取会话详情时出错' });
  }
});

// ---------------------------------------------------------------------------
// POST /:id/refresh — re-parse the original JSONL and update DB turns
// ---------------------------------------------------------------------------

import { readdirSync, statSync } from 'fs';
import { homedir } from 'os';

function findJsonlFile(filename: string): string | null {
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

router.post('/:id/refresh', (req, res) => {
  try {
    const db = getDb();
    const session = db.prepare('SELECT id, filename, file_hash, raw_jsonl FROM sessions WHERE id = ?').get(req.params.id) as { id: string; filename: string; file_hash: string; raw_jsonl?: string } | undefined;
    if (!session) return res.status(404).json({ error: '会话不存在' });

    let content: string;
    let sessDir: string;
    const filePath = findJsonlFile(session.filename);
    if (filePath) {
      content = readFileSync(filePath, 'utf-8');
      sessDir = filePath.replace(/\.jsonl$/, '');
    } else if (session.raw_jsonl) {
      content = session.raw_jsonl;
      sessDir = ''; // sub-agents not available for uploaded sessions
    } else {
      return res.status(404).json({ error: '找不到原始 JSONL 数据' });
    }
    const sids = req.params.id;

    // Re-run pipeline
    loadCalibratedConstants();
    let memChars = 0;
    const globalMd = join(homedir(), '.claude', 'CLAUDE.md');
    if (existsSync(globalMd)) memChars += readFileSync(globalMd, 'utf-8').length;
    try {
      const firstLine = JSON.parse(content.split('\n')[0]!);
      const cwd = firstLine.cwd;
      if (cwd) { const pm = join(cwd, '.claude', 'CLAUDE.md'); if (existsSync(pm)) memChars += readFileSync(pm, 'utf-8').length; }
    } catch {}
    setMemoryChars(memChars);

    const { summary, turns } = runPipeline(content, session.filename);
    if (sessDir) enrichWithSubAgents(turns, sessDir);

    // Replace turns in a transaction
    const deleteTurns = db.prepare('DELETE FROM turns WHERE session_id = ?');
    const insertTurn = db.prepare(`
      INSERT INTO turns (
        id, session_id, turn_index, prompt, timestamp, asst_reqs,
        max_input, max_cache_hit, max_req_idx, max_req_step, out_tok, cum_total, cum_cache_hit, cum_tools_json, compression_reset, dur_ms, model_ms, tool_ms, sub_ms,
        step_count, comp_json, delta_json, tools_json, segs_json, longest_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const updateSession = db.prepare('UPDATE sessions SET turn_count = ?, total_requests = ?, peak_tokens = ?, peak_cache_hit = ?, peak_turn_idx = ?, peak_step = ?, total_output = ?, context_limit = ?, categories_json = ?, tools_json = ?, series_json = ?, updated_at = datetime(\'now\') WHERE id = ?');

    db.transaction(() => {
      deleteTurns.run(sids);
      for (const turn of turns) {
        insertTurn.run(
          `${sids}_${turn.i}`, sids, turn.i, turn.prompt, turn.ts, turn.asstReqs,
          turn.maxInput, turn.maxCacheHit ?? 0, turn.maxReqIdx ?? 0, turn.maxReqStep ?? 0,
          turn.outTok, turn.cumTotal, (turn as any).cumCacheHit ?? 0,
          JSON.stringify((turn as any).cumTools ?? {}),
          (turn as any).compressionReset ? 1 : 0,
          turn.durMs, turn.modelMs, turn.toolMs, turn.subMs, turn.stepCount,
          JSON.stringify(turn.comp), JSON.stringify(turn.delta), JSON.stringify(turn.tools),
          JSON.stringify(turn.segs), JSON.stringify(turn.longest),
        );
      }
      updateSession.run(
        turns.length, summary.session.requests, summary.session.peakTokens,
        summary.session.peakCacheHit, summary.session.peakTurnIdx, summary.session.peakStep,
        summary.session.totalOutput, summary.session.contextLimit,
        JSON.stringify(summary.categories), JSON.stringify(summary.tools), JSON.stringify(summary.series),
        sids,
      );
    })();

    res.json({ ok: true, turnCount: turns.length });
  } catch (err) {
    res.status(500).json({ error: '刷新失败: ' + (err as Error).message });
  }
});

// GET /:id/turns
// ---------------------------------------------------------------------------

router.get('/:id/turns', (req, res) => {
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, turn_index, prompt, timestamp, asst_reqs, max_input, max_cache_hit, max_req_idx, max_req_step, out_tok, cum_total, cum_cache_hit, compression_reset, dur_ms, step_count
         FROM turns
         WHERE session_id = ?
         ORDER BY turn_index DESC`,
      )
      .all(req.params.id);

    return res.json(rows);
  } catch (err) {
    console.error('GET /:id/turns error:', err);
    return res.status(500).json({ error: '获取轮次列表时出错' });
  }
});

// ---------------------------------------------------------------------------
// GET /:id/turns/:turnIndex
// ---------------------------------------------------------------------------

router.get('/:id/turns/:turnIndex', (req, res) => {
  try {
    const db = getDb();
    const turnIndex = parseInt(req.params.turnIndex, 10);
    if (isNaN(turnIndex)) {
      return res.status(400).json({ error: '无效的轮次索引' });
    }

    const row = db
      .prepare('SELECT * FROM turns WHERE session_id = ? AND turn_index = ?')
      .get(req.params.id, turnIndex) as Record<string, unknown> | undefined;

    if (!row) {
      return res.status(404).json({ error: '轮次不存在' });
    }

    // Parse all JSON string columns
    const {
      comp_json,
      delta_json,
      tools_json: turnToolsJson,
      segs_json,
      longest_json,
      ...rest
    } = row as Record<string, unknown> & {
      comp_json?: string;
      delta_json?: string;
      tools_json?: string;
      segs_json?: string;
      longest_json?: string;
    };

    const detail = {
      ...rest,
      comp: comp_json ? JSON.parse(comp_json) : {},
      delta: delta_json ? JSON.parse(delta_json) : {},
      tools: turnToolsJson ? JSON.parse(turnToolsJson) : {},
      segs: segs_json ? JSON.parse(segs_json) : [],
      longest: longest_json ? JSON.parse(longest_json) : null,
    };

    return res.json(detail);
  } catch (err) {
    console.error('GET /:id/turns/:turnIndex error:', err);
    return res.status(500).json({ error: '获取轮次详情时出错' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /:id
// ---------------------------------------------------------------------------

router.delete('/:id', (req, res) => {
  try {
    const db = getDb();
    const result = db.prepare('DELETE FROM sessions WHERE id = ?').run(req.params.id);

    if (result.changes === 0) {
      return res.status(404).json({ error: '会话不存在' });
    }

    return res.status(204).send();
  } catch (err) {
    console.error('DELETE /:id error:', err);
    return res.status(500).json({ error: '删除会话时出错' });
  }
});

// ---------------------------------------------------------------------------
// GET /:id/ontology
// ---------------------------------------------------------------------------

router.get('/:id/ontology', (req, res) => {
  try {
    const db = getDb();
    const row = db
      .prepare('SELECT ontology_json, max_turn FROM ontology WHERE session_id = ?')
      .get(req.params.id) as { ontology_json: string; max_turn: number } | undefined;

    if (!row) {
      return res.status(404).json({ error: '该会话尚无本体数据。请通过 POST 上传本体 JSON。' });
    }

    const data = JSON.parse(row.ontology_json);
    return res.json({ sessionId: req.params.id, maxTurn: row.max_turn, data });
  } catch (err) {
    console.error('GET /:id/ontology error:', err);
    return res.status(500).json({ error: '获取本体数据时出错' });
  }
});

// ---------------------------------------------------------------------------
// POST /:id/ontology/extract — SSE streaming ontology extraction
// ---------------------------------------------------------------------------

router.post('/:id/ontology/extract', (req, res) => {
  try {
    const sessionId = req.params.id;
    const db = getDb();
    const session = db.prepare('SELECT id, raw_jsonl, filename FROM sessions WHERE id = ?').get(sessionId) as { id: string; raw_jsonl?: string; filename: string } | undefined;
    if (!session) return res.status(404).json({ error: '会话不存在' });

    // SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    (async () => {
      try {
        // Read session content
        let content = session.raw_jsonl;
        if (!content) {
          // Try to find the file on disk
          const filePath = findJsonlFile(session.filename);
          if (!filePath) {
            send('error', { stage: 'read', message: '找不到会话文件' });
            res.end();
            return;
          }
          content = readFileSync(filePath, 'utf-8');
        }

        // Parse JSONL and extract turn content
        const lines = content.split('\n').filter(l => l.trim());
        const turns: Array<{ index: number; userMsg: string; thinking: string; asstText: string }> = [];
        let turnIdx = 0;
        let currentUser = '';
        let currentThinking = '';
        let currentAsstText = '';

        for (const line of lines) {
          try {
            const obj = JSON.parse(line);
            if (obj.type === 'user' && obj.message?.role === 'user' && !obj.isSidechain) {
              const c = obj.message?.content;
              if (typeof c === 'string' && !c.startsWith('<task-notification>')) {
                if (currentUser && (currentThinking || currentAsstText)) {
                  turns.push({ index: turnIdx, userMsg: currentUser, thinking: currentThinking, asstText: currentAsstText });
                }
                turnIdx++;
                currentUser = c;
                currentThinking = '';
                currentAsstText = '';
              }
            } else if (obj.type === 'assistant') {
              for (const block of (obj.message?.content ?? [])) {
                if (block.type === 'thinking') currentThinking += (block.thinking || '') + '\n';
                if (block.type === 'text') currentAsstText += (block.text || '') + '\n';
              }
            }
          } catch {}
        }
        if (currentUser) turns.push({ index: turnIdx, userMsg: currentUser, thinking: currentThinking, asstText: currentAsstText });

        const shardSize = Number(req.body.shardSize) || 5;
        const overlap = Number(req.body.overlap) || 1;
        const shards: Array<{ index: number; turns: typeof turns }> = [];
        for (let i = 0; i < turns.length; i += shardSize - overlap) {
          shards.push({ index: shards.length, turns: turns.slice(i, i + shardSize) });
        }

        send('start', { shards: shards.length, totalTurns: turns.length });

        // Load model from session
        const sessionModel = (db.prepare('SELECT model FROM sessions WHERE id = ?').get(sessionId) as any)?.model || 'deepseek-v4-pro';
        const LLM_KEY = process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY || '';
        const API_URL = (process.env.LLM_BASE_URL || 'https://api.deepseek.com/anthropic') + '/v1/messages';

        const allCandidates: any[] = [];
        const allRelations: any[] = [];
        const seenEntities = new Set<string>();

        for (const shard of shards) {
          send('shardStart', { shardIndex: shard.index });

          // Build context text for this shard
          const context = shard.turns.map(t =>
            `[Turn ${t.index}] User: ${t.userMsg.slice(0, 300)}\nThinking: ${t.thinking.slice(0, 500)}\nReply: ${t.asstText.slice(0, 200)}`
          ).join('\n---\n');

          const prompt = `Analyze this conversation transcript and extract key entities and their relationships.\n\nOutput a JSON object with "candidates" (entities) and "relations" (relationships between entities).\n\nEach candidate: { id: kebab-case, label: short name, type: "mechanism"|"agent"|"system"|"error"|"func"|"code"|"command", conf: 0-1, firstTurn: number, turns: [turn numbers], snippet: "brief description" }\n\nEach relation: { s: source_id, t: target_id, label: relationship, firstTurn: number, conf: 0-1 }\n\nConversation:\n${context.slice(0, 8000)}`;

          try {
            const resp = await fetch(API_URL, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': LLM_KEY,
                'anthropic-version': '2023-06-01',
              },
              body: JSON.stringify({
                model: sessionModel,
                max_tokens: 4000,
                messages: [{ role: 'user', content: prompt }],
              }),
              signal: AbortSignal.timeout(120000),
            });

            if (resp.ok) {
              const data = await resp.json() as any;
              const text = data.content?.find((b: any) => b.type === 'text')?.text
                || data.content?.[0]?.text || '';
              // Try to parse JSON from LLM response
              const jsonMatch = text.match(/\{[\s\S]*\}/);
              let shardCandidates: any[] = [];
              let shardRelations: any[] = [];
              if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                shardCandidates = (parsed.candidates || []).map((c: any) => ({
                  ...c, firstTurn: shard.turns[0]?.index ?? c.firstTurn,
                  turns: c.turns || [],
                }));
                shardRelations = (parsed.relations || []).map((r: any) => ({
                  ...r, firstTurn: shard.turns[0]?.index ?? r.firstTurn,
                }));
                for (const c of shardCandidates) {
                  if (!seenEntities.has(c.id)) {
                    seenEntities.add(c.id);
                    allCandidates.push(c);
                  }
                }
                allRelations.push(...shardRelations);
              }
              send('shardDone', { shardIndex: shard.index, candidates: shardCandidates.length, relations: shardRelations.length });
            } else {
              send('shardError', { shardIndex: shard.index, error: `API ${resp.status}` });
            }
          } catch (e) {
            send('shardError', { shardIndex: shard.index, error: (e as Error).message });
          }
        }

        // Run buildOntology pipeline
        const result = buildOntology({
          candidates: allCandidates,
          relations: allRelations,
          config: {
            sources: ['user_message', 'assistant_final_reply', 'assistant_thinking'],
            keepTypes: ['mechanism', 'agent', 'system'],
            pruneOrphans: true,
            maxTurn: turns.length,
          },
        });

        // Store in DB
        db.prepare(
          `INSERT OR REPLACE INTO ontology (session_id, ontology_json, max_turn, updated_at) VALUES (?, ?, ?, datetime('now'))`
        ).run(sessionId, JSON.stringify(result.data), result.meta.maxTurn);

        send('complete', { sessionId, meta: result.meta, stats: result.stats, data: result.data });
      } catch (err) {
        send('error', { stage: 'extract', message: (err as Error).message });
      }
      res.end();
    })();
  } catch (err) {
    res.status(500).json({ error: '提取失败: ' + (err as Error).message });
  }
});

// ---------------------------------------------------------------------------
// POST /:id/ontology
// ---------------------------------------------------------------------------

router.post('/:id/ontology', (req, res) => {
  try {
    const db = getDb();
    const { data } = req.body;

    // Validate structure
    if (!data || !Array.isArray(data.types) || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
      return res.status(400).json({ error: '请求体格式错误: 需要 { data: { types, nodes, edges } }' });
    }

    // Validate edge endpoints exist in nodes
    const nodeIds = new Set(data.nodes.map((n: { id: string }) => n.id));
    for (const edge of data.edges) {
      if (!nodeIds.has(edge.s)) {
        return res.status(400).json({ error: `边引用未知源节点: ${edge.s}` });
      }
      if (!nodeIds.has(edge.t)) {
        return res.status(400).json({ error: `边引用未知目标节点: ${edge.t}` });
      }
    }

    // Verify session exists
    const session = db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(req.params.id);
    if (!session) {
      return res.status(404).json({ error: '会话不存在' });
    }

    // Compute maxTurn from nodes
    const maxTurn = Math.max(...data.nodes.map((n: { firstTurn: number }) => n.firstTurn), 1);

    // Upsert
    db.prepare(
      `INSERT OR REPLACE INTO ontology (session_id, ontology_json, max_turn, updated_at)
       VALUES (?, ?, ?, datetime('now'))`,
    ).run(req.params.id, JSON.stringify(data), maxTurn);

    return res.json({ sessionId: req.params.id, maxTurn, data });
  } catch (err) {
    console.error('POST /:id/ontology error:', err);
    return res.status(500).json({ error: '保存本体数据时出错' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /:id/ontology
// ---------------------------------------------------------------------------

router.delete('/:id/ontology', (req, res) => {
  try {
    const db = getDb();
    const result = db.prepare('DELETE FROM ontology WHERE session_id = ?').run(req.params.id);

    if (result.changes === 0) {
      return res.status(404).json({ error: '本体数据不存在' });
    }

    return res.json({ deleted: true });
  } catch (err) {
    console.error('DELETE /:id/ontology error:', err);
    return res.status(500).json({ error: '删除本体数据时出错' });
  }
});

// ---------------------------------------------------------------------------
// POST /:id/ontology/build — run the 5-stage ontology build pipeline
// ---------------------------------------------------------------------------

router.post('/:id/ontology/build', (req, res) => {
  try {
    const db = getDb();
    const { candidates, relations, config } = req.body;

    // Validate required fields
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return res.status(400).json({ error: 'candidates 数组不能为空' });
    }
    if (!Array.isArray(relations)) {
      return res.status(400).json({ error: 'relations 数组不能为空' });
    }

    // Verify session exists
    const session = db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(req.params.id);
    if (!session) {
      return res.status(404).json({ error: '会话不存在' });
    }

    // Run the ontology build pipeline
    const result = buildOntology({ candidates, relations, config });
    const { data, meta, stats } = result;

    // Store built ontology in DB
    db.prepare(
      `INSERT OR REPLACE INTO ontology (session_id, ontology_json, max_turn, updated_at)
       VALUES (?, ?, ?, datetime('now'))`,
    ).run(req.params.id, JSON.stringify(data), meta.maxTurn);

    return res.status(201).json({ sessionId: req.params.id, ...result });
  } catch (err) {
    console.error('POST /:id/ontology/build error:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : '构建本体数据时出错',
    });
  }
});

// ---------------------------------------------------------------------------
// POST /:id/ontology/extract — SSE 流式执行 LLM 本体提取
// ---------------------------------------------------------------------------

router.post('/:id/ontology/extract', async (req, res) => {
  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const send = (event: string, data: Record<string, unknown>) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const db = getDb();
    const sessionId = req.params.id;

    // 验证会话存在并获取 raw_jsonl
    const session = db.prepare('SELECT id, raw_jsonl, filename FROM sessions WHERE id = ?').get(sessionId) as
      | { id: string; raw_jsonl: string | null; filename: string }
      | undefined;
    if (!session) {
      send('error', { message: '会话不存在' });
      return;
    }

    // 优先使用 DB 中的 raw_jsonl，否则尝试从磁盘读取
    let rawJsonl = session.raw_jsonl;
    if (!rawJsonl) {
      const filePath = findJsonlFile(session.filename);
      if (filePath && existsSync(filePath)) {
        rawJsonl = readFileSync(filePath, 'utf-8');
      }
    }

    if (!rawJsonl) {
      send('error', { message: '该会话的原始 JSONL 数据不可用' });
      return;
    }

    // 动态导入 LLM 提取模块
    const { extractAndBuild } = await import('../llm/extract-ontology.js');
    const { shardSize, overlap } = req.body || {};

    const result = await extractAndBuild(rawJsonl, sessionId, send, {
      shardSize: shardSize ?? 50,
      overlap: overlap ?? 5,
    });

    if (result.success) {
      const { data, meta } = result.buildOutput;
      db.prepare(
        `INSERT OR REPLACE INTO ontology (session_id, ontology_json, max_turn, updated_at)
         VALUES (?, ?, ?, datetime('now'))`,
      ).run(sessionId, JSON.stringify(data), meta.maxTurn);
      send('complete', { sessionId, maxTurn: meta.maxTurn, stats: result.shardStats });
    } else {
      send('error', { message: result.message, detail: result.detail, stage: result.stage });
    }
  } catch (err) {
    console.error('POST /:id/ontology/extract error:', err);
    send('error', { message: '提取本体数据时出错: ' + (err instanceof Error ? err.message : String(err)) });
  } finally {
    res.end();
  }
});

export default router;
