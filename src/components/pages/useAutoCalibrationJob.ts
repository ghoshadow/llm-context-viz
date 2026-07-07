import { useCallback, useEffect, useState } from 'react';
import { get, post } from '../../api/client';
import { buildAutoCalibrationStartBody } from './calibrationAutoStart';
import { calibrationSourceAutoLaunchSupported, calibrationSourceLabel } from './calibrationSource';
import type { AgentSource } from './calibrationCategories';
import type { ExtractedResult } from './CalibratePage';

export type AutoCalibrationStatus =
  | 'starting'
  | 'running'
  | 'captured'
  | 'extracting'
  | 'ready'
  | 'failed'
  | 'cancelled';

export interface AutoCalibrationJob {
  jobId: string;
  status: AutoCalibrationStatus;
  cwd: string;
  targetHost: string;
  port: number;
  startedAt: string;
  completedAt?: string;
  logFile?: string;
  message: string;
  output: string[];
  result: ExtractedResult | null;
  error: string | null;
}

export function useAutoCalibrationJob({
  sessionCwd,
  calibrationSource,
  autoPrompt,
  autoTargetHost,
  onResult,
  onError,
  onBeforeStart,
}: {
  sessionCwd: string | null | undefined;
  calibrationSource: AgentSource;
  autoPrompt: string;
  autoTargetHost: string;
  onResult: (result: ExtractedResult) => void;
  onError: (message: string) => void;
  onBeforeStart: () => void;
}) {
  const [autoJob, setAutoJob] = useState<AutoCalibrationJob | null>(null);
  const [autoRunning, setAutoRunning] = useState(false);

  const handleAutoStart = useCallback(async () => {
    if (!sessionCwd) {
      onError('请先打开一个会话，以便自动检测项目目录。');
      return;
    }
    if (!calibrationSourceAutoLaunchSupported(calibrationSource)) {
      onError(`${calibrationSourceLabel(calibrationSource)} 暂不支持从前端自动启动校准；请使用已有抓包 JSONL 解析结果。`);
      return;
    }
    onBeforeStart();
    setAutoRunning(true);
    try {
      const job = await post<AutoCalibrationJob>('/calibrate/auto/start', buildAutoCalibrationStartBody({
        source: calibrationSource,
        cwd: sessionCwd,
        prompt: autoPrompt,
        targetHost: autoTargetHost,
        timeoutMs: 45000,
      }));
      setAutoJob(job);
    } catch (err) {
      onError((err as Error).message);
      setAutoRunning(false);
    }
  }, [autoPrompt, autoTargetHost, calibrationSource, onBeforeStart, onError, sessionCwd]);

  useEffect(() => {
    if (!autoJob?.jobId) return;
    if (autoJob.status === 'ready' || autoJob.status === 'failed' || autoJob.status === 'cancelled') {
      setAutoRunning(false);
      if (autoJob.status === 'ready' && autoJob.result) {
        onResult(autoJob.result);
      }
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const next = await get<AutoCalibrationJob>(`/calibrate/auto/${autoJob.jobId}`);
        setAutoJob(next);
      } catch (err) {
        onError((err as Error).message);
        setAutoRunning(false);
      }
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [autoJob, onError, onResult]);

  const handleAutoCancel = useCallback(async () => {
    if (!autoJob?.jobId) return;
    try {
      const next = await post<AutoCalibrationJob>(`/calibrate/auto/${autoJob.jobId}/cancel`);
      setAutoJob(next);
      setAutoRunning(false);
    } catch (err) {
      onError((err as Error).message);
    }
  }, [autoJob?.jobId, onError]);

  return {
    autoJob,
    autoRunning,
    setAutoJob,
    handleAutoStart,
    handleAutoCancel,
  };
}
