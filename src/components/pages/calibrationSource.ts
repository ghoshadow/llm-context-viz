import { getSessionSource, SESSION_SOURCE_LABELS, type SessionSourceLike } from '../../utils/sessionSource';
import type { CalibrationAutoSource } from './calibrationAutoStart';

export function calibrationSourceFromSession(session: SessionSourceLike | null | undefined): CalibrationAutoSource {
  if (!session) return 'claude';
  return getSessionSource(session);
}

export function calibrationSourceLabel(source: CalibrationAutoSource): string {
  return SESSION_SOURCE_LABELS[source];
}

export function calibrationTraceDirName(source: CalibrationAutoSource): string {
  return source === 'claude' ? '.claude-trace/' : `.${source}-trace/`;
}

export function calibrationSourceAutoLaunchSupported(source: CalibrationAutoSource): boolean {
  return source === 'claude' || source === 'codex' || source === 'opencode' || source === 'pi' || source === 'openclaw';
}
