import type { ContextCategory, SeriesPoint, SessionSummary, TimelineSegment, ToolAggregation, TurnData, TurnDelta } from '../types/session';
import { isObject, msBetween, stringifyInput } from './codex-jsonl-parser';
import { CATEGORY_META, addTokenCount, addTokens, cloneTools, deltaBetween, initComp, sumComp } from './codex-jsonl-summary';
import type { ParseError } from './parse-jsonl';
import { detectSessionFormat } from './session-format';
import { roundTokens } from './utils';

interface PiLine {
  order: number;
  type: string;
  timestamp: string;
  raw: Record<string, unknown>;
}

interface PiTurn {
  startTs: string;
  endTs: string;
  prompt: string;
  segments: TimelineSegment[];
  tools: Record<string, number>;
  asstReqs: number;
  compressionReset: boolean;
}

interface ToolState {
  calls: number;
  resultTokens: number;
  task: boolean;
}

export function runPiPipeline(
  jsonlText: string,
  filename: string,
): {
  summary: SessionSummary;
  turns: TurnData[];
  errors: ParseError[];
} {
  const { lines, errors } = parsePiLines(jsonlText);
  const format = detectSessionFormat(jsonlText);
  const rawTurns = format === 'pi-event-stream'
    ? buildPiEventTurns(lines, filename)
    : buildPiSessionTurns(lines, filename);
  const turns = assemblePiTurns(rawTurns);
  const summary = aggregatePiSession(lines, turns, filename);
  return { summary, turns, errors };
}

function parsePiLines(text: string): { lines: PiLine[]; errors: ParseError[] } {
  const lines: PiLine[] = [];
  const errors: ParseError[] = [];

  text.split('\n').forEach((raw, idx) => {
    if (!raw.trim()) return;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!isObject(parsed) || typeof parsed.type !== 'string') {
        errors.push({ line: idx + 1, message: 'Pi line missing type' });
        return;
      }
      lines.push({
        order: idx,
        type: parsed.type,
        timestamp: piLineTimestamp(parsed),
        raw: parsed,
      });
    } catch {
      errors.push({ line: idx + 1, message: 'Invalid JSON: could not parse line' });
    }
  });

  return { lines, errors };
}

function buildPiSessionTurns(lines: PiLine[], filename: string): PiTurn[] {
  const branch = selectMainBranch(lines);
  const turns: PiTurn[] = [];
  let current: PiTurn | null = null;

  function ensureTurn(line: PiLine): PiTurn {
    if (!current) {
      current = {
        startTs: line.timestamp,
        endTs: line.timestamp,
        prompt: `Pi session: ${filename}`,
        segments: [],
        tools: {},
        asstReqs: 0,
        compressionReset: false,
      };
      turns.push(current);
    }
    return current;
  }

  function flushForUser(line: PiLine, prompt: string): PiTurn {
    current = {
      startTs: line.timestamp,
      endTs: line.timestamp,
      prompt,
      segments: [],
      tools: {},
      asstReqs: 0,
      compressionReset: false,
    };
    turns.push(current);
    return current;
  }

  for (const line of branch) {
    if (line.type === 'message') {
      const message = messageObject(line.raw);
      const role = stringValue(message.role);
      const text = textFromContent(message.content);
      if (role === 'user') {
        flushForUser(line, text || `Pi session: ${filename}`);
      } else if (role === 'assistant') {
        const turn = ensureTurn(line);
        turn.endTs = line.timestamp || turn.endTs;
        turn.asstReqs++;
        if (text) {
          turn.segments.push({
            k: 'm',
            n: '模型生成',
            ms: 0,
            ts: line.timestamp,
            det: { text, textTok: roundTokens(text) },
          });
        }
      } else if (role === 'toolResult') {
        const turn = ensureTurn(line);
        turn.endTs = line.timestamp || turn.endTs;
        const name = stringValue(message.toolName) || stringValue(line.raw.toolName) || 'tool';
        addToolSegment(turn, name, stringifyInput(message.input ?? line.raw.input ?? ''), text || stringifyInput(message.result ?? line.raw.result ?? ''), line.timestamp, false);
      }
    } else if (line.type === 'compaction') {
      const turn = ensureTurn(line);
      turn.endTs = line.timestamp || turn.endTs;
      turn.compressionReset = true;
      const summary = stringValue(line.raw.summary) || stringValue(line.raw.text) || 'Pi Code Agent 触发上下文压缩。';
      turn.segments.push({
        k: 'i',
        n: '上下文压缩',
        ms: 0,
        ts: line.timestamp,
        det: { text: summary },
      });
    }
  }

  for (const turn of turns) assignDurations(turn.segments, turn.startTs, turn.endTs);
  return turns;
}

function buildPiEventTurns(lines: PiLine[], filename: string): PiTurn[] {
  const turns: PiTurn[] = [];
  const toolStarts = new Map<string, { ts: string; name: string; input: string }>();
  let current: PiTurn | null = null;
  let pendingAssistantUpdate: { text: string; ts: string } | null = null;

  function ensureTurn(line: PiLine): PiTurn {
    if (!current) {
      current = {
        startTs: line.timestamp,
        endTs: line.timestamp,
        prompt: promptFromEvent(line.raw) || `Pi stream: ${filename}`,
        segments: [],
        tools: {},
        asstReqs: 0,
        compressionReset: false,
      };
      turns.push(current);
    }
    return current;
  }

  function addAssistantText(turn: PiTurn, text: string, ts: string): void {
    turn.asstReqs++;
    turn.segments.push({
      k: 'm',
      n: '模型生成',
      ms: 0,
      ts,
      det: { text, textTok: roundTokens(text) },
    });
  }

  function flushPendingAssistant(): void {
    if (!current || !pendingAssistantUpdate) return;
    addAssistantText(current, pendingAssistantUpdate.text, pendingAssistantUpdate.ts);
    pendingAssistantUpdate = null;
  }

  for (const line of lines) {
    if (line.type === 'turn_start') {
      flushPendingAssistant();
      current = {
        startTs: line.timestamp,
        endTs: line.timestamp,
        prompt: promptFromEvent(line.raw) || `Pi stream: ${filename}`,
        segments: [],
        tools: {},
        asstReqs: 0,
        compressionReset: false,
      };
      turns.push(current);
      pendingAssistantUpdate = null;
    } else if (line.type === 'message_update') {
      const turn = ensureTurn(line);
      turn.endTs = line.timestamp || turn.endTs;
      const message = messageObject(line.raw);
      const role = stringValue(message.role) || stringValue(line.raw.role);
      const text = textFromContent(message.content ?? line.raw.content);
      if (role === 'user' && text && turn.prompt.startsWith('Pi stream:')) {
        turn.prompt = text;
      } else if (role === 'assistant' && text) {
        pendingAssistantUpdate = { text, ts: line.timestamp };
      }
    } else if (line.type === 'message_end') {
      const turn = ensureTurn(line);
      turn.endTs = line.timestamp || turn.endTs;
      const message = messageObject(line.raw);
      const role = stringValue(message.role) || stringValue(line.raw.role);
      const text = textFromContent(message.content ?? line.raw.content);
      if (role === 'user' && text && turn.prompt.startsWith('Pi stream:')) {
        turn.prompt = text;
      } else if (role === 'assistant') {
        const finalText = text || pendingAssistantUpdate?.text || '';
        if (finalText) addAssistantText(turn, finalText, line.timestamp || pendingAssistantUpdate?.ts || '');
        pendingAssistantUpdate = null;
      }
    } else if (line.type === 'tool_execution_start') {
      const id = stringValue(line.raw.toolCallId) || stringValue(line.raw.id) || `tool_${line.order}`;
      toolStarts.set(id, {
        ts: line.timestamp,
        name: stringValue(line.raw.toolName) || stringValue(line.raw.name) || 'tool',
        input: stringifyInput(line.raw.args ?? line.raw.input ?? ''),
      });
    } else if (line.type === 'tool_execution_end') {
      const turn = ensureTurn(line);
      turn.endTs = line.timestamp || turn.endTs;
      const id = stringValue(line.raw.toolCallId) || stringValue(line.raw.id) || `tool_${line.order}`;
      const start = toolStarts.get(id);
      const name = stringValue(line.raw.toolName) || start?.name || stringValue(line.raw.name) || 'tool';
      const input = start?.input ?? stringifyInput(line.raw.args ?? line.raw.input ?? '');
      const result = textFromContent(isObject(line.raw.result) ? line.raw.result.content : line.raw.result) || stringifyInput(line.raw.result ?? '');
      addToolSegment(turn, name, input, result, line.timestamp, line.raw.isError === true, start?.ts);
    } else if (line.type === 'auto_compaction_start' || line.type === 'auto_compaction_end') {
      const turn = ensureTurn(line);
      turn.endTs = line.timestamp || turn.endTs;
      turn.compressionReset = true;
      turn.segments.push({
        k: 'i',
        n: '上下文压缩',
        ms: 0,
        ts: line.timestamp,
        det: { text: textFromContent(line.raw.summary ?? line.raw.message) || 'Pi Code Agent 触发上下文压缩。' },
      });
    } else if (line.type === 'turn_end' && current) {
      flushPendingAssistant();
      current.endTs = line.timestamp || current.endTs;
      current = null;
    }
  }
  flushPendingAssistant();

  for (const turn of turns) assignDurations(turn.segments, turn.startTs, turn.endTs);
  return turns;
}

function assemblePiTurns(turns: PiTurn[]): TurnData[] {
  const results: TurnData[] = [];
  const runningComp = initComp();
  const cumTools: Record<string, ToolState> = {};
  let prevComp = initComp();

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i]!;
    const beforeComp = { ...runningComp };
    addTokens(runningComp, 'userMsgs', turn.prompt);

    for (const seg of turn.segments) {
      if (seg.k === 'm') {
        if (seg.det.text) addTokens(runningComp, 'asstText', seg.det.text);
        for (const call of seg.det.calls ?? []) addTokenCount(runningComp, 'toolCalls', call.tok);
      } else if (seg.k === 's') {
        addTokenCount(runningComp, 'subagent', seg.det.resultTok ?? 0);
      } else if (seg.k === 't') {
        addTokenCount(runningComp, 'toolResults', seg.det.resultTok ?? 0);
      }
    }

    for (const seg of turn.segments) {
      if (seg.k !== 't' && seg.k !== 's') continue;
      const name = seg.det.name || seg.n;
      const existing = cumTools[name] ?? { calls: 0, resultTokens: 0, task: seg.k === 's' };
      existing.calls++;
      existing.resultTokens += seg.det.resultTok ?? 0;
      existing.task = existing.task || seg.k === 's';
      cumTools[name] = existing;
      seg.det.stepTools = cloneTools(cumTools);
    }

    const comp = { ...runningComp };
    const delta: TurnDelta = i === 0 ? deltaBetween(beforeComp, comp) : deltaBetween(prevComp, comp);
    prevComp = comp;
    const cumTotal = sumComp(comp);
    const metrics = segmentMetrics(turn.segments, turn.startTs, turn.endTs);

    results.push({
      i,
      prompt: turn.prompt,
      ts: turn.startTs,
      asstReqs: turn.asstReqs,
      maxInput: cumTotal,
      maxCacheHit: 0,
      maxReqIdx: 0,
      maxReqStep: 0,
      outTok: turn.segments.reduce((sum, seg) => sum + (seg.k === 'm' ? (seg.det.textTok ?? 0) : 0), 0),
      tools: turn.tools,
      delta,
      durMs: metrics.durMs,
      modelMs: metrics.modelMs,
      toolMs: metrics.toolMs,
      subMs: metrics.subMs,
      stepCount: turn.segments.filter((seg) => seg.k === 'm').length,
      longest: metrics.longest,
      segs: turn.segments,
      comp,
      cumTotal,
      cumCacheHit: 0,
      cumTools: cloneTools(cumTools),
      compressionReset: turn.compressionReset,
    });
  }

  return results;
}

function aggregatePiSession(lines: PiLine[], turns: TurnData[], filename: string): SessionSummary {
  let peakTurnIdx = 0;
  let peakTokens = 0;
  let totalOutput = 0;
  const series: SeriesPoint[] = [];

  for (const turn of turns) {
    totalOutput += turn.outTok;
    series.push({ i: turn.i, assembled: turn.cumTotal, input: turn.cumTotal, output: turn.outTok });
    if (turn.cumTotal > peakTokens) {
      peakTokens = turn.cumTotal;
      peakTurnIdx = turn.i;
    }
  }

  const peakComp = turns[peakTurnIdx]?.comp ?? initComp();
  return {
    session: {
      model: 'pi',
      version: piSessionVersion(lines) || filename,
      cwd: piCwd(lines),
      aiTitle: turns[0]?.prompt,
      requests: turns.reduce((sum, turn) => sum + turn.asstReqs, 0),
      peakIndex: peakTurnIdx,
      peakTokens,
      peakCacheHit: 0,
      peakTurnIdx,
      peakStep: 0,
      totalOutput,
      contextLimit: 200000,
    },
    categories: categoriesFromComp(peakComp),
    series,
    tools: aggregateTools(turns),
  };
}

function selectMainBranch(lines: PiLine[]): PiLine[] {
  const nodes = lines.filter((line) => {
    if (line.type !== 'message' && line.type !== 'custom' && line.type !== 'compaction') return false;
    return typeof line.raw.id === 'string';
  });
  if (nodes.length === 0) return lines.filter((line) => line.type !== 'header');

  const byId = new Map<string, PiLine>();
  const parentIds = new Set<string>();
  for (const line of nodes) {
    const id = stringValue(line.raw.id);
    if (!id) continue;
    byId.set(id, line);
    const parentId = stringValue(line.raw.parentId);
    if (parentId) parentIds.add(parentId);
  }

  const leaves = nodes.filter((line) => {
    const id = stringValue(line.raw.id);
    return id && !parentIds.has(id);
  });
  const candidates = leaves.length > 0 ? leaves : nodes;
  let bestPath: PiLine[] = [];

  for (const leaf of candidates) {
    const path: PiLine[] = [];
    let current: PiLine | undefined = leaf;
    const seen = new Set<string>();
    while (current) {
      const id = stringValue(current.raw.id);
      if (!id || seen.has(id)) break;
      seen.add(id);
      path.push(current);
      const parentId = stringValue(current.raw.parentId);
      current = parentId ? byId.get(parentId) : undefined;
    }
    path.reverse();
    const bestOrder = bestPath[bestPath.length - 1]?.order ?? -1;
    const pathOrder = path[path.length - 1]?.order ?? -1;
    if (path.length > bestPath.length || (path.length === bestPath.length && pathOrder > bestOrder)) {
      bestPath = path;
    }
  }

  return bestPath;
}

function addToolSegment(turn: PiTurn, name: string, input: string, result: string, ts: string, isError: boolean, startTs?: string): void {
  turn.tools[name] = (turn.tools[name] ?? 0) + 1;
  const resultTok = roundTokens(result);
  turn.segments.push({
    k: 't',
    n: name,
    ms: startTs ? msBetween(startTs, ts) : 0,
    ts,
    det: { name, input, result, resultTok, isError },
  });
}

function segmentMetrics(
  segments: TimelineSegment[],
  startTs: string,
  endTs: string,
): { durMs: number; modelMs: number; toolMs: number; subMs: number; longest: { k: string; n: string; ms: number } } {
  let modelMs = 0;
  let toolMs = 0;
  let subMs = 0;
  let longest = { k: '', n: '', ms: 0 };
  for (const seg of segments) {
    if (seg.k === 'm') modelMs += seg.ms;
    else if (seg.k === 's') subMs += seg.ms;
    else if (seg.k === 't') toolMs += seg.ms;
    if (seg.ms > longest.ms) longest = { k: seg.k, n: seg.n, ms: seg.ms };
  }
  return { durMs: Math.max(modelMs + toolMs + subMs, msBetween(startTs, endTs)), modelMs, toolMs, subMs, longest };
}

function assignDurations(segments: TimelineSegment[], startTs: string, endTs: string): void {
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    if (seg.ms > 0) continue;
    seg.ms = msBetween(seg.ts || startTs, segments[i + 1]?.ts || endTs || startTs);
  }
}

function categoriesFromComp(comp: Record<string, number>): ContextCategory[] {
  return Object.entries(comp)
    .map(([key, tokens]) => {
      const meta = CATEGORY_META[key] ?? { label: key, group: 'convo' as const, estimated: true };
      return { key, label: meta.label, group: meta.group, estimated: meta.estimated, tokens: Math.round(tokens), raw: 0 };
    })
    .sort((a, b) => b.tokens - a.tokens);
}

function aggregateTools(turns: TurnData[]): ToolAggregation[] {
  const toolMap = new Map<string, { calls: number; resultTokens: number; task: boolean }>();
  for (const turn of turns) {
    for (const [name, calls] of Object.entries(turn.tools)) {
      const existing = toolMap.get(name) ?? { calls: 0, resultTokens: 0, task: false };
      existing.calls += calls;
      const agg = turn.cumTools?.[name]?.resultTokens;
      if (typeof agg === 'number') existing.resultTokens = Math.max(existing.resultTokens, agg);
      toolMap.set(name, existing);
    }
  }
  return [...toolMap.entries()]
    .map(([name, data]) => ({ name, calls: data.calls, resultTokens: data.resultTokens, task: data.task }))
    .sort((a, b) => b.calls - a.calls);
}

function messageObject(raw: Record<string, unknown>): Record<string, unknown> {
  return isObject(raw.message) ? raw.message : raw;
}

function promptFromEvent(raw: Record<string, unknown>): string {
  return textFromContent(raw.prompt ?? raw.input ?? raw.message);
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((item) => {
      if (typeof item === 'string') return item;
      if (!isObject(item)) return '';
      if (typeof item.text === 'string') return item.text;
      if (typeof item.content === 'string') return item.content;
      return '';
    }).filter(Boolean).join('\n');
  }
  if (isObject(content)) {
    if (typeof content.text === 'string') return content.text;
    if (typeof content.content === 'string') return content.content;
  }
  return '';
}

function piCwd(lines: PiLine[]): string {
  for (const line of lines) {
    if (line.type === 'header' && typeof line.raw.workingDirectory === 'string') return line.raw.workingDirectory;
    if (typeof line.raw.cwd === 'string') return line.raw.cwd;
    if (typeof line.raw.workingDirectory === 'string') return line.raw.workingDirectory;
  }
  return '';
}

function piSessionVersion(lines: PiLine[]): string {
  for (const line of lines) {
    if (line.type === 'session' && typeof line.raw.id === 'string') return line.raw.id;
    if (line.type === 'header' && line.raw.version != null) return String(line.raw.version);
  }
  return '';
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function piLineTimestamp(raw: Record<string, unknown>): string {
  const message = isObject(raw.message) ? raw.message : {};
  return normalizeTimestamp(raw.timestamp ?? message.timestamp);
}

function normalizeTimestamp(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = Math.abs(value) < 1_000_000_000_000 ? value * 1000 : value;
    return new Date(ms).toISOString();
  }
  return '';
}
