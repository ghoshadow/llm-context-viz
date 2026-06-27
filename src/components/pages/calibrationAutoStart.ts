export type CalibrationAutoSource = 'claude' | 'codex';

export interface AutoCalibrationStartBody {
  source: CalibrationAutoSource;
  cwd: string;
  prompt: string;
  targetHost?: string;
  timeoutMs: number;
}

export function defaultCalibrationPromptInput(source: CalibrationAutoSource): string {
  return source === 'codex' ? 'Calibration probe: reply with "ok".' : 'say hi';
}

export function defaultCalibrationTargetInput(source: CalibrationAutoSource): string {
  return source === 'codex' ? '' : 'http://127.0.0.1:15721';
}

export function buildAutoCalibrationStartBody(input: {
  source: CalibrationAutoSource;
  cwd: string;
  prompt: string;
  targetHost: string;
  timeoutMs: number;
}): AutoCalibrationStartBody {
  const prompt = input.prompt.trim() || defaultCalibrationPromptInput(input.source);
  const targetHost = input.targetHost.trim();
  const body: AutoCalibrationStartBody = {
    source: input.source,
    cwd: input.cwd,
    prompt,
    timeoutMs: input.timeoutMs,
  };

  if (targetHost) {
    body.targetHost = targetHost;
  } else if (input.source === 'claude') {
    body.targetHost = 'api.deepseek.com';
  }

  return body;
}
