import { useEffect, useState } from 'react';
import { get } from '../../api/client';
import type { AgentSource } from './calibrationCategories';

export function useCurrentCalibrationConstants<T>({
  sessionCwd,
  calibrationSource,
  onError,
}: {
  sessionCwd: string | null | undefined;
  calibrationSource: Extract<AgentSource, 'claude' | 'codex'>;
  onError: (message: string) => void;
}) {
  const [currentConstants, setCurrentConstants] = useState<T | null>(null);

  useEffect(() => {
    if (!sessionCwd) {
      setCurrentConstants(null);
      return;
    }
    get<T>(`/calibrate/current?cwd=${encodeURIComponent(sessionCwd)}&source=${calibrationSource}`)
      .then(setCurrentConstants)
      .catch((err) => onError((err as Error).message));
  }, [calibrationSource, onError, sessionCwd]);

  return { currentConstants, setCurrentConstants };
}
