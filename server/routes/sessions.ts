import { Router } from 'express';
import { refreshSession } from '../services/pipeline-service';
import { callTranslationLLM } from '../llm/translation-client';
import { enrichWithSubAgents } from './scanner';
import { readFile } from 'fs/promises';
import { getSessionSource } from '../../shared/session-source';

import { findJsonlFile } from './shared';
import ontologyRouter from './ontology';
import type { SessionSource } from '../../shared/session-source';
import { validateBody, TranslateRequestSchema } from '../middleware/validate.js';
import { sanitizeForLog } from '../utils/log-sanitizer.js';
import {
  getAllSessions,
  getSessionById,
  deleteSession,
  getSessionTurns,
  getTurnCount,
  getTurnByIndex,
  getSessionBrief,
  getSessionForRefresh,
  getCachedTranslation,
  upsertTurnTranslation,
  getProjectConstantTranslation,
  upsertProjectConstantTranslation,
  getTurnTranslations,
  getProjectConstantTranslationBatch,
} from '../repositories/session-repository';

const router = Router();

export interface TurnListPagination {
  all: boolean;
  limit: number | null;
  offset: number;
}

const DEFAULT_TURN_LIMIT = 200;
const MAX_TURN_LIMIT = 500;

function firstQueryValue(value: unknown): string | undefined {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : undefined;
  return typeof value === 'string' ? value : undefined;
}

function parseNonNegativeInt(value: unknown, fallback: number): number {
  const raw = firstQueryValue(value);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function parseTurnListPagination(query: Record<string, unknown>): TurnListPagination {
  if (firstQueryValue(query.all) === '1') {
    return { all: true, limit: null, offset: 0 };
  }

  const requestedLimit = parseNonNegativeInt(query.limit, DEFAULT_TURN_LIMIT);
  return {
    all: false,
    limit: Math.min(Math.max(requestedLimit, 1), MAX_TURN_LIMIT),
    offset: parseNonNegativeInt(query.offset, 0),
  };
}

// ============================================================================
// Mount ontology sub-router
// ============================================================================

router.use('/:id/ontology', ontologyRouter);

// ============================================================================
// GET /
// ============================================================================

router.get('/', (_req, res) => {
  try {
    const rows = getAllSessions();
    return res.json(rows.map((row) => ({ ...row, source: getSessionSource(row) })));
  } catch (err) {
    console.error('GET / error:', sanitizeForLog(err instanceof Error ? err.message : String(err)));
    return res.status(500).json({ error: '获取会话列表时出错' });
  }
});

// ============================================================================
// GET /:id
// ============================================================================

router.get('/:id', (req, res) => {
  try {
    const row = getSessionById(req.params.id);

    if (!row) {
      return res.status(404).json({ error: '会话不存在' });
    }

    // Parse JSON string columns back to objects
    const {
      categories_json,
      tools_json,
      series_json,
      ...rest
    } = row;

    const detail = {
      ...rest,
      source: getSessionSource(rest),
      categories: categories_json ? JSON.parse(categories_json) : [],
      tools: tools_json ? JSON.parse(tools_json) : [],
      series: series_json ? JSON.parse(series_json) : [],
    };

    return res.json(detail);
  } catch (err) {
    console.error('GET /:id error:', sanitizeForLog(err instanceof Error ? err.message : String(err)));
    return res.status(500).json({ error: '获取会话详情时出错' });
  }
});

// ============================================================================
// POST /:id/refresh — re-parse the original JSONL and update DB turns
// ============================================================================

router.post('/:id/refresh', async (req, res) => {
  try {
    const session = getSessionForRefresh(req.params.id);
    if (!session) return res.status(404).json({ error: '会话不存在' });

    let content: string;
    let sessDir: string;
    const filePath = await findJsonlFile(session.filename);
    if (filePath) {
      content = await readFile(filePath, 'utf-8');
      sessDir = filePath.replace(/\.jsonl$/, '');
    } else if (session.raw_jsonl) {
      content = session.raw_jsonl;
      sessDir = ''; // sub-agents not available for uploaded sessions
    } else {
      return res.status(404).json({ error: '找不到原始 JSONL 数据' });
    }

    const { turns } = await refreshSession({
      sessionId: session.id,
      jsonlContent: content,
      filename: session.filename,
      source: getSessionSource(session),
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
    const page = parseTurnListPagination(req.query);
    const rows = page.all
      ? getSessionTurns(req.params.id)
      : getSessionTurns(req.params.id, { limit: page.limit, offset: page.offset });

    if (page.all) return res.json(rows);

    const total = getTurnCount(req.params.id);

    return res.json({
      items: rows,
      total,
      limit: page.limit,
      offset: page.offset,
      hasMore: page.offset + rows.length < total,
    });
  } catch (err) {
    console.error('GET /:id/turns error:', sanitizeForLog(err instanceof Error ? err.message : String(err)));
    return res.status(500).json({ error: '获取轮次列表时出错' });
  }
});

// ============================================================================
// GET /:id/turns/:turnIndex
// ============================================================================

router.get('/:id/turns/:turnIndex', (req, res) => {
  try {
    const turnIndex = parseInt(req.params.turnIndex, 10);
    if (isNaN(turnIndex)) {
      return res.status(400).json({ error: '无效的轮次索引' });
    }

    const row = getTurnByIndex(req.params.id, turnIndex);

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
    } = row;

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
    console.error('GET /:id/turns/:turnIndex error:', sanitizeForLog(err instanceof Error ? err.message : String(err)));
    return res.status(500).json({ error: '获取轮次详情时出错' });
  }
});

// ============================================================================
// DELETE /:id
// ============================================================================

router.delete('/:id', (req, res) => {
  try {
    const changes = deleteSession(req.params.id);

    if (changes === 0) {
      return res.status(404).json({ error: '会话不存在' });
    }

    return res.status(204).send();
  } catch (err) {
    console.error('DELETE /:id error:', sanitizeForLog(err instanceof Error ? err.message : String(err)));
    return res.status(500).json({ error: '删除会话时出错' });
  }
});

// ============================================================================
// POST /:id/translate — translate thinking / reply text to Chinese
// ============================================================================

/**
 * 进行中的翻译请求映射表，按 (text, targetLang) 去重。
 * 相同文本同时只发送一次翻译请求，其他请求复用已存在的 Promise。
 */
const inFlightTranslations = new Map<string, Promise<string>>();

function translationKey(text: string): string {
  // 使用完整文本作为去重键。翻译请求量小（每 turn 一次），Map Key 中存完整文本不会造成显著内存压力
  // （最多几十个 in-flight 请求），相比前 200 字符截断的错误缓存风险，完整 Key 更为安全。
  return text;
}

export async function translateRequestText(
  text: string,
  callLLM: (prompt: string) => Promise<string> = callTranslationLLM,
): Promise<string> {
  const key = translationKey(text);

  // 复用已存在的进行中请求
  const existing = inFlightTranslations.get(key);
  if (existing) {
    return existing;
  }

  const promise = (async () => {
    try {
      return await callLLM(text);
    } finally {
      inFlightTranslations.delete(key);
    }
  })();

  inFlightTranslations.set(key, promise);
  return promise;
}

export function isConstantTranslationSlot(stepIndex: number): boolean {
  return stepIndex === -100;
}

export function normalizeTranslationProjectKey(
  cwd: string,
  source: SessionSource | string,
): { project_cwd: string; source: string } {
  return {
    project_cwd: cwd.replace(/\/+$/, ''),
    source: String(source || 'claude'),
  };
}

export function parseConstantTranslationSections(value: unknown): number[] {
  const rawValues = Array.isArray(value) ? value : [value];
  const sections = new Set<number>();
  for (const raw of rawValues) {
    if (typeof raw !== 'string') continue;
    for (const part of raw.split(',')) {
      const parsed = Number.parseInt(part.trim(), 10);
      if (Number.isFinite(parsed)) sections.add(parsed);
    }
  }
  return [...sections];
}

router.post('/:id/translate', validateBody(TranslateRequestSchema), async (req, res) => {
  try {
    const { text, turnIndex, stepIndex, sectionIndex, force } = req.body as {
      text: string;
      turnIndex: number;
      stepIndex: number;
      sectionIndex: number;
      force?: boolean;
    };

    const sessionId = String(req.params.id);
    const session = getSessionBrief(sessionId);
    const projectKey = session?.cwd && isConstantTranslationSlot(stepIndex)
      ? normalizeTranslationProjectKey(session.cwd, getSessionSource(session))
      : null;

    if (!session) {
      return res.status(404).json({ error: '会话不存在' });
    }

    // Check cache (skip when force=true)
    if (!force) {
      if (projectKey) {
        const projectCached = getProjectConstantTranslation(projectKey.project_cwd, projectKey.source, sectionIndex);
        if (projectCached) {
          upsertTurnTranslation(sessionId, turnIndex, stepIndex, sectionIndex, projectCached.translated_text);
          return res.json({ translated: projectCached.translated_text });
        }
      }

      const cached = getCachedTranslation(sessionId, turnIndex, stepIndex, sectionIndex);
      if (cached) return res.json({ translated: cached.translated_text });
    }

    let translated: string;
    try {
      translated = await translateRequestText(text);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ error: '翻译失败: ' + message });
    }

    upsertTurnTranslation(sessionId, turnIndex, stepIndex, sectionIndex, translated);
    if (projectKey) {
      upsertProjectConstantTranslation(projectKey.project_cwd, projectKey.source, sectionIndex, translated);
    }

    return res.json({ translated });
  } catch (err) {
    console.error('POST /:id/translate error:', sanitizeForLog(err instanceof Error ? err.message : String(err)));
    return res.status(500).json({ error: '翻译失败: ' + (err as Error).message });
  }
});

// GET /:id/translations/:turnIndex — load cached translations for a turn
router.get('/:id/translations/:turnIndex', (req, res) => {
  try {
    const { id: sessionId, turnIndex } = req.params;
    const session = getSessionBrief(sessionId);
    const rows = getTurnTranslations(sessionId, parseInt(turnIndex!, 10));

    const map: Record<number, Record<number, string>> = {};
    for (const r of rows) {
      if (!map[r.step_index]) map[r.step_index] = {};
      map[r.step_index]![r.section_index] = r.translated_text;
    }

    const constantSections = parseConstantTranslationSections(req.query.constantSections);
    if (session?.cwd && constantSections.length > 0) {
      const projectKey = normalizeTranslationProjectKey(session.cwd, getSessionSource(session));
      const cachedRows = getProjectConstantTranslationBatch(
        projectKey.project_cwd,
        projectKey.source,
        constantSections,
      );
      for (const cached of cachedRows) {
        if (map[-100]?.[cached.section_index]) continue;
        if (!map[-100]) map[-100] = {};
        map[-100][cached.section_index] = cached.translated_text;
        upsertTurnTranslation(sessionId, parseInt(turnIndex!, 10), -100, cached.section_index, cached.translated_text);
      }
    }

    return res.json({ translations: map });
  } catch (err) {
    console.error('GET /:id/translations/:turnIndex error:', sanitizeForLog(err instanceof Error ? err.message : String(err)));
    return res.status(500).json({ error: String(err) });
  }
});

export default router;
