import { STEP_COLORS } from '../../styles/theme';

export function parseJSON<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function segColor(k: string): string {
  if (k === 'm') return STEP_COLORS.model;
  if (k === 's') return STEP_COLORS.subagent;
  if (k === 'i') return 'oklch(0.62 0.03 265)';
  return STEP_COLORS.tool;
}

export function segLabel(k: string, n: string): string {
  if (k === 'm') return '模型生成';
  if (k === 's') return `子Agent · ${n}`;
  if (k === 'i') return n;
  return `工具 · ${n}`;
}

export function isTaskName(n: string): boolean {
  return n === 'Agent' || n === 'Workflow';
}
