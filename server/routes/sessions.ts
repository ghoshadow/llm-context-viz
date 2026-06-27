import { Router } from 'express';
import { getDb } from '../db';
import { refreshSession } from '../services/pipeline-service';
import { callTranslationLLM } from '../llm/translation-client';
import { enrichWithSubAgents } from './scanner';
import { readFileSync } from 'fs';
import { getSessionSource } from '../../src/utils/sessionSource';

import { findJsonlFile } from './shared';
import ontologyRouter from './ontology';
import { parseTurnListPagination } from './pagination';

const router = Router();

// ============================================================================
// Mount ontology sub-router
// ============================================================================

router.use('/:id/ontology', ontologyRouter);

// ============================================================================
// GET /
// ============================================================================

router.get('/', (_req, res) => {
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, filename, model, version, ai_title, total_requests, peak_tokens, turn_count, created_at
         FROM sessions
         ORDER BY created_at DESC`,
      )
      .all() as Array<Record<string, unknown>>;

    return res.json(rows.map((row) => ({ ...row, source: getSessionSource(row) })));
  } catch (err) {
    console.error('GET / error:', err);
    return res.status(500).json({ error: '获取会话列表时出错' });
  }
});

// ============================================================================
// GET /:id
// ============================================================================

router.get('/:id', (req, res) => {
  try {
    const db = getDb();
    const row = db.prepare(
      `SELECT id, filename, file_hash, model, version, ai_title, cwd,
              total_requests, peak_index, peak_tokens, peak_cache_hit,
              peak_turn_idx, peak_step, total_output, context_limit,
              turn_count, raw_size, categories_json, tools_json, series_json,
              created_at, updated_at
       FROM sessions
       WHERE id = ?`,
    ).get(req.params.id) as
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
      ...rest
    } = row as Record<string, unknown> & {
      categories_json?: string;
      tools_json?: string;
      series_json?: string;
    };

    const detail = {
      ...rest,
      source: getSessionSource(rest),
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

// ============================================================================
// POST /:id/refresh — re-parse the original JSONL and update DB turns
// ============================================================================

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

    const { turns } = refreshSession({
      sessionId: session.id,
      jsonlContent: content,
      filename: session.filename,
    });

    if (sessDir) enrichWithSubAgents(turns, sessDir);

    res.json({ ok: true, turnCount: turns.length });
  } catch (err) {
    res.status(500).json({ error: '刷新失败: ' + (err as Error).message });
  }
});

// ============================================================================
// GET /:id/turns
// ============================================================================

router.get('/:id/turns', (req, res) => {
  try {
    const db = getDb();
    const page = parseTurnListPagination(req.query);
    const selectSql = `SELECT id, turn_index, prompt, timestamp, asst_reqs, max_input, max_cache_hit, max_req_idx, max_req_step, out_tok, cum_total, cum_cache_hit, compression_reset, dur_ms, step_count
       FROM turns
       WHERE session_id = ?
       ORDER BY turn_index DESC`;
    const rows = page.all
      ? db.prepare(selectSql).all(req.params.id)
      : db.prepare(`${selectSql} LIMIT ? OFFSET ?`).all(req.params.id, page.limit, page.offset);

    if (page.all) return res.json(rows);

    const totalRow = db.prepare('SELECT COUNT(*) AS total FROM turns WHERE session_id = ?').get(req.params.id) as { total: number };

    return res.json({
      items: rows,
      total: totalRow.total,
      limit: page.limit,
      offset: page.offset,
      hasMore: page.offset + rows.length < totalRow.total,
    });
  } catch (err) {
    console.error('GET /:id/turns error:', err);
    return res.status(500).json({ error: '获取轮次列表时出错' });
  }
});

// ============================================================================
// GET /:id/turns/:turnIndex
// ============================================================================

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

// ============================================================================
// DELETE /:id
// ============================================================================

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

// ============================================================================
// POST /:id/translate — translate thinking / reply text to Chinese
// ============================================================================

export async function translateRequestText(
  text: string,
  callLLM: (prompt: string) => Promise<string> = callTranslationLLM,
): Promise<string> {
  return callLLM(text);
}

router.post('/:id/translate', async (req, res) => {
  try {
    const { text, turnIndex, stepIndex, sectionIndex } = req.body || {};
    if (typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'text 不能为空' });
    }
    if (typeof turnIndex !== 'number' || typeof stepIndex !== 'number' || typeof sectionIndex !== 'number') {
      return res.status(400).json({ error: 'turnIndex / stepIndex / sectionIndex 不能为空' });
    }

    const sessionId = req.params.id!;
    const db = getDb();

    // Check cache (skip when force=true)
    if (!req.body?.force) {
      const cached = db.prepare(
        'SELECT translated_text FROM turn_translations WHERE session_id = ? AND turn_index = ? AND step_index = ? AND section_index = ?'
      ).get(sessionId, turnIndex, stepIndex, sectionIndex) as { translated_text: string } | undefined;
      if (cached) return res.json({ translated: cached.translated_text });
    }

    let translated: string;
    try {
      translated = await translateRequestText(text);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ error: '翻译失败: ' + message });
    }

    db.prepare(
      'INSERT OR REPLACE INTO turn_translations (session_id, turn_index, step_index, section_index, translated_text) VALUES (?, ?, ?, ?, ?)'
    ).run(sessionId, turnIndex, stepIndex, sectionIndex, translated);

    return res.json({ translated });
  } catch (err) {
    console.error('POST /:id/translate error:', err);
    return res.status(500).json({ error: '翻译失败: ' + (err as Error).message });
  }
});

// GET /:id/translations/:turnIndex — load cached translations for a turn
router.get('/:id/translations/:turnIndex', (req, res) => {
  try {
    const { id: sessionId, turnIndex } = req.params;
    const db = getDb();
    const rows = db.prepare(
      'SELECT step_index, section_index, translated_text FROM turn_translations WHERE session_id = ? AND turn_index = ?'
    ).all(sessionId!, parseInt(turnIndex!, 10)) as Array<{ step_index: number; section_index: number; translated_text: string }>;

    const map: Record<number, Record<number, string>> = {};
    for (const r of rows) {
      if (!map[r.step_index]) map[r.step_index] = {};
      map[r.step_index]![r.section_index] = r.translated_text;
    }
    return res.json({ translations: map });
  } catch (err) {
    console.error('GET /:id/translations/:turnIndex error:', err);
    return res.status(500).json({ error: String(err) });
  }
});

export default router;
