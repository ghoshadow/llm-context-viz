/**
 * sub-agent-enricher.ts — 子代理日志分析服务。
 *
 * 从会话目录的 subagents/ 子目录中读取子代理日志，
 * 将子代理信息附加到 turn 结构的对应 segment 上。
 *
 * 原实现位于 server/routes/scanner.ts:339-464，迁移至此。
 */

import { existsSync, readdirSync, statSync, readFileSync } from 'fs';
import { join } from 'path';
import { sanitizeForLog } from '../utils/log-sanitizer.js';
import type { TurnData, TimelineSegment } from '../../shared/types/session';

/** 从原始日志中提取的子代理信息 */
export interface SubAgentInfo {
  file: string;
  model: string;
  prompt: string;
  asstCount: number;
  durMs: number;
  toolCalls: string[];
  firstTs: string;
  lastTs: string;
}

/**
 * 递归收集目录下所有 .jsonl 文件。
 * 文件列表不排序——调用方根据时间戳自行匹配。
 */
function collectJsonlFiles(dir: string, maxDepth: number): string[] {
  const result: string[] = [];

  function collect(currentDir: string, depth: number) {
    if (depth > maxDepth) return;
    try {
      for (const entry of readdirSync(currentDir)) {
        const full = join(currentDir, entry);
        try {
          const st = statSync(full);
          if (st.isDirectory() && !entry.startsWith('.')) {
            collect(full, depth + 1);
          } else if (st.isFile() && entry.endsWith('.jsonl')) {
            result.push(full);
          }
        } catch { /* skip inaccessible entries */ }
      }
    } catch { /* skip inaccessible directories */ }
  }

  collect(dir, 0);
  return result;
}

/** 从单个 .jsonl 文件提取子代理摘要信息。 */
function parseSubAgentFile(filePath: string): SubAgentInfo {
  const raw = readFileSync(filePath, 'utf-8');
  const lines = raw.split('\n').filter((l) => l.trim());
  let model = '';
  let firstPrompt = '';
  let asstCount = 0;
  let firstTs = '';
  let lastTs = '';
  const toolCalls: string[] = [];

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      const ts = obj.timestamp;
      if (ts) {
        if (!firstTs) firstTs = ts;
        lastTs = ts;
      }
      if (obj.type === 'assistant') {
        asstCount++;
        if (!model && obj.message?.model) model = obj.message.model;
        for (const b of obj.message?.content ?? []) {
          if (b.type === 'tool_use' && toolCalls.length < 5) {
            if (!toolCalls.includes(b.name)) toolCalls.push(b.name);
          }
        }
      }
      if (obj.type === 'user' && !obj.isSidechain && !firstPrompt) {
        const c = obj.message?.content;
        firstPrompt = typeof c === 'string' ? c.slice(0, 120) : '';
      }
    } catch { /* skip malformed JSON lines */ }
  }

  let dur = 0;
  if (firstTs && lastTs) {
    dur = Math.max(0, new Date(lastTs).getTime() - new Date(firstTs).getTime());
  }

  return { file: filePath, model, prompt: firstPrompt, asstCount, durMs: dur, toolCalls, firstTs, lastTs };
}

/**
 * 从会话目录中读取子代理日志并将信息附加到 turns 结构上。
 *
 * 匹配逻辑：
 * 1. 子代理日志分两类：workflows/ 子目录下的为 workflow agent，
 *    其他为 direct agent。
 * 2. workflow agent 附加到每个 turn 的最后一个 Workflow segment 上。
 * 3. direct agent 按其 firstTs 匹配到对应 turn 的最后一个
 *    发生在该子代理启动前的 Agent 调用 segment 上。
 */
export function enrichWithSubAgents(turns: TurnData[], sessDir: string) {
  const subDir = join(sessDir, 'subagents');
  if (!existsSync(subDir)) return;

  const subFiles = collectJsonlFiles(subDir, 3);
  if (subFiles.length === 0) return;

  const subAgents: SubAgentInfo[] = [];
  for (const f of subFiles) {
    try {
      subAgents.push(parseSubAgentFile(f));
    } catch {
      console.error('[enrichWithSubAgents] 无法读取子代理文件:', sanitizeForLog(f));
    }
  }

  if (subAgents.length === 0) return;

  // Separate workflow sub-agents (in subagents/workflows/) from direct ones
  const workflowAgents = subAgents.filter((sa) => sa.file.includes('/workflows/'));
  const directAgents = subAgents.filter((sa) => !sa.file.includes('/workflows/'));

  for (const turn of turns) {
    // Workflow sub-agents -> attach to the LAST Workflow segment in the turn
    if (workflowAgents.length > 0) {
      let lastWfSeg: TimelineSegment | null = null;
      for (const seg of turn.segs ?? []) {
        if (seg.k === 's' && seg.n === 'Workflow') lastWfSeg = seg;
      }
      if (lastWfSeg?.det) {
        lastWfSeg.det.subAgents = workflowAgents;
      }
    }

    // Direct sub-agents -> match each to the LAST Agent call that
    // happened before the sub-agent started.
    if (directAgents.length > 0) {
      const agentCalls: { seg: TimelineSegment; callMs: number }[] = [];
      for (let si = 0; si < (turn.segs ?? []).length; si++) {
        const seg = turn.segs![si]!;
        if (seg.k !== 's') continue;
        let callMs = new Date(seg.ts).getTime();
        for (let j = si - 1; j >= 0; j--) {
          if (turn.segs![j]!.k === 'm') {
            callMs = new Date(turn.segs![j]!.ts).getTime();
            break;
          }
        }
        agentCalls.push({ seg, callMs });
      }

      const turnIdx = turns.indexOf(turn);
      const turnStartMs = new Date(turn.ts).getTime();
      const turnEndMs = turnIdx + 1 < turns.length
        ? new Date(turns[turnIdx + 1]!.ts).getTime()
        : Infinity;

      for (const sa of directAgents) {
        if (!sa.firstTs) continue;
        const saMs = new Date(sa.firstTs).getTime();
        if (saMs < turnStartMs || saMs >= turnEndMs) continue;

        let best: { seg: TimelineSegment; callMs: number } | null = null;
        for (const ac of agentCalls) {
          if (ac.callMs <= saMs) {
            if (!best || ac.callMs > best.callMs) {
              best = ac;
            }
          }
        }

        if (best?.seg.det) {
          if (!best.seg.det.subAgents) best.seg.det.subAgents = [];
          best.seg.det.subAgents.push(sa);
        }
      }
    }
  }
}
