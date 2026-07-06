import Database from 'better-sqlite3';

const OPENCLAW_DB_PREFIX = 'openclaw-db:';

interface OpenClawSessionRow {
  session_id: string;
  session_key: string;
  cwd: string;
  complete: number;
  created_at: number;
  updated_at: number;
}

interface OpenClawEventRow {
  seq: number;
  at: number;
  session_key: string;
  run_id: string | null;
  update_json: string;
}

export interface OpenClawDbSessionRef {
  path: string;
  name: string;
  size: number;
  modified: string;
}

export function isOpenClawDbVirtualPath(path: string): boolean {
  return path.startsWith(OPENCLAW_DB_PREFIX);
}

export function listOpenClawDbSessions(dbPath: string): OpenClawDbSessionRef[] {
  const db = openOpenClawDb(dbPath);
  try {
    const rows = db.prepare(`
      SELECT session_id, updated_at
      FROM acp_replay_sessions
      ORDER BY updated_at DESC, session_id
    `).all() as Array<Pick<OpenClawSessionRow, 'session_id' | 'updated_at'>>;

    return rows.map((row) => ({
      path: makeOpenClawDbVirtualPath(dbPath, row.session_id),
      name: `openclaw-${row.session_id}.jsonl`,
      size: 0,
      modified: timestampIso(row.updated_at),
    }));
  } finally {
    db.close();
  }
}

export function readOpenClawDbVirtualJsonl(path: string): { jsonl: string; filename: string } {
  const ref = parseOpenClawDbVirtualPath(path);
  return {
    jsonl: readOpenClawDbSessionJsonl(ref.dbPath, ref.sessionId),
    filename: `openclaw-${ref.sessionId}.jsonl`,
  };
}

export function readOpenClawDbSessionJsonl(dbPath: string, sessionId: string): string {
  const db = openOpenClawDb(dbPath);
  try {
    const session = db.prepare(`
      SELECT session_id, session_key, cwd, complete, created_at, updated_at
      FROM acp_replay_sessions
      WHERE session_id = ?
    `).get(sessionId) as OpenClawSessionRow | undefined;
    if (!session) throw new Error(`OpenClaw session not found: ${sessionId}`);

    const rows = db.prepare(`
      SELECT seq, at, session_key, run_id, update_json
      FROM acp_replay_events
      WHERE session_id = ?
      ORDER BY seq
    `).all(sessionId) as OpenClawEventRow[];

    return buildOpenClawJsonl(session, rows);
  } finally {
    db.close();
  }
}

function openOpenClawDb(dbPath: string): Database.Database {
  return new Database(dbPath, { readonly: true, fileMustExist: true });
}

function makeOpenClawDbVirtualPath(dbPath: string, sessionId: string): string {
  return `${OPENCLAW_DB_PREFIX}${encodeURIComponent(dbPath)}#${encodeURIComponent(sessionId)}`;
}

function parseOpenClawDbVirtualPath(path: string): { dbPath: string; sessionId: string } {
  if (!isOpenClawDbVirtualPath(path)) throw new Error('Not an OpenClaw DB virtual path');
  const body = path.slice(OPENCLAW_DB_PREFIX.length);
  const hashIndex = body.lastIndexOf('#');
  if (hashIndex < 0) throw new Error('Invalid OpenClaw DB virtual path');
  return {
    dbPath: decodeURIComponent(body.slice(0, hashIndex)),
    sessionId: decodeURIComponent(body.slice(hashIndex + 1)),
  };
}

function buildOpenClawJsonl(session: OpenClawSessionRow, rows: OpenClawEventRow[]): string {
  const lines = [
    JSON.stringify({
      type: 'openclaw_session',
      timestamp: session.created_at,
      sessionId: session.session_id,
      sessionKey: session.session_key,
      cwd: session.cwd,
      complete: Boolean(session.complete),
    }),
  ];

  for (const row of rows) {
    const update = parseObject(row.update_json);
    if (!update.sessionUpdate) continue;
    lines.push(JSON.stringify({
      type: 'session_update',
      timestamp: row.at,
      seq: row.seq,
      sessionId: session.session_id,
      sessionKey: row.session_key,
      ...(row.run_id ? { runId: row.run_id } : {}),
      update,
    }));
  }

  return lines.join('\n');
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
