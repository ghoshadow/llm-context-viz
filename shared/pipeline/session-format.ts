import { isObject } from './codex-jsonl-parser';

export type SessionFormat = 'claude' | 'codex' | 'opencode' | 'pi-session' | 'pi-event-stream' | 'unknown';

const OPENCODE_TYPES = new Set(['step_start', 'step_finish', 'tool_use', 'text', 'error']);
const PI_EVENT_TYPES = new Set([
  'session',
  'agent_start',
  'agent_end',
  'turn_start',
  'turn_end',
  'message_start',
  'message_update',
  'message_end',
  'tool_execution_start',
  'tool_execution_end',
  'auto_compaction_start',
  'auto_compaction_end',
]);

export function detectSessionFormat(jsonlText: string): SessionFormat {
  const lines = jsonlText.split('\n');
  const limit = Math.min(lines.length, 25);

  for (let i = 0; i < limit; i++) {
    const raw = lines[i]?.trim();
    if (!raw) continue;

    let obj: Record<string, unknown>;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!isObject(parsed)) return 'unknown';
      obj = parsed;
    } catch {
      return 'unknown';
    }

    const type = typeof obj.type === 'string' ? obj.type : '';
    const payload = isObject(obj.payload) ? obj.payload : null;
    const part = isObject(obj.part) ? obj.part : null;

    if (type === 'session_meta' || type === 'turn_context') return 'codex';
    if ((type === 'event_msg' || type === 'response_item') && typeof payload?.type === 'string') return 'codex';

    if (OPENCODE_TYPES.has(type) && (typeof obj.sessionID === 'string' || part)) return 'opencode';

    if (PI_EVENT_TYPES.has(type)) return 'pi-event-stream';

    if (
      type === 'header' &&
      (typeof obj.version === 'number' || typeof obj.version === 'string' || typeof obj.workingDirectory === 'string')
    ) {
      return 'pi-session';
    }
    if (type === 'message' && ('id' in obj || 'parentId' in obj) && isObject(obj.message)) return 'pi-session';
    if ((type === 'custom' || type === 'compaction') && ('id' in obj || 'parentId' in obj)) return 'pi-session';

    if (
      (type === 'user' || type === 'assistant' || type === 'system' || type === 'ai-title') &&
      (typeof obj.uuid === 'string' || isObject(obj.message) || typeof obj.aiTitle === 'string')
    ) {
      return 'claude';
    }
  }

  return 'unknown';
}
