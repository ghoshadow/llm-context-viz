import { extractAgentWireConstants, type ExtractedAgentWireConstants } from './extract-agent-wire-constants';

export type ExtractedOpenClawConstants = ExtractedAgentWireConstants & { source: 'openclaw' };

export function extractOpenClawConstants(logPath: string): ExtractedOpenClawConstants | null {
  return extractAgentWireConstants(logPath, {
    source: 'openclaw',
    detailPrefix: 'openclaw',
  }) as ExtractedOpenClawConstants | null;
}
