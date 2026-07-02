import type { CodexLine, CodexTurn } from './codex-jsonl-types';
import { isObject, textFromCodexContent } from './codex-jsonl-parser';

export function buildCodexTurns(lines: CodexLine[]): CodexTurn[] {
  const turns: CodexTurn[] = [];
  let current: CodexTurn | null = null;
  let lastModel = 'codex';
  let lastContextLimit = 200000;

  for (const line of lines) {
    const payload = line.payload;

    if (line.type === 'turn_context') {
      if (typeof payload.model === 'string') lastModel = payload.model;
      if (typeof payload.model_context_window === 'number') lastContextLimit = payload.model_context_window;
    }

    if (line.type === 'event_msg' && payload.type === 'task_started') {
      if (current) finalizeTurn(current, line.timestamp);
      current = {
        turnId: typeof payload.turn_id === 'string' ? payload.turn_id : `turn_${turns.length + 1}`,
        startTs: line.timestamp,
        endTs: line.timestamp,
        prompt: '',
        model: lastModel,
        contextLimit: typeof payload.model_context_window === 'number' ? payload.model_context_window : lastContextLimit,
        events: [line],
        tokenUsages: [],
      };
      turns.push(current);
      continue;
    }

    if (!current) continue;

    current.events.push(line);
    if (line.timestamp) current.endTs = line.timestamp;

    if (line.type === 'turn_context') {
      if (typeof payload.model === 'string') current.model = payload.model;
      if (typeof payload.model_context_window === 'number') current.contextLimit = payload.model_context_window;
      if (typeof payload.cwd === 'string') {
        // Kept on the event for aggregation; no separate field needed.
      }
    } else if (line.type === 'event_msg' && payload.type === 'user_message') {
      if (!current.prompt && typeof payload.message === 'string') current.prompt = payload.message;
    } else if (line.type === 'response_item' && payload.type === 'message' && payload.role === 'user' && !current.prompt) {
      const text = textFromCodexContent(payload.content).trim();
      if (text && !text.startsWith('<environment_context>')) current.prompt = text;
    } else if (line.type === 'event_msg' && payload.type === 'token_count') {
      const info = payload.info as Record<string, unknown> | undefined;
      const usage = info?.last_token_usage;
      if (isObject(usage)) current.tokenUsages.push({ line, usage });
      const window = info?.model_context_window;
      if (typeof window === 'number') current.contextLimit = window;
    } else if (line.type === 'event_msg' && payload.type === 'task_complete') {
      current.durationMs = typeof payload.duration_ms === 'number' ? payload.duration_ms : undefined;
      finalizeTurn(current, line.timestamp);
      current = null;
    } else if (line.type === 'event_msg' && payload.type === 'turn_aborted') {
      current.durationMs = typeof payload.duration_ms === 'number' ? payload.duration_ms : undefined;
      current.aborted = true;
      finalizeTurn(current, line.timestamp);
      current = null;
    } else if (line.type === 'event_msg' && payload.type === 'context_compacted') {
      current.compacted = true;
    } else if (line.type === 'compacted') {
      current.compacted = true;
    }
  }

  if (current) finalizeTurn(current, current.endTs);
  return turns;
}

export function finalizeTurn(turn: CodexTurn, fallbackEndTs: string): void {
  if (!turn.endTs) turn.endTs = fallbackEndTs || turn.startTs;
  if (!turn.prompt) turn.prompt = '(Codex 日志未记录用户输入)';
}
