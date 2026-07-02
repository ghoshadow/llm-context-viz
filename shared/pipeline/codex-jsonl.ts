import type {
  SessionSummary,
  TurnData,
} from '../types/session';
import type {
  NormalizedCalibration,
  NormalizedCalibrationSummary,
} from './calibration-types';
import { firstPayload, parseCodexLines } from './codex-jsonl-parser';
import { aggregateCodexSession, assembleTurns } from './codex-jsonl-summary';
import { buildCodexTurns } from './codex-jsonl-turns';

export function isCodexJsonl(jsonlText: string): boolean {
  for (const raw of jsonlText.split('\n')) {
    if (!raw.trim()) continue;
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>;
      if (obj.type === 'session_meta' || obj.type === 'turn_context') return true;
      if (obj.type === 'event_msg') {
        const payload = obj.payload;
        if (typeof payload === 'object' && payload !== null && !Array.isArray(payload) && typeof (payload as Record<string, unknown>).type === 'string') return true;
      }
      if (obj.type === 'response_item') {
        const payload = obj.payload;
        if (typeof payload === 'object' && payload !== null && !Array.isArray(payload) && typeof (payload as Record<string, unknown>).type === 'string') return true;
      }
    } catch {
      return false;
    }
  }
  return false;
}

export function runCodexPipeline(
  jsonlText: string,
  filename: string,
  calibration?: NormalizedCalibration | NormalizedCalibrationSummary | null,
): {
  summary: SessionSummary;
  turns: TurnData[];
  errors: { line: number; message: string }[];
} {
  const { lines, errors } = parseCodexLines(jsonlText);
  const sessionMeta = firstPayload(lines, 'session_meta');
  const turns = buildCodexTurns(lines);
  const turnData = assembleTurns(turns, sessionMeta, calibration);
  const summary = aggregateCodexSession(sessionMeta, turns, turnData, filename);
  return { summary, turns: turnData, errors };
}
