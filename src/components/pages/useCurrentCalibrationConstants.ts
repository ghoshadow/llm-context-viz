import { useEffect, useRef, useState } from 'react';
import { get } from '../../api/client';
import type { AgentSource } from './calibrationCategories';

export function currentCalibrationRequestKey(sessionCwd: string | null | undefined, source: AgentSource): string {
  return sessionCwd ? `${sessionCwd}\0${source}` : '';
}

export function useCurrentCalibrationConstants<T>({
  sessionCwd,
  calibrationSource,
  onError,
}: {
  sessionCwd: string | null | undefined;
  calibrationSource: AgentSource;
  onError: (message: string) => void;
}) {
  const [currentConstants, setCurrentConstants] = useState<T | null>(null);
  const latestKeyRef = useRef('');
  const requestKey = currentCalibrationRequestKey(sessionCwd, calibrationSource);
  latestKeyRef.current = requestKey;

  useEffect(() => {
    if (!sessionCwd) {
      setCurrentConstants(null);
      return;
    }
    const key = requestKey;
    setCurrentConstants(null);
    get<T>(`/calibrate/current?cwd=${encodeURIComponent(sessionCwd)}&source=${calibrationSource}`)
      .then((data) => {
        if (latestKeyRef.current === key) setCurrentConstants(data);
      })
      .catch((err) => {
        if (latestKeyRef.current === key) onError((err as Error).message);
      });
  }, [calibrationSource, onError, requestKey, sessionCwd]);

  return { currentConstants, setCurrentConstants };
}
