export type SessionSource = 'claude' | 'codex';

export interface SessionSourceLike {
  source?: SessionSource | string | null;
  model?: string | null;
  filename?: string | null;
  version?: string | null;
}

export function getSessionSource(session: SessionSourceLike): SessionSource {
  if (session.source === 'codex' || session.source === 'claude') return session.source;

  const model = (session.model || '').toLowerCase();
  const filename = (session.filename || '').toLowerCase();
  const version = (session.version || '').toLowerCase();

  if (model.includes('claude')) return 'claude';

  if (
    model.includes('gpt') ||
    model.includes('codex') ||
    version.includes('codex') ||
    filename.startsWith('rollout-')
  ) {
    return 'codex';
  }

  return 'claude';
}
