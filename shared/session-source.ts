export type SessionSource = 'claude' | 'codex' | 'opencode' | 'pi' | 'openclaw';

export const SESSION_SOURCE_LABELS: Record<SessionSource, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  pi: 'Pi',
  openclaw: 'OpenClaw',
};

export interface SessionSourceLike {
  source?: SessionSource | string | null;
  model?: string | null;
  filename?: string | null;
  version?: string | null;
}

export function getSessionSource(session: SessionSourceLike): SessionSource {
  if (
    session.source === 'codex' ||
    session.source === 'claude' ||
    session.source === 'opencode' ||
    session.source === 'pi' ||
    session.source === 'openclaw'
  ) {
    return session.source;
  }

  const model = (session.model || '').toLowerCase();
  const filename = (session.filename || '').toLowerCase();
  const version = (session.version || '').toLowerCase();

  if (model.includes('claude')) return 'claude';
  if (model === 'opencode' || version.includes('opencode')) return 'opencode';
  if (model === 'pi' || version === 'pi') return 'pi';
  if (model === 'openclaw' || version.includes('openclaw')) return 'openclaw';

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
