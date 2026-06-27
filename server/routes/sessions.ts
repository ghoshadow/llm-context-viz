import { Router } from 'express';
import { getDb } from '../db';
import { callTranslationLLM } from '../llm/translation-client';
import { refreshSession } from '../services/pipeline-service';
import { reassembleTranslatedSegments } from '../services/translation-reassembly';
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

/** Split text into segments, separating Chinese from non-Chinese content.
 *  Code blocks are preserved as-is. Uses a simple scanner to avoid regex
 *  catastrophic backtracking on large inputs. */
function segmentForTranslation(text: string): Array<{ zh: boolean; text: string }> {
  const segments: Array<{ zh: boolean; text: string }> = [];
  let i = 0;
  const len = text.length;

  while (i < len) {
    // Detect ```...``` code fences
    if (text.startsWith('```', i)) {
      const end = text.indexOf('```', i + 3);
      if (end === -1) {
        // Unclosed fence — treat the rest as code
        segments.push({ zh: true, text: text.slice(i) });
        break;
      }
      // Include the closing ``` and following newline if present
      const close = text[end + 3] === '\n' ? end + 4 : end + 3;
      segments.push({ zh: true, text: text.slice(i, close) });
      i = close;
      continue;
    }

    // Detect inline `...` code spans (single line only)
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1);
      if (end !== -1 && text.slice(i + 1, end).indexOf('\n') === -1) {
        segments.push({ zh: true, text: text.slice(i, end + 1) });
        i = end + 1;
        continue;
      }
    }

    // Scan ahead: split by Chinese / non-Chinese runs
    // Find the next Chinese character or non-Chinese character boundary
    const isZh = isCJK(text.charCodeAt(i));
    let j = i + 1;
    while (j < len && isCJK(text.charCodeAt(j)) === isZh && text[j] !== '`') {
      j++;
    }
    const chunk = text.slice(i, j);
    if (chunk.trim()) {
      segments.push({ zh: isZh, text: chunk });
    } else {
      // Whitespace-only — include as-is
      segments.push({ zh: true, text: chunk });
    }
    i = j;
  }
  return segments;
}

function isCJK(code: number): boolean {
  return (code >= 0x4E00 && code <= 0x9FFF)   // CJK Unified
      || (code >= 0x3400 && code <= 0x4DBF)   // CJK Extension A
      || (code >= 0x20000 && code <= 0x2A6DF) // CJK Extension B
      || (code >= 0xF900 && code <= 0xFAFF)   // CJK Compatibility
      || (code >= 0x3000 && code <= 0x303F)   // CJK Punctuation
      || (code >= 0xFF00 && code <= 0xFFEF)   // Fullwidth forms
      || (code >= 0x2F800 && code <= 0x2FA1F); // CJK Compatibility Supplement
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

    const segments = segmentForTranslation(text);
    const toTranslate: string[] = [];
    for (const seg of segments) {
      if (!seg.zh) toTranslate.push(seg.text);
    }

    if (toTranslate.length === 0) {
      db.prepare(
        'INSERT OR REPLACE INTO turn_translations (session_id, turn_index, step_index, section_index, translated_text) VALUES (?, ?, ?, ?, ?)'
      ).run(sessionId, turnIndex, stepIndex, sectionIndex, text);
      return res.json({ translated: text });
    }

    // Build a numbered list of segments to translate
    const items = toTranslate.map((t, i) => `[${i}] ${t}`).join('\n%%%\n');
    const prompt = `请将以下 ${toTranslate.length} 段非中文内容逐段翻译为中文。
要求：
- 每段翻译保持编号 [N] 标记
- 段之间用 %%% 分隔
- 代码、命令、文件名、URL、技术术语等保留原文不翻译
- 只输出翻译结果，不要解释

${items}`;

    let response: string;
    try {
      response = await callTranslationLLM(prompt);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ error: '翻译失败: ' + message });
    }

    if (!response) return res.status(500).json({ error: '翻译失败: LLM 未返回翻译结果' });

    // Parse numbered segments — line-based, using %%% as segment delimiter.
    // [N] markers are only recognized after a %%% separator (or at the start),
    // never inside a segment's content.
    const translatedMap = new Map<number, string>();
    const lines = response.split('\n');
    let currentIdx: number | null = null;
    let currentLines: string[] = [];
    for (const line of lines) {
      const marker = currentIdx === null ? /^\[(\d+)\]\s*/.exec(line) : null;
      if (marker) {
        if (currentIdx !== null && currentLines.length > 0) {
          translatedMap.set(currentIdx, currentLines.join('\n').trim());
        }
        currentIdx = parseInt(marker[1]!, 10);
        currentLines = [line.slice(marker[0].length)];
      } else if (line.trim() === '%%%') {
        if (currentIdx !== null && currentLines.length > 0) {
          translatedMap.set(currentIdx, currentLines.join('\n').trim());
          currentIdx = null;
          currentLines = [];
        }
      } else if (currentIdx !== null) {
        currentLines.push(line);
      }
    }
    if (currentIdx !== null && currentLines.length > 0) {
      translatedMap.set(currentIdx, currentLines.join('\n').trim());
    }

    // Fallback: if parsing fails, use the raw response as a single translation
    if (translatedMap.size === 0 && toTranslate.length === 1) {
      translatedMap.set(0, response);
    }

    const translated = reassembleTranslatedSegments(
      segments,
      toTranslate.map((source, index) => translatedMap.get(index) ?? source),
    );
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
