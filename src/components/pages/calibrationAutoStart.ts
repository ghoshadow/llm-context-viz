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
  return '';
}

export function captureTargetPlaceholderText(source: CalibrationAutoSource): string {
  return source === 'codex'
    ? '留空读取 ~/.codex/config.toml；填写可覆盖 Base URL'
    : '留空读取 ~/.claude/settings.json；填写可覆盖 Base URL';
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
  }

  return body;
}
