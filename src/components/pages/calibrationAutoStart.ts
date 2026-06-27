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

export function captureTargetHelpText(source: CalibrationAutoSource): string {
  if (source === 'codex') {
    return 'Codex 模式可留空：后端会读取 ~/.codex/config.toml 的当前 provider base_url。只有需要临时覆盖到其他网关或本地代理时，才填写完整 Base URL。';
  }
  return 'Claude Code 模式可填完整 Base URL（如 cc_switch 的 http://127.0.0.1:15721），也可填裸 host（如 api.deepseek.com）。';
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
