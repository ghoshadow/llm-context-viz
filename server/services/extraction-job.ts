import { getDb } from '../db';
import { sanitizeForLog } from '../utils/log-sanitizer.js';

// ============================================================================
// Types
// ============================================================================

export type ExtractPhase = 'idle' | 'extracting' | 'merging' | 'building' | 'complete' | 'error';

export interface ExtractShardStatus {
  index: number;
  status: 'pending' | 'running' | 'done' | 'error';
  candidates?: number;
  relations?: number;
  error?: string;
}

export interface ExtractJobStatus {
  sessionId: string;
  phase: ExtractPhase;
  rootDir: string | null;
  totalTurns: number;
  shardCount: number;
  shardsCompleted: number;
  shardDetails: ExtractShardStatus[];
  error: string | null;
  extractionDepth: 'refined' | 'deep';
  shardSize: number | null;
  maxShardChars: number | null;
  startedAt: string;
  updatedAt: string;
}

export interface OntologyShardMeta {
  index: number;
  turnRange: string;
  startTurn?: number;
  endTurn?: number;
}

// ============================================================================
// Job state (in-memory)
// ============================================================================

const extractJobs = new Map<string, ExtractJobStatus>();

export function getExtractJob(sessionId: string): ExtractJobStatus | undefined {
  return extractJobs.get(sessionId);
}

// ============================================================================
// Shard persistence
// ============================================================================

export function upsertOntologyShard(
  sessionId: string,
  data: Record<string, unknown>,
  status: 'done' | 'error',
  fallback?: OntologyShardMeta,
): void {
  try {
    const db = getDb();
    const shardIndex = typeof data.shardIndex === 'number' ? data.shardIndex : fallback?.index;
    if (typeof shardIndex !== 'number' || shardIndex < 0) return;
    const depth = data.extractionDepth === 'deep' ? 'deep' : 'refined';
    const turnRange = typeof data.turnRange === 'string' ? data.turnRange : fallback?.turnRange || '';
    const startTurn = typeof data.startTurn === 'number' ? data.startTurn : fallback?.startTurn ?? null;
    const endTurn = typeof data.endTurn === 'number' ? data.endTurn : fallback?.endTurn ?? null;
    const candidates = Array.isArray(data.candidates) ? data.candidates : null;
    const relations = Array.isArray(data.relations) ? data.relations : null;

    db.prepare(`
      INSERT INTO ontology_shards (
        session_id, shard_index, turn_range, start_turn, end_turn, status,
        phase_theme, candidates_json, relations_json, config_json, error,
        extraction_depth, shard_size, max_shard_chars, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(session_id, shard_index, extraction_depth) DO UPDATE SET
        turn_range = excluded.turn_range, start_turn = excluded.start_turn,
        end_turn = excluded.end_turn, status = excluded.status,
        phase_theme = excluded.phase_theme, candidates_json = excluded.candidates_json,
        relations_json = excluded.relations_json, config_json = excluded.config_json,
        error = excluded.error, shard_size = excluded.shard_size,
        max_shard_chars = excluded.max_shard_chars, updated_at = datetime('now')
    `).run(
      sessionId, shardIndex, turnRange, startTurn, endTurn, status,
      typeof data.phaseTheme === 'string' ? data.phaseTheme : null,
      candidates ? JSON.stringify(candidates) : null,
      relations ? JSON.stringify(relations) : null,
      data.config && typeof data.config === 'object' ? JSON.stringify(data.config) : null,
      typeof data.error === 'string' ? data.error : null,
      depth,
      typeof data.shardSize === 'number' ? data.shardSize : null,
      typeof data.maxShardChars === 'number' ? data.maxShardChars : null,
    );
  } catch (err) {
    console.error('[upsertOntologyShard] 持久化分片失败:', sanitizeForLog(err instanceof Error ? err.message : String(err)));
  }
}

// ============================================================================
// Shard cache (for resume / retry)
// ============================================================================

export function loadOntologyShardCache(
  sessionId: string,
  extractionDepth: 'refined' | 'deep',
  shardSize: number,
  maxShardChars: number,
): {
  previousShardResults: Array<{
    shardIndex: number; phaseTheme?: string;
    candidates: unknown[]; relations: unknown[]; config?: Record<string, unknown>;
  }>;
  failedShardIndices: number[];
} {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT shard_index, status, phase_theme, candidates_json, relations_json, config_json
      FROM ontology_shards
      WHERE session_id = ? AND extraction_depth = ?
        AND COALESCE(shard_size, -1) = COALESCE(?, -1)
        AND COALESCE(max_shard_chars, -1) = COALESCE(?, -1)
      ORDER BY shard_index ASC
    `).all(sessionId, extractionDepth, shardSize, maxShardChars) as Array<{
      shard_index: number; status: string;
      phase_theme: string | null; candidates_json: string | null;
      relations_json: string | null; config_json: string | null;
    }>;

    const previousShardResults = rows
      .filter((row) => row.status === 'done' && row.candidates_json && row.relations_json)
      .map((row) => ({
        shardIndex: row.shard_index,
        phaseTheme: row.phase_theme || undefined,
        candidates: JSON.parse(row.candidates_json || '[]'),
        relations: JSON.parse(row.relations_json || '[]'),
        config: row.config_json ? JSON.parse(row.config_json) : undefined,
      }));

    const failedShardIndices = rows.filter((row) => row.status === 'error').map((row) => row.shard_index);

    return { previousShardResults, failedShardIndices };
  } catch (err) {
    console.error('[loadOntologyShardCache] 加载分片缓存失败:', sanitizeForLog(err instanceof Error ? err.message : String(err)));
    return { previousShardResults: [], failedShardIndices: [] };
  }
}

function parseJsonArrayLength(raw: string | null): number | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.length : undefined;
  } catch { return undefined; }
}

// ============================================================================
// Progress recovery from DB (survives server restart)
// ============================================================================

export function loadOntologyShardProgress(sessionId: string): (Partial<ExtractJobStatus> & { active: false }) | null {
  try {
    const db = getDb();
    const latest = db.prepare(`
      SELECT extraction_depth, shard_size, max_shard_chars
      FROM ontology_shards WHERE session_id = ?
      ORDER BY updated_at DESC LIMIT 1
    `).get(sessionId) as { extraction_depth: 'refined' | 'deep'; shard_size: number | null; max_shard_chars: number | null } | undefined;

    if (!latest) return null;

    const rows = db.prepare(`
      SELECT shard_index, status, candidates_json, relations_json, error,
             extraction_depth, shard_size, max_shard_chars, updated_at
      FROM ontology_shards
      WHERE session_id = ? AND extraction_depth = ?
        AND COALESCE(shard_size, -1) = COALESCE(?, -1)
        AND COALESCE(max_shard_chars, -1) = COALESCE(?, -1)
      ORDER BY shard_index ASC
    `).all(sessionId, latest.extraction_depth, latest.shard_size, latest.max_shard_chars) as Array<{
      shard_index: number; status: string; candidates_json: string | null;
      relations_json: string | null; error: string | null;
      extraction_depth: 'refined' | 'deep'; shard_size: number | null;
      max_shard_chars: number | null; updated_at: string;
    }>;

    if (rows.length === 0) return null;

    const shardDetails = rows.map((row) => ({
      index: row.shard_index,
      status: row.status === 'done' ? 'done' as const : 'error' as const,
      candidates: parseJsonArrayLength(row.candidates_json),
      relations: parseJsonArrayLength(row.relations_json),
      error: row.error || undefined,
    }));
    const failed = shardDetails.filter((s) => s.status === 'error').length;

    return {
      active: false,
      phase: failed > 0 ? 'error' : 'complete',
      rootDir: null, totalTurns: 0,
      shardCount: shardDetails.length, shardsCompleted: shardDetails.length - failed,
      shardDetails,
      error: failed > 0 ? `有 ${failed} 个分片未完成，可只重跑失败分片` : null,
      extractionDepth: latest.extraction_depth,
      shardSize: rows[0]?.shard_size ?? null, maxShardChars: rows[0]?.max_shard_chars ?? null,
      updatedAt: rows[rows.length - 1]?.updated_at,
    };
  } catch (err) {
    console.error('[loadOntologyShardProgress] 加载进度失败:', sanitizeForLog(err instanceof Error ? err.message : String(err)));
    return null;
  }
}

// ============================================================================
// State machine
// ============================================================================

export function isExtractActive(job: ExtractJobStatus | undefined): boolean {
  return Boolean(job && job.phase !== 'complete' && job.phase !== 'error' && job.phase !== 'idle');
}

/**
 * Explicit state transition matrix for extraction job lifecycle.
 * Each event is only valid from specific phases. Events not listed here
 * are rejected with a warning logged and no state change.
 */
const VALID_TRANSITIONS: Readonly<Record<string, ReadonlySet<ExtractPhase>>> = (() => {
  const all = new Set<ExtractPhase>(['idle', 'extracting', 'merging', 'building', 'complete', 'error']);
  const working = new Set<ExtractPhase>(['idle', 'extracting']);
  const extractingOnly = new Set<ExtractPhase>(['extracting']);
  const extractingOrMerging = new Set<ExtractPhase>(['extracting', 'merging']);
  return Object.freeze({
    // Job initialization (no prior state) or start from idle
    extracted: new Set<ExtractPhase>(['idle', 'extracting']),
    start: working, // also valid from idle when creating a new job
    'shard-start': extractingOnly,
    'shard-retry': extractingOnly,
    'shard-done': extractingOnly,
    'shard-error': extractingOnly,
    merge: extractingOnly,
    build: extractingOrMerging,
    complete: new Set<ExtractPhase>(['extracting', 'merging', 'building']),
    error: all,
  });
})();

export function updateExtractJob(sessionId: string, event: string, data: Record<string, unknown>): ExtractJobStatus {
  try {
    const now = new Date().toISOString();
    let job = extractJobs.get(sessionId);

    // Validate event against current phase
    const allowedPhases = VALID_TRANSITIONS[event];
    if (allowedPhases) {
      const currentPhase = job?.phase ?? 'idle';
      if (!allowedPhases.has(currentPhase)) {
        console.warn(
          `[updateExtractJob] 忽略无效事件: 事件 "${event}" 在当前 phase "${currentPhase}" 不可用`,
        );
        return (
          job ?? {
            sessionId,
            phase: 'idle',
            rootDir: null,
            totalTurns: 0,
            shardCount: 0,
            shardsCompleted: 0,
            shardDetails: [],
            error: `事件 "${event}" 在当前阶段不可用`,
            extractionDepth: 'refined',
            shardSize: null,
            maxShardChars: null,
            startedAt: now,
            updatedAt: now,
          }
        );
      }
    }

    if (!job) {
      job = {
        sessionId, phase: 'extracting', rootDir: null, totalTurns: 0,
        shardCount: 0, shardsCompleted: 0, shardDetails: [], error: null,
        extractionDepth: 'refined', shardSize: null, maxShardChars: null,
        startedAt: now, updatedAt: now,
      };
      extractJobs.set(sessionId, job);
    }

    if (event === 'extracted') {
      const shards = (Array.isArray(data.shards) ? data.shards : []) as Array<{ index: number }>;
      job.phase = 'extracting';
      job.rootDir = typeof data.rootDir === 'string' ? data.rootDir : job.rootDir;
      job.totalTurns = typeof data.totalTurns === 'number' ? data.totalTurns : job.totalTurns;
      job.extractionDepth = data.extractionDepth === 'deep' ? 'deep' : 'refined';
      job.shardSize = typeof data.shardSize === 'number' ? data.shardSize : job.shardSize;
      job.maxShardChars = typeof data.maxShardChars === 'number' ? data.maxShardChars : job.maxShardChars;
      job.shardCount = typeof data.activeShards === 'number' ? data.activeShards
        : typeof data.shardCount === 'number' ? data.shardCount : job.shardCount;
      job.shardDetails = shards.map((s) => ({ index: s.index, status: 'pending' as const }));
      job.shardsCompleted = 0;
      job.error = null;
    } else if (event === 'start') {
      const shardCount = typeof data.shards === 'number' ? data.shards : job.shardCount;
      job.phase = 'extracting';
      job.totalTurns = typeof data.totalTurns === 'number' ? data.totalTurns : job.totalTurns;
      job.extractionDepth = data.extractionDepth === 'deep' ? 'deep' : job.extractionDepth;
      job.shardCount = shardCount;
      if (job.shardDetails.length === 0 || job.shardDetails.length !== shardCount) {
        job.shardDetails = Array.from({ length: shardCount }, (_, i) => ({ index: i, status: 'pending' as const }));
      }
      job.shardsCompleted = job.shardDetails.filter((s) => s.status === 'done').length;
    } else if (event === 'shard-start') {
      const idx = data.shardIndex as number;
      job.phase = 'extracting';
      job.shardDetails = job.shardDetails.map((s) => s.index === idx ? { ...s, status: 'running' as const } : s);
    } else if (event === 'shard-retry') {
      const idx = data.shardIndex as number;
      const attempt = typeof data.attempt === 'number' ? data.attempt : 2;
      job.phase = 'extracting';
      job.shardDetails = job.shardDetails.map((s) => s.index === idx
        ? { ...s, status: 'running' as const, error: `第 ${attempt} 次尝试` } : s);
    } else if (event === 'shard-done') {
      const idx = data.shardIndex as number;
      job.shardDetails = job.shardDetails.map((s) => s.index === idx
        ? { ...s, status: 'done' as const, error: undefined,
            candidates: Array.isArray(data.candidates) ? data.candidates.length : s.candidates,
            relations: Array.isArray(data.relations) ? data.relations.length : s.relations }
        : s);
      job.shardsCompleted = job.shardDetails.filter((s) => s.status === 'done').length;
    } else if (event === 'shard-error') {
      const idx = data.shardIndex as number;
      job.shardDetails = job.shardDetails.map((s) => s.index === idx
        ? { ...s, status: 'error' as const, error: typeof data.error === 'string' ? data.error : '失败' } : s);
    } else if (event === 'merge') {
      job.phase = 'merging';
    } else if (event === 'build') {
      job.phase = 'building';
    } else if (event === 'complete') {
      const failed = job.shardDetails.filter((s) => s.status === 'error').length;
      job.phase = failed > 0 ? 'error' : 'complete';
      job.error = failed > 0 ? `已保存部分结果，仍有 ${failed} 个分片未完成` : null;
    } else if (event === 'error') {
      job.phase = 'error';
      job.error = typeof data.message === 'string' ? data.message : '提取失败';
    }

    job.updatedAt = now;
    return job;
  } catch (err) {
    console.error('[updateExtractJob] 更新任务状态失败:', sanitizeForLog(err instanceof Error ? err.message : String(err)));
    // 返回一个安全的 fallback 状态
    return {
      sessionId,
      phase: 'error',
      rootDir: null,
      totalTurns: 0,
      shardCount: 0,
      shardsCompleted: 0,
      shardDetails: [],
      error: '任务状态更新异常: ' + (err instanceof Error ? err.message : String(err)),
      extractionDepth: 'refined',
      shardSize: null,
      maxShardChars: null,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
}
