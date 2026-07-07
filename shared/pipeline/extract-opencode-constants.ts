import { extractAgentWireConstants, type ExtractedAgentWireConstants } from './extract-agent-wire-constants';

export type ExtractedOpenCodeConstants = ExtractedAgentWireConstants & { source: 'opencode' };

export function extractOpenCodeConstants(logPath: string): ExtractedOpenCodeConstants | null {
  return extractAgentWireConstants(logPath, {
    source: 'opencode',
    detailPrefix: 'opencode',
  }) as ExtractedOpenCodeConstants | null;
}
