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
import { detectSessionFormat } from './session-format';

export function isCodexJsonl(jsonlText: string): boolean {
  return detectSessionFormat(jsonlText) === 'codex';
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
