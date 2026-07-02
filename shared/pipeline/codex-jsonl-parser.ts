import type { CodexLine, JsonObject } from './codex-jsonl-types';

export function parseCodexLines(text: string): { lines: CodexLine[]; errors: { line: number; message: string }[] } {
  const lines: CodexLine[] = [];
  const errors: { line: number; message: string }[] = [];

  text.split('\n').forEach((raw, idx) => {
    if (!raw.trim()) return;
    try {
      const obj = JSON.parse(raw) as JsonObject;
      if (typeof obj.type !== 'string') {
        errors.push({ line: idx + 1, message: 'Codex line missing type' });
        return;
      }
      lines.push({
        order: idx,
        timestamp: typeof obj.timestamp === 'string' ? obj.timestamp : '',
        type: obj.type,
        payload: isObject(obj.payload) ? obj.payload : {},
      });
    } catch {
      errors.push({ line: idx + 1, message: 'Invalid JSON: could not parse line' });
    }
  });

  return { lines, errors };
}

export function firstPayload(lines: CodexLine[], type: string): JsonObject | null {
  return lines.find((line) => line.type === type)?.payload ?? null;
}

export function isToolCallPayload(payload: JsonObject): boolean {
  return typeof payload.call_id === 'string' && (
    payload.type === 'function_call' ||
    payload.type === 'custom_tool_call' ||
    payload.type === 'web_search_call' ||
    payload.type === 'tool_search_call'
  );
}

export function toolNameFor(payload: JsonObject): string {
  if (typeof payload.name === 'string') return payload.name;
  if (payload.type === 'web_search_call') return 'web_search';
  if (payload.type === 'tool_search_call') return 'tool_search';
  return 'unknown';
}

export function stringifyInput(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input == null) return '';
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}

export function outputToText(output: unknown): string {
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) {
    return output.map((item) => {
      if (typeof item === 'string') return item;
      if (isObject(item) && typeof item.text === 'string') return item.text;
      return stringifyInput(item);
    }).join('\n');
  }
  if (isObject(output) && typeof output.text === 'string') return output.text;
  return stringifyInput(output);
}

export function textFromCodexContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(textFromCodexContentBlock).filter(Boolean).join('\n');
}

export function textFromCodexContentBlock(block: unknown): string {
  if (!isObject(block)) return '';
  if ((block.type === 'input_text' || block.type === 'output_text' || block.type === 'text') && typeof block.text === 'string') {
    return block.text;
  }
  return '';
}

export function textFromCodexReasoningSummary(summary: unknown): string {
  if (typeof summary === 'string') return summary.trim();
  if (!Array.isArray(summary)) return '';
  return summary.map((item) => {
    if (typeof item === 'string') return item.trim();
    if (!isObject(item)) return '';
    if (typeof item.text === 'string') return item.text.trim();
    if (typeof item.content === 'string') return item.content.trim();
    return '';
  }).filter(Boolean).join('\n\n');
}

export function durationToMs(duration: unknown): number | undefined {
  if (!isObject(duration)) return undefined;
  const secs = typeof duration.secs === 'number' ? duration.secs : 0;
  const nanos = typeof duration.nanos === 'number' ? duration.nanos : 0;
  return Math.round(secs * 1000 + nanos / 1_000_000);
}

export function msBetween(startIso: string, endIso: string): number {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (isNaN(start) || isNaN(end)) return 0;
  return Math.max(0, end - start);
}

export function numberOrZero(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

export function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
