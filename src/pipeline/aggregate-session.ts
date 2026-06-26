// ============================================================================
// Stage 5: Session-level aggregation
// ============================================================================

import type {
  ContextCategory,
  SessionSummary,
  SeriesPoint,
  ToolAggregation,
  TurnGroup,
} from '../types/session';
import type { TurnContextComposition } from './compute-context';
import type { TimelineResult } from './compute-timeline';
import { isTaskTool } from './utils';

// ============================================================================
// Session metadata extraction
// ============================================================================

/** Extract model, version, and cwd from the session transcript. */
function extractSessionMeta(
  groups: TurnGroup[],
): Pick<SessionSummary['session'], 'model' | 'version' | 'cwd'> & { gitBranch?: string } {
  let model = 'unknown';
  let version = 'unknown';
  let cwd = '';

  for (const group of groups) {
    // Extract cwd from the userLine (it's on every SessionLine)
    if (!cwd && group.userLine.cwd) {
      cwd = group.userLine.cwd;
    }
    // Extract model from assistant messages
    for (const line of group.asstLines) {
      if (model === 'unknown' && line.message.model) {
        model = line.message.model;
        const parts = model.split('-');
        version = parts[parts.length - 1] ?? '';
      }
    }
    if (model !== 'unknown' && cwd) break;
  }

  return { model, version, cwd, gitBranch: undefined };
}

// ============================================================================
// Category labels and groups
// ============================================================================

const CATEGORY_META: Record<string, { label: string; group: ContextCategory['group'] }> = {
  sysPrompt:    { label: '系统提示',          group: 'core' },
  tool_defs:    { label: '工具定义',          group: 'core' },
  skills:       { label: '技能定义',          group: 'core' },
  memory:       { label: '记忆文件',          group: 'core' },
  mcp:          { label: 'MCP 配置',          group: 'core' },
  reminders:    { label: '周期提醒',          group: 'core' },
  thinking:     { label: '思考过程',          group: 'io' },
  asstText:     { label: '助手输出',          group: 'io' },
  toolCalls:    { label: '工具调用',          group: 'io' },
  toolResults:  { label: '工具结果',          group: 'io' },
  userMsgs:     { label: '用户消息',          group: 'convo' },
  subagent:     { label: '子代理',            group: 'convo' },
};

const ESTIMATED_KEYS = new Set(['sysPrompt', 'tool_defs', 'skills', 'memory', 'mcp', 'reminders']);

// ============================================================================
// Main aggregation function
// ============================================================================

/**
 * Aggregate per-turn data into a session-level summary.
 *
 * @param groups       Turn groups (stage 1 output) — contains all raw lines.
 * @param compositions Per-turn context compositions (stage 2/3 output).
 * @param timelines    Per-turn timeline results (stage 4 output) — has cumTotal, comp, etc.
 * @param filename     Source filename for logging / provenance.
 */
export function aggregateSession(
  groups: TurnGroup[],
  compositions: TurnContextComposition[],
  timelines: TimelineResult[],
  filename: string,
): SessionSummary {
  // --- 1. Session-level metadata ---

  const meta = extractSessionMeta(groups);

  // Total requests: count assistant lines with usage data
  let totalRequests = 0;
  let totalOutput = 0;
  for (const group of groups) {
    for (const line of group.asstLines) {
      if (line.message.usage) {
        totalRequests++;
        totalOutput += line.message.usage.output_tokens;
      }
    }
  }

  // Find peak: the request with the largest total context (billed + cached)
  let peakIndex = 0;
  let peakTurnIdx = 0;
  let peakStep = 0;
  let peakTokens = 0;
  let peakCacheHit = 0;
  let reqCount = 0;
  for (let t = 0; t < groups.length && t < timelines.length; t++) {
    const group = groups[t]!;
    for (const line of group.asstLines) {
      if (!line.message.usage) continue;
      const billed = line.message.usage.input_tokens;
      if (billed > peakTokens) {
        peakTokens = billed;
        peakCacheHit = line.message.usage.cache_read_input_tokens ?? 0;
        peakIndex = reqCount;
        peakTurnIdx = t;
        // Find step index in this turn's timeline for this assistant line
        const tl = timelines[t]!;
        const segs = tl.segs ?? [];
        let si = 0;
        for (const seg of segs) {
          if (seg.ts === line.timestamp) { peakStep = si; break; }
          si++;
        }
      }
      reqCount++;
    }
  }

  // Determine context window from model name
  const MODEL_WINDOWS: Record<string, number> = {
    'claude-sonnet': 200_000,
    'claude-opus': 200_000,
    'claude-haiku': 200_000,
    'deepseek-v4': 1_000_000,
    'deepseek-v3': 128_000,
    'deepseek-r1': 128_000,
  };
  let contextLimit = 200_000;
  const modelLower = meta.model.toLowerCase();
  for (const [prefix, limit] of Object.entries(MODEL_WINDOWS)) {
    if (modelLower.includes(prefix)) { contextLimit = limit; break; }
  }

  // --- 2. Categories from peak composition ---

  const peakTimeline = timelines[peakTurnIdx]!;
  const categories: ContextCategory[] = [];

  if (peakTimeline) {
    for (const key of Object.keys(peakTimeline.comp)) {
      const tokens = peakTimeline.comp[key]!;
      const raw = 0; // raw char count not tracked at this stage
      const meta = CATEGORY_META[key] ?? { label: key, group: 'convo' as const };
      const estimated = ESTIMATED_KEYS.has(key);

      categories.push({
        key,
        label: meta.label,
        group: meta.group,
        estimated,
        tokens: Math.round(tokens),
        raw,
      });
    }
  }

  // Sort by tokens descending
  categories.sort((a, b) => b.tokens - a.tokens);

  // --- 3. Series: one point per API request ---

  const series: SeriesPoint[] = [];
  let reqIdx = 0;
  let runningOutput = 0;

  for (let t = 0; t < groups.length && t < timelines.length; t++) {
    const group = groups[t]!;
    const tl = timelines[t]!;
    runningOutput += tl.outTok;

    for (const line of group.asstLines) {
      if (!line.message.usage) continue;
      const inTok = line.message.usage.input_tokens;
      const outTok = line.message.usage.output_tokens;

      series.push({
        i: reqIdx,
        assembled: Math.round(tl.cumTotal),       // cumulative assembled
        input: Math.round(inTok),                  // per-request billed input
        output: Math.round(outTok),                // per-request output
      });
      reqIdx++;
    }
  }

  // --- 4. Tool aggregation ---

  const toolMap = new Map<string, { calls: number; resultTokens: number }>();

  // Count tool_use blocks across all assistant lines
  for (const group of groups) {
    for (const line of group.asstLines) {
      if (!line.message.content) continue;
      for (const block of line.message.content) {
        if (block.type === 'tool_use') {
          const existing = toolMap.get(block.name) ?? { calls: 0, resultTokens: 0 };
          existing.calls++;
          toolMap.set(block.name, existing);
        }
      }
    }
  }

  // Accumulate tool result tokens from user lines (tool_result content blocks)
  for (const group of groups) {
    // Check both the main user message and any tool-result follow-ups
    const allUserLines = [group.userLine, ...(group.toolResultLines ?? [])];
    for (const userLine of allUserLines) {
      const userContent = userLine.message.content;
      if (typeof userContent === 'string') continue;

      for (const block of userContent) {
        if (block.type === 'tool_result') {
        // Find which tool this result belongs to by looking at tool_use IDs
        const toolUseId = block.tool_use_id;
        for (const line of group.asstLines) {
          if (!line.message.content) continue;
          for (const c of line.message.content) {
            if (c.type === 'tool_use' && c.id === toolUseId) {
              const existing = toolMap.get(c.name);
              if (existing) {
                const resultStr = typeof block.content === 'string'
                  ? block.content
                  : JSON.stringify(block.content);
                // Estimate tokens: characters / 4
                existing.resultTokens += Math.round(resultStr.length / 4);
              }
              break;
            }
          }
        }
      }
    }
    }
  }

  const tools: ToolAggregation[] = [];
  for (const [name, data] of toolMap) {
    tools.push({
      name,
      calls: data.calls,
      resultTokens: data.resultTokens,
      task: isTaskTool(name),
    });
  }

  // Sort by calls descending
  tools.sort((a, b) => b.calls - a.calls);

  return {
    session: {
      model: meta.model,
      version: meta.version,
      cwd: meta.cwd,
      requests: totalRequests,
      peakIndex,
      peakTokens,
      peakCacheHit,
      peakTurnIdx,
      peakStep,
      totalOutput,
      contextLimit,
    },
    categories,
    series,
    tools,
  };
}
