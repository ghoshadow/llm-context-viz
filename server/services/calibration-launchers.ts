import type { AgentSource } from '../../src/pipeline/calibration-types';

export interface BuildCalibrationProxyArgsOptions {
  source: AgentSource;
  scriptPath: string;
  cwd: string;
  targetHost: string;
  port: number;
  timeoutMs: number;
  prompt: string;
}

export function buildCalibrationProxyArgs(options: BuildCalibrationProxyArgsOptions): string[] {
  const base = [
    options.scriptPath,
    '--source', options.source,
    '--cwd', options.cwd,
    '--target-host', options.targetHost,
    '--port', String(options.port),
    '--timeout-ms', String(options.timeoutMs),
    '--',
  ];

  if (options.source === 'codex') return [...base, options.prompt];

  return [...base, '-p', options.prompt];
}
