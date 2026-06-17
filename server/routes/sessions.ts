import { Router } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import { getDb } from '../db';
import { runPipeline } from '../../src/pipeline/index';
import { enrichWithSubAgents } from './scanner';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
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
        total_requests, peak_index, peak_tokens, total_output, context_limit,
        turn_count, raw_size, categories_json, tools_json, series_json, raw_jsonl
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?
      )
    `);

    const insertTurn = db.prepare(`
      INSERT INTO turns (
        id, session_id, turn_index, prompt, timestamp,
        asst_reqs, max_input, out_tok, cum_total, dur_ms,
        model_ms, tool_ms, sub_ms, step_count,
        comp_json, delta_json, tools_json, segs_json, longest_json
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?
      )
    `);

    const txn = db.transaction(() => {
      insertSession.run(
        sessionId,
        originalFilename,
        hash,
        summary.session.model,
        summary.session.version,
        summary.session.cwd,
        summary.session.requests,
        summary.session.peakIndex,
        summary.session.peakTokens,
        summary.session.totalOutput,
        summary.session.contextLimit,
        turns.length,
        Buffer.byteLength(content, 'utf-8'),
        JSON.stringify(summary.categories),
        JSON.stringify(summary.tools),
        JSON.stringify(summary.series),
        content,
      );

      for (const turn of turns) {
        const turnId = `${sessionId}-${turn.i}`;
        insertTurn.run(
          turnId,
          sessionId,
          turn.i,
          turn.prompt,
          turn.ts,
          turn.asstReqs,
          turn.maxInput,
          turn.outTok,
          turn.cumTotal,
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
// GET /:id/turns
// ---------------------------------------------------------------------------

router.get('/:id/turns', (req, res) => {
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, turn_index, prompt, timestamp, asst_reqs, max_input, out_tok, cum_total, dur_ms, step_count
         FROM turns
         WHERE session_id = ?
         ORDER BY turn_index`,
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

export default router;
