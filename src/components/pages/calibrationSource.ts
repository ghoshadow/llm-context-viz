import { getSessionSource, type SessionSourceLike } from '../../utils/sessionSource';
import type { CalibrationAutoSource } from './calibrationAutoStart';

export function calibrationSourceFromSession(session: SessionSourceLike | null | undefined): CalibrationAutoSource {
  if (!session) return 'claude';
  const source = getSessionSource(session);
  return source === 'codex' ? 'codex' : 'claude';
}

export function calibrationSourceLabel(source: CalibrationAutoSource): string {
  return source === 'codex' ? 'Codex' : 'Claude Code';
}
