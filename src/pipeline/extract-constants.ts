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
  const lines = raw.split('\n').filter((l: string) => l.trim());

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

    // Chrome measurement: split the user message into sections.
    // Chrome = everything that is NOT actual file content (CLAUDE.md,
    // skills listing, MCP instructions). This includes:
    //   - <system-reminder> tag and intro text
    //   - # claudeMd section header
    //   - "Contents of ...CLAUDE.md..." section headers
    //   - # MCP Server Instructions header
    //   - "The following skills..." header
    //   - Ultracode notice, # currentDate, IMPORTANT note, closing tag
    //
    // We find the actual content of each injected file (CLAUDE.md etc.)
    // by looking for the content markers after the section headers.

    const globalStart = userText.indexOf('Contents of /Users/');
    const projStart = globalStart >= 0
      ? userText.indexOf('Contents of', globalStart + 20)
      : -1;
    const mcpStart = userText.indexOf('# MCP Server Instructions');
    const skillsStart = userText.indexOf('The following skills are available');
    const currentDateStart = userText.indexOf('# currentDate');
    const closingTag = userText.indexOf('</system-reminder>');
    const endOfText = closingTag >= 0 ? closingTag : userText.length;

    // Helper: find where the actual file content begins after a section
    // header. The pattern is: "Header line\n\nContent starts here"
    function contentStartAfter(pos: number): number {
      const nl = userText.indexOf('\n\n', pos);
      return nl >= 0 ? nl + 2 : pos;
    }
    // Helper: find the end of a block of content (before the next section
    // marker or before trailing whitespace before the next header).
    function contentEndBefore(pos: number): number {
      // Walk back from pos to find the last non-blank content line
      let p = pos - 1;
      while (p > 0 && userText[p] === '\n') p--;
      const nl = userText.lastIndexOf('\n', p);
      return nl >= 0 ? nl + 1 : pos;
    }

    let contentTotal = 0;

    // Global CLAUDE.md content
    if (globalStart >= 0) {
      const cs = contentStartAfter(globalStart);
      const ce = contentEndBefore(
        projStart > globalStart ? projStart
        : mcpStart > globalStart ? mcpStart
        : skillsStart > globalStart ? skillsStart
        : currentDateStart > globalStart ? currentDateStart
        : endOfText
      );
      if (ce > cs) { up.globalClaudeMd = ce - cs; contentTotal += up.globalClaudeMd; }
    }

    // Project CLAUDE.md content
    if (projStart > 0) {
      const cs = contentStartAfter(projStart);
      const ce = contentEndBefore(
        mcpStart > projStart ? mcpStart
        : skillsStart > projStart ? skillsStart
        : currentDateStart > projStart ? currentDateStart
        : endOfText
      );
      if (ce > cs) { up.projectClaudeMd = ce - cs; contentTotal += up.projectClaudeMd; }
    }

    // MCP instructions content
    if (mcpStart >= 0) {
      const cs = contentStartAfter(mcpStart);
      const ce = contentEndBefore(
        skillsStart > mcpStart ? skillsStart
        : currentDateStart > mcpStart ? currentDateStart
        : endOfText
      );
      if (ce > cs) { up.mcpInstructions = ce - cs; contentTotal += up.mcpInstructions; }
    }

    // Skills listing content
    if (skillsStart >= 0) {
      const cs = contentStartAfter(skillsStart);
      const ce = contentEndBefore(currentDateStart > skillsStart ? currentDateStart : endOfText);
      if (ce > cs) { up.skillsListing = ce - cs; contentTotal += up.skillsListing; }
    }

    // currentDate + IMPORTANT + closing tag
    if (currentDateStart >= 0) {
      up.currentDate = endOfText - currentDateStart;
    }

    // Chrome = total - actual file content (everything else is wrapper/chrome)
    up.chrome = Math.max(0, endOfText - contentTotal);

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
