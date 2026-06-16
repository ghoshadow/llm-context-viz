// ============================================================================
// Stage 0: Parse raw JSONL text into typed line entries
// ============================================================================

import type {
  SessionLine,
  AssistantLine,
  UserLine,
  LineType,
  MessageContent,
  ContentBlock,
} from '../types/session';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface ParseError {
  /** 1-based line number. */
  line: number;
  message: string;
}

export interface ParseResult {
  lines: SessionLine[];
  errors: ParseError[];
}

// ---------------------------------------------------------------------------
// Known line types — anything outside this set is treated as an error
// ---------------------------------------------------------------------------

const KNOWN_LINE_TYPES: ReadonlySet<string> = new Set<LineType>([
  'assistant',
  'user',
  'system',
  'attachment',
  'mode',
  'permission-mode',
  'ai-title',
  'last-prompt',
  'file-history-snapshot',
  'task_reminder',
  'Project',
  'nested_memory',
]);

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

function hasShape(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

function areRequiredFieldsPresent(obj: Record<string, unknown>): boolean {
  return isString(obj.type) && isString(obj.uuid) && isString(obj.timestamp);
}

function isValidType(t: string): t is LineType {
  return KNOWN_LINE_TYPES.has(t);
}

// ---------------------------------------------------------------------------
// Assistant content parser
// ---------------------------------------------------------------------------

function parseMessageContent(raw: unknown): MessageContent[] {
  if (!Array.isArray(raw)) return [];

  const contents: MessageContent[] = [];

  for (const item of raw) {
    if (!hasShape(item) || !isString(item.type)) continue;

    switch (item.type) {
      case 'text': {
        const text = isString(item.text) ? item.text : '';
        contents.push({ type: 'text', text });
        break;
      }
      case 'thinking': {
        const thinking = isString(item.thinking) ? item.thinking : '';
        const signature = isString(item.signature) ? item.signature : '';
        contents.push({
          type: 'thinking',
          thinking,
          signature,
        });
        break;
      }
      case 'tool_use': {
        const id = isString(item.id) ? item.id : '';
        const name = isString(item.name) ? item.name : '';
        const input =
          hasShape(item.input) ? item.input as Record<string, unknown> : {};
        contents.push({
          type: 'tool_use',
          id,
          name,
          input,
        });
        break;
      }
      // unknown content block — silently skip
    }
  }

  return contents;
}

function parseUsage(raw: unknown): { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } | undefined {
  if (!hasShape(raw)) return undefined;

  const input = raw.input_tokens;
  const output = raw.output_tokens;

  if (typeof input !== 'number' || typeof output !== 'number') return undefined;

  return {
    input_tokens: input,
    output_tokens: output,
    cache_read_input_tokens: typeof raw.cache_read_input_tokens === 'number' ? raw.cache_read_input_tokens : undefined,
    cache_creation_input_tokens: typeof raw.cache_creation_input_tokens === 'number' ? raw.cache_creation_input_tokens : undefined,
  };
}

function parseAssistantMessage(obj: Record<string, unknown>): AssistantLine['message'] | null {
  const msg = obj.message;
  if (!hasShape(msg)) return null;

  // model
  const model = isString(msg.model) ? msg.model : 'unknown';

  // content
  const content = parseMessageContent(msg.content);

  // usage
  const usage = parseUsage(msg.usage);

  // stop_reason
  const stop_reason = isString(msg.stop_reason) ? msg.stop_reason : '';

  return {
    model,
    usage,
    content,
    stop_reason,
  };
}

// ---------------------------------------------------------------------------
// User content parser
// ---------------------------------------------------------------------------

function parseUserContentBlock(raw: unknown): ContentBlock | null {
  if (!hasShape(raw) || !isString(raw.type)) return null;

  switch (raw.type) {
    case 'text': {
      const text = isString(raw.text) ? raw.text : '';
      return { type: 'text', text };
    }
    case 'image': {
      const source = raw.source;
      if (!hasShape(source)) return null;
      const sourceType = source.type;
      if (sourceType !== 'base64' && sourceType !== 'url') return null;
      const media_type = isString(source.media_type) ? source.media_type : 'image/png';
      const data = isString(source.data) ? source.data : '';
      return {
        type: 'image',
        source: { type: sourceType, media_type, data },
      };
    }
    case 'tool_result': {
      const tool_use_id = isString(raw.tool_use_id) ? raw.tool_use_id : '';
      const is_error = raw.is_error === true ? true : undefined;

      // content can be a string or ContentBlock[]
      if (isString(raw.content)) {
        return {
          type: 'tool_result',
          tool_use_id,
          content: raw.content,
          is_error,
        };
      }
      if (Array.isArray(raw.content)) {
        const blocks: ContentBlock[] = [];
        for (const block of raw.content) {
          const parsed = parseUserContentBlock(block);
          if (parsed) blocks.push(parsed);
        }
        return {
          type: 'tool_result',
          tool_use_id,
          content: blocks,
          is_error,
        };
      }
      return {
        type: 'tool_result',
        tool_use_id,
        content: '',
        is_error,
      };
    }
  }

  return null;
}

function parseUserMessage(obj: Record<string, unknown>): UserLine['message'] | null {
  const msg = obj.message;
  if (!hasShape(msg)) return null;

  const content = msg.content;

  // content can be a string or ContentBlock[]
  if (isString(content)) {
    return { role: 'user', content };
  }

  if (Array.isArray(content)) {
    const blocks: ContentBlock[] = [];
    for (const item of content) {
      const block = parseUserContentBlock(item);
      if (block) blocks.push(block);
    }
    return { role: 'user', content: blocks };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

/**
 * Parse raw JSONL text into typed session line entries.
 *
 * Each non-empty line is parsed as JSON. Required fields (type, uuid, timestamp)
 * are validated. Lines are classified by their `type` field, and nested structures
 * (assistant message content/usage, user message content blocks) are parsed into
 * typed shapes.
 *
 * Malformed JSON and structural validation failures are reported as `ParseError`
 * rather than crashing.
 */
export function parseJsonl(text: string): ParseResult {
  const rawLines = text.split('\n');

  const lines: SessionLine[] = [];
  const errors: ParseError[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    const lineNumber = i + 1; // 1-based for error reporting
    const raw = rawLines[i];

    // Skip empty lines
    if (raw === undefined || raw.trim() === '') continue;

    // --- JSON parse ---
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      errors.push({
        line: lineNumber,
        message: 'Invalid JSON: could not parse line',
      });
      continue;
    }

    if (!hasShape(parsed)) {
      errors.push({
        line: lineNumber,
        message: 'Line is not a JSON object',
      });
      continue;
    }

    // --- Required fields ---
    if (!areRequiredFieldsPresent(parsed)) {
      errors.push({
        line: lineNumber,
        message: `Missing required fields (type, uuid, timestamp). Got: type=${typeof parsed.type}, uuid=${typeof parsed.uuid}, timestamp=${typeof parsed.timestamp}`,
      });
      continue;
    }

    const type = parsed.type as string;
    const uuid = parsed.uuid as string;
    const timestamp = parsed.timestamp as string;

    // --- Unknown type ---
    if (!isValidType(type)) {
      errors.push({
        line: lineNumber,
        message: `Unknown line type: "${type}"`,
      });
      continue;
    }

    // --- Build typed line ---
    const base: Omit<SessionLine, 'type'> = {
      uuid,
      timestamp,
      sessionId: isString(parsed.sessionId) ? parsed.sessionId : '',
    };

    if (isString(parsed.parentUuid)) {
      base.parentUuid = parsed.parentUuid;
    }

    if (type === 'assistant') {
      const message = parseAssistantMessage(parsed);
      if (!message) {
        errors.push({
          line: lineNumber,
          message: 'Assistant line missing or invalid "message" field',
        });
        continue;
      }
      lines.push({
        ...base,
        type: 'assistant',
        message,
      } as AssistantLine);
    } else if (type === 'user') {
      const message = parseUserMessage(parsed);
      if (!message) {
        errors.push({
          line: lineNumber,
          message: 'User line missing or invalid "message" field',
        });
        continue;
      }
      const userLine: UserLine = {
        ...base,
        type: 'user',
        message,
      };
      if (isString(parsed.promptId)) {
        userLine.promptId = parsed.promptId;
      }
      lines.push(userLine);
    } else {
      // system, attachment, mode, permission-mode, ai-title, last-prompt,
      // file-history-snapshot, task_reminder, Project, nested_memory
      // — pass through with just the base fields.
      lines.push({
        ...base,
        type,
      } as SessionLine);
    }
  }

  return { lines, errors };
}
