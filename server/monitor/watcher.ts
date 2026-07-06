/**
 * watcher.ts — 活跃会话文件监控。
 *
 * 轮询 ~/.claude/projects/ 和 ~/.codex/sessions/ 下最近修改的 JSONL，
 * 返回当前会话的上下文摘要（复用现有 pipeline 解析）。
 *
 * ponytail: 轮询 3s，不做 FSEvents。简单可靠，够用。
 */

import { readFile } from 'fs/promises';
import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { runPipeline } from '../../shared/pipeline/index';

// ── 常量 ──────────────────────────────────────────────────────────────────────

const SCAN_ROOTS = [
  join(homedir(), '.claude', 'projects'),
  join(homedir(), '.codex', 'sessions'),
];

/** 最近多少分钟内修改的文件视为「活跃」 */
const ACTIVE_WINDOW_MINUTES = 30;

// ── 工具 ──────────────────────────────────────────────────────────────────────

/** 递归查找目录下所有 .jsonl 文件（同步，轮询中调用）。 */
function findJsonlFiles(dir: string, maxDepth = 3): string[] {
  if (!existsSync(dir)) return [];
  const result: string[] = [];
  try {
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith('.') || entry === 'subagents') continue;
      const full = join(dir, entry);
      try {
        const st = statSync(full);
        if (st.isDirectory() && maxDepth > 0) {
          result.push(...findJsonlFiles(full, maxDepth - 1));
        } else if (st.isFile() && entry.endsWith('.jsonl') && !entry.startsWith('agent-')) {
          result.push(full);
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return result;
}

/** 找到最近修改的活跃 JSONL 文件。 */
function findActiveSession(): { path: string; mtime: number } | null {
  let best: { path: string; mtime: number } | null = null;
  const cutoff = Date.now() - ACTIVE_WINDOW_MINUTES * 60_000;

  for (const root of SCAN_ROOTS) {
    for (const f of findJsonlFiles(root)) {
      try {
        const st = statSync(f);
        if (st.mtimeMs > cutoff && st.mtimeMs > (best?.mtime ?? 0)) {
          best = { path: f, mtime: st.mtimeMs };
        }
      } catch { /* skip */ }
    }
  }
  return best;
}

// ── 公开类型 ──────────────────────────────────────────────────────────────────

export interface MonitorSnapshot {
  /** 会话是否活跃 */
  active: boolean;
  /** JSONL 文件路径 */
  sessionPath: string | null;
  /** 最后修改时间 (ISO) */
  lastModified: string | null;
  /** 总轮次数 */
  turnCount: number;
  /** 当前累计上下文 (tokens) */
  contextTokens: number;
  /** 上下文窗口上限 (tokens) */
  contextLimit: number;
  /** 上下文使用率 (0-100) */
  contextPct: number;
  /** 最近一轮的 token 增量 */
  lastDelta: number;
  /** 最近 5 轮的 token 趋势（正=增长，负=压缩后减少） */
  recentTrend: number[];
  /** 是否刚发生压缩重置 */
  compressionReset: boolean;
  /** 当前活跃工具调用统计 */
  activeTools: Record<string, number>;
  /** 建议列表 */
  alerts: Alert[];
}

export interface Alert {
  level: 'info' | 'warn' | 'tip';
  message: string;
}

// ── 核心逻辑 ──────────────────────────────────────────────────────────────────

let cachedResult: MonitorSnapshot | null = null;
let cachedMtime: number | null = null;

/**
 * 获取当前活跃会话的监控快照。
 *
 * 找到最近修改的 JSONL → 完整解析 → 提取摘要。
 * 解析结果缓存到内存，只有文件 mtime 变化时才重新解析。
 */
export async function getSnapshot(): Promise<MonitorSnapshot> {
  const active = findActiveSession();

  if (!active) {
    cachedResult = null;
    cachedMtime = null;
    return emptySnapshot();
  }

  // 缓存命中：文件未变化
  if (cachedResult && cachedResult.sessionPath === active.path && cachedMtime === active.mtime) {
    return cachedResult;
  }

  try {
    const raw = await readFile(active.path, 'utf-8');
    const { turns, errors, summary } = runPipeline(raw, active.path);

    if (turns.length === 0) {
      cachedResult = null;
      cachedMtime = null;
      return emptySnapshot();
    }

    const lastTurn = turns[turns.length - 1]!;
    const recentTurns = turns.slice(-5);
    const trend = recentTurns.map((t) => t.cumTotal);

    const activeTools: Record<string, number> = {};
    for (const t of recentTurns) {
      for (const [name, count] of Object.entries(t.tools)) {
        activeTools[name] = (activeTools[name] ?? 0) + count;
      }
    }

    const contextLimit = summary.session.contextLimit;
    const contextTokens = lastTurn.cumTotal;
    const contextPct = contextLimit > 0 ? Math.round((contextTokens / contextLimit) * 100) : 0;

    const snapshot: MonitorSnapshot = {
      active: true,
      sessionPath: active.path,
      lastModified: new Date(active.mtime).toISOString(),
      turnCount: turns.length,
      contextTokens,
      contextLimit,
      contextPct,
      lastDelta: turns.length >= 2
        ? (turns[turns.length - 1]!.cumTotal - turns[turns.length - 2]!.cumTotal)
        : 0,
      recentTrend: trend,
      compressionReset: lastTurn.compressionReset ?? false,
      activeTools,
      alerts: generateAlerts(turns, contextPct),
    };

    cachedResult = snapshot;
    cachedMtime = active.mtime;
    return snapshot;
  } catch (err) {
    console.error('[monitor] 解析失败:', String(err));
    return emptySnapshot();
  }
}

function emptySnapshot(): MonitorSnapshot {
  return {
    active: false,
    sessionPath: null,
    lastModified: null,
    turnCount: 0,
    contextTokens: 0,
    contextLimit: 0,
    contextPct: 0,
    lastDelta: 0,
    recentTrend: [],
    compressionReset: false,
    activeTools: {},
    alerts: [{ level: 'info', message: '未检测到活跃会话。打开 Claude Code 或 Codex 开始监控。' }],
  };
}

// ── 建议规则引擎 ──────────────────────────────────────────────────────────────

function generateAlerts(turns: any[], contextPct: number): Alert[] {
  const alerts: Alert[] = [];

  // 上下文接近上限
  if (contextPct > 90) {
    alerts.push({ level: 'warn', message: `上下文已用 ${contextPct}%！建议立即总结关键结论写入 CLAUDE.md` });
  } else if (contextPct > 75) {
    alerts.push({ level: 'warn', message: `上下文 ${contextPct}%，接近压缩阈值。建议梳理当前进展。` });
  }

  // 最近是否发生压缩
  const lastTurn = turns[turns.length - 1];
  if (lastTurn?.compressionReset) {
    alerts.push({ level: 'info', message: '检测到上下文压缩重置。确认关键信息未丢失。' });
  }

  // 工具调用激增
  const last5 = turns.slice(-5);
  const toolCallCounts = last5.map((t: any) =>
    Object.values(t.tools as Record<string, number>).reduce((a, b) => a + b, 0)
  );
  const recentToolAvg = toolCallCounts.reduce((a: number, b: number) => a + b, 0) / toolCallCounts.length;
  if (recentToolAvg > 15) {
    alerts.push({ level: 'tip', message: '工具调用频繁，检查是否有循环操作可以合并。' });
  }

  // 缓存命中下降
  const cacheHits = last5.map((t: any) => t.cumCacheHit ?? 0);
  if (cacheHits.length >= 3) {
    const first = cacheHits.slice(0, 3).reduce((a: number, b: number) => a + b, 0) / 3;
    const last = cacheHits.slice(-3).reduce((a: number, b: number) => a + b, 0) / 3;
    if (first > 0 && last < first * 0.5) {
      alerts.push({ level: 'tip', message: '缓存命中率下降，可能上下文变化过大。' });
    }
  }

  return alerts;
}
