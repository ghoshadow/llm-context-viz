import Database from 'better-sqlite3';

const OPENCODE_DB_PREFIX = 'opencode-db:';

interface OpenCodeDbSessionRow {
  id: string;
  time_updated: number;
}

interface OpenCodeDbSession {
  id: string;
  directory: string;
  title: string;
}

interface OpenCodeDbMessageRow {
  message_id: string;
  message_time: number;
  message_data: string;
  part_id: string | null;
  part_time: number | null;
  part_data: string | null;
}

interface OpenCodeDbMessage {
  id: string;
  time: number;
  data: Record<string, unknown>;
  parts: Array<{ id: string; time: number; data: Record<string, unknown> }>;
}

export interface OpenCodeDbSessionRef {
  path: string;
  name: string;
  size: number;
  modified: string;
}

export function isOpenCodeDbVirtualPath(path: string): boolean {
  return path.startsWith(OPENCODE_DB_PREFIX);
}

export function listOpenCodeDbSessions(dbPath: string): OpenCodeDbSessionRef[] {
  const db = openOpenCodeDb(dbPath);
  try {
    const rows = db.prepare(`
      SELECT id, time_updated
      FROM session
      ORDER BY time_updated DESC
    `).all() as OpenCodeDbSessionRow[];

    return rows.map((row) => ({
      path: makeOpenCodeDbVirtualPath(dbPath, row.id),
      name: `opencode-${row.id}.jsonl`,
      size: 0,
      modified: timestampIso(row.time_updated),
    }));
  } finally {
    db.close();
  }
}

export function readOpenCodeDbVirtualJsonl(path: string): { jsonl: string; filename: string } {
  const ref = parseOpenCodeDbVirtualPath(path);
  return {
    jsonl: readOpenCodeDbSessionJsonl(ref.dbPath, ref.sessionId),
    filename: `opencode-${ref.sessionId}.jsonl`,
  };
}

export function readOpenCodeDbSessionJsonl(dbPath: string, sessionId: string): string {
  const db = openOpenCodeDb(dbPath);
  try {
    const session = db.prepare(`
      SELECT id, directory, title
      FROM session
      WHERE id = ?
    `).get(sessionId) as OpenCodeDbSession | undefined;
    if (!session) throw new Error(`OpenCode session not found: ${sessionId}`);

    const rows = db.prepare(`
      SELECT
        m.id AS message_id,
        m.time_created AS message_time,
        m.data AS message_data,
        p.id AS part_id,
        p.time_created AS part_time,
        p.data AS part_data
      FROM message m
      LEFT JOIN part p ON p.message_id = m.id AND p.session_id = m.session_id
      WHERE m.session_id = ?
      ORDER BY m.time_created, p.time_created, p.id
    `).all(sessionId) as OpenCodeDbMessageRow[];

    return buildOpenCodeJsonl(session, groupMessages(rows));
  } finally {
    db.close();
  }
}

function openOpenCodeDb(dbPath: string): Database.Database {
  return new Database(dbPath, { readonly: true, fileMustExist: true });
}

function makeOpenCodeDbVirtualPath(dbPath: string, sessionId: string): string {
  return `${OPENCODE_DB_PREFIX}${encodeURIComponent(dbPath)}#${encodeURIComponent(sessionId)}`;
}

function parseOpenCodeDbVirtualPath(path: string): { dbPath: string; sessionId: string } {
  if (!isOpenCodeDbVirtualPath(path)) throw new Error('Not an OpenCode DB virtual path');
  const body = path.slice(OPENCODE_DB_PREFIX.length);
  const hashIndex = body.lastIndexOf('#');
  if (hashIndex < 0) throw new Error('Invalid OpenCode DB virtual path');
  return {
    dbPath: decodeURIComponent(body.slice(0, hashIndex)),
    sessionId: decodeURIComponent(body.slice(hashIndex + 1)),
  };
}

function groupMessages(rows: OpenCodeDbMessageRow[]): OpenCodeDbMessage[] {
  const messages: OpenCodeDbMessage[] = [];
  let current: OpenCodeDbMessage | null = null;

  for (const row of rows) {
    if (!current || current.id !== row.message_id) {
      current = {
        id: row.message_id,
        time: row.message_time,
        data: parseObject(row.message_data),
        parts: [],
      };
      messages.push(current);
    }
    if (row.part_id && row.part_data) {
      current.parts.push({
        id: row.part_id,
        time: row.part_time ?? row.message_time,
        data: parseObject(row.part_data),
      });
    }
  }

  return messages;
}

function buildOpenCodeJsonl(session: OpenCodeDbSession, messages: OpenCodeDbMessage[]): string {
  let prompt = session.title || `OpenCode session ${session.id}`;
  let hasOpenTurn = false;
  const lines: string[] = [];

  for (const message of messages) {
    const role = typeof message.data.role === 'string' ? message.data.role : '';
    if (role === 'user') {
      prompt = userText(message) || prompt;
      hasOpenTurn = false;
      continue;
    }

    for (const part of message.parts) {
      const eventType = eventTypeFromPart(part.data);
      if (!eventType) continue;

      const enrichedPart: Record<string, unknown> = {
        id: part.id,
        sessionID: session.id,
        messageID: message.id,
        cwd: session.directory,
        ...part.data,
      };
      if (eventType === 'step_start') {
        if (hasOpenTurn) continue;
        enrichedPart.prompt = prompt;
        hasOpenTurn = true;
      }
      if (eventType === 'step_finish' && !enrichedPart.tokens && message.data.tokens) {
        enrichedPart.tokens = message.data.tokens;
      }

      lines.push(JSON.stringify({
        type: eventType,
        timestamp: part.time,
        sessionID: session.id,
        part: enrichedPart,
      }));
    }
  }

  return lines.join('\n');
}

function eventTypeFromPart(part: Record<string, unknown>): string {
  switch (part.type) {
    case 'step-start':
      return 'step_start';
    case 'step-finish':
      return 'step_finish';
    case 'tool':
      return 'tool_use';
    case 'text':
      return 'text';
    default:
      return '';
  }
}

function userText(message: OpenCodeDbMessage): string {
  const partText = message.parts
    .map((part) => part.data.type === 'text' && typeof part.data.text === 'string' ? part.data.text : '')
    .filter(Boolean)
    .join('\n')
    .trim();
  if (partText) return partText;
  return typeof message.data.text === 'string' ? message.data.text.trim() : '';
}

function parseObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function timestampIso(value: number): string {
  return new Date(value).toISOString();
}
