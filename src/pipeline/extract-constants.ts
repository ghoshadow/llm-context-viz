// ============================================================================
// Extract system constants from a captured API request log.
//
// Reads a JSONL file produced by scripts/transparent-proxy.js, finds the first
// POST request, and measures the character counts for each system component:
//
//   - system blocks (billing header, agent identity, harness prompt)
//   - tools (full JSON Schema)
//   - user message (<system-reminder> wrapper)
//     - CLAUDE.md sections (Global + Project)
//     - MCP instructions
//     - skills listing
//     - chrome/wrapper text
//
// The output can be used to update the fallback constants in compute-context.ts
// when Claude Code is upgraded to a new version.
// ============================================================================

import { readFileSync } from 'fs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SystemBlocks {
  total: number;
  billing: number;
  agentIdentity: number;
  harness: number;
}

export interface UserMessageParts {
  total: number;
  chrome: number;
  globalClaudeMd: number;
  projectClaudeMd: number;
  mcpInstructions: number;
  skillsListing: number;
  currentDate: number;
  sessionGuidance: number;
}

export interface ExtractedConstants {
  /** Source log file name. */
  sourceFile: string;
  /** Claude Code version string from headers. */
  ccVersion: string;
  /** Model name. */
  model: string;
  /** System blocks character counts. */
  systemBlocks: SystemBlocks;
  /** Tools JSON Schema character count. */
  toolsChars: number;
  /** User message (<system-reminder>) breakdown. */
  userMessage: UserMessageParts;
  /** Total input_tokens reported by the API for the first request. */
  firstRequestTokens: number;
  /** Summary: the key constants for compute-context.ts. */
  summary: {
    SYS_PROMPT_FALLBACK_CHARS: number;
    TOOL_DEFS_FALLBACK_CHARS: number;
    SYSTEM_REMINDER_CHROME_CHARS: number;
  };
}

// ---------------------------------------------------------------------------
// Main extraction
// ---------------------------------------------------------------------------

/**
 * Extract system constants from a captured API request log (JSONL).
 * Returns null if no valid POST request with a non-empty body is found.
 */
export function extractConstants(logPath: string): ExtractedConstants | null {
  const raw = readFileSync(logPath, 'utf-8');
  const lines = raw.split('\n').filter(l => l.trim());

  for (const line of lines) {
    let entry: any;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.request?.method !== 'POST') continue;

    const body = entry.request?.body;
    if (!body || typeof body !== 'object') continue;
    if (!body.messages || !Array.isArray(body.messages)) continue;

    // --- System blocks ---
    const systemBlocks: SystemBlocks = { total: 0, billing: 0, agentIdentity: 0, harness: 0 };
    const sysArr = body.system;
    if (Array.isArray(sysArr)) {
      for (const sb of sysArr) {
        const text: string = sb?.text ?? '';
        systemBlocks.total += text.length;
        if (text.includes('cc_version') || text.includes('billing-header'))
          systemBlocks.billing += text.length;
        else if (text.includes('You are a Claude agent'))
          systemBlocks.agentIdentity += text.length;
        else
          systemBlocks.harness += text.length;
      }
    }

    // --- Tools ---
    const toolsChars = JSON.stringify(body.tools ?? []).length;

    // --- User message (<system-reminder>) ---
    const userMsg = body.messages[0] as any;
    const userContent = userMsg?.content;
    const userText: string = (Array.isArray(userContent) && userContent[0]?.text)
      ? userContent[0].text
      : '';

    const up: UserMessageParts = {
      total: userText.length,
      chrome: 0,
      globalClaudeMd: 0,
      projectClaudeMd: 0,
      mcpInstructions: 0,
      skillsListing: 0,
      currentDate: 0,
      sessionGuidance: 0,
    };

    // Find section boundaries
    const globalStart = userText.indexOf('Contents of /Users/');
    const projStart = globalStart >= 0
      ? userText.indexOf('Contents of', globalStart + 20)
      : -1;
    const mcpStart = userText.indexOf('# MCP Server Instructions');
    const skillsStart = userText.indexOf('The following skills are available');
    if (skillsStart < 0) {
      const alt = userText.indexOf('The following skills');
      if (alt >= 0 && alt > (mcpStart >= 0 ? mcpStart : 0)) {
        // Found alternative skills section
      }
    }
    const ultraStart = userText.indexOf('Ultracode is on');
    const currentDateStart = userText.indexOf('# currentDate');
    const ctxMgmtStart = userText.indexOf('# Context management');
    const envStart = userText.indexOf('# Environment');
    const memoryStart = userText.indexOf('# Memory');
    const guidanceStart = userText.indexOf('# Session-specific guidance');
    const closingTag = userText.indexOf('</system-reminder>');

    // Extract known sections
    if (globalStart >= 0 && projStart > globalStart) {
      up.globalClaudeMd = projStart - globalStart;
    } else if (globalStart >= 0 && mcpStart > globalStart) {
      up.globalClaudeMd = mcpStart - globalStart;
    } else if (globalStart >= 0) {
      up.globalClaudeMd = userText.length - globalStart;
    }

    if (projStart > 0) {
      const projEnd = mcpStart > projStart ? mcpStart
        : skillsStart > projStart ? skillsStart
        : currentDateStart > projStart ? currentDateStart
        : userText.length;
      up.projectClaudeMd = projEnd - projStart;
    }

    if (mcpStart >= 0) {
      const mcpEnd = skillsStart > mcpStart ? skillsStart
        : ultraStart > mcpStart ? ultraStart
        : currentDateStart > mcpStart ? currentDateStart
        : userText.length;
      up.mcpInstructions = mcpEnd - mcpStart;
    }

    if (skillsStart >= 0) {
      const skillsEnd = ultraStart > skillsStart ? ultraStart
        : currentDateStart > skillsStart ? currentDateStart
        : userText.length;
      up.skillsListing = skillsEnd - skillsStart;
    }

    if (currentDateStart >= 0) {
      up.currentDate = (closingTag >= 0 ? closingTag : userText.length) - currentDateStart;
    }

    // Chrome = total - all identified content sections
    const knownSections = up.globalClaudeMd + up.projectClaudeMd
      + up.mcpInstructions + up.skillsListing + up.currentDate;
    up.chrome = Math.max(0, up.total - knownSections);

    // --- API token count ---
    let firstRequestTokens = 0;
    const respBody = entry.response?.body;
    if (typeof respBody === 'string') {
      const m = respBody.match(/"input_tokens":(\d+)/);
      if (m) firstRequestTokens = parseInt(m[1]!, 10);
    }

    // --- Version & model ---
    const ccHeader = entry.request?.headers?.['x-claude-code-session-id']
      || entry.request?.headers?.['user-agent']
      || '';
    const ccVersion = (entry.request?.headers?.['user-agent'] || '')
      .match(/claude-cli\/([\d.]+)/)?.[1] || 'unknown';
    const model = body.model || 'unknown';

    return {
      sourceFile: logPath.split('/').pop() || logPath,
      ccVersion,
      model,
      systemBlocks,
      toolsChars,
      userMessage: up,
      firstRequestTokens,
      summary: {
        SYS_PROMPT_FALLBACK_CHARS: systemBlocks.total,
        TOOL_DEFS_FALLBACK_CHARS: toolsChars,
        SYSTEM_REMINDER_CHROME_CHARS: up.chrome,
      },
    };
  }

  return null;
}
