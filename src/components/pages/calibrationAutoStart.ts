import type { AgentSource } from './calibrationCategories';

export type CalibrationAutoSource = AgentSource;

export interface AutoCalibrationStartBody {
  source: CalibrationAutoSource;
  cwd: string;
  prompt: string;
  targetHost?: string;
  timeoutMs: number;
}

export function defaultCalibrationPromptInput(source: CalibrationAutoSource): string {
  return source === 'claude' ? 'say hi' : 'Calibration probe: reply with "ok".';
}

export function defaultCalibrationTargetInput(source: CalibrationAutoSource): string {
  return '';
}

export function captureTargetPlaceholderText(source: CalibrationAutoSource): string {
  if (source === 'codex') return '留空读取 ~/.codex/config.toml；填写可覆盖 Base URL';
  if (source === 'claude') return '留空读取 ~/.claude/settings.json；填写可覆盖 Base URL';
  return '留空使用默认 API Host；填写可覆盖，如 api.deepseek.com';
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
