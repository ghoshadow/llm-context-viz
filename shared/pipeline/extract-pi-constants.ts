import { extractAgentWireConstants, type ExtractedAgentWireConstants } from './extract-agent-wire-constants';

export type ExtractedPiConstants = ExtractedAgentWireConstants & { source: 'pi' };

export function extractPiConstants(logPath: string): ExtractedPiConstants | null {
  return extractAgentWireConstants(logPath, {
    source: 'pi',
    detailPrefix: 'pi',
  }) as ExtractedPiConstants | null;
}
