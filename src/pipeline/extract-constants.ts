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
import type { NormalizedCalibrationSummary } from './calibration-types';

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
  /** Agent source. */
  source: 'claude';
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
  /** Summary in normalized calibration schema. */
  summary: NormalizedCalibrationSummary;
  /** Markdown-viewable source content for each calibrated constant. */
  details?: Record<string, string>;
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
    const systemTexts: string[] = [];
    const sysArr = body.system;
    if (Array.isArray(sysArr)) {
      for (const sb of sysArr) {
        const text: string = sb?.text ?? '';
        systemTexts.push(text);
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
    const tools = body.tools ?? [];
    const toolsJson = JSON.stringify(tools, null, 2);
    const toolsChars = JSON.stringify(tools).length;

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
    let globalClaudeMdText = '';
    let projectClaudeMdText = '';

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
      return p + 1;
    }

    let contentTotal = 0;
    const contentRanges: Array<[number, number]> = [];

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
      if (ce > cs) {
        globalClaudeMdText = userText.slice(cs, ce);
        up.globalClaudeMd = globalClaudeMdText.length;
        contentTotal += up.globalClaudeMd;
        contentRanges.push([cs, ce]);
      }
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
      if (ce > cs) {
        projectClaudeMdText = userText.slice(cs, ce);
        up.projectClaudeMd = projectClaudeMdText.length;
        contentTotal += up.projectClaudeMd;
        contentRanges.push([cs, ce]);
      }
    }

    // MCP instructions content
    if (mcpStart >= 0) {
      const cs = contentStartAfter(mcpStart);
      const ce = contentEndBefore(
        skillsStart > mcpStart ? skillsStart
        : currentDateStart > mcpStart ? currentDateStart
        : endOfText
      );
      if (ce > cs) { up.mcpInstructions = ce - cs; contentTotal += up.mcpInstructions; contentRanges.push([cs, ce]); }
    }

    // Skills listing content
    if (skillsStart >= 0) {
      const cs = contentStartAfter(skillsStart);
      const ce = contentEndBefore(currentDateStart > skillsStart ? currentDateStart : endOfText);
      if (ce > cs) { up.skillsListing = ce - cs; contentTotal += up.skillsListing; contentRanges.push([cs, ce]); }
    }

    // currentDate + IMPORTANT + closing tag
    if (currentDateStart >= 0) {
      up.currentDate = endOfText - currentDateStart;
    }

    // Chrome = total - actual file content (everything else is wrapper/chrome)
    up.chrome = Math.max(0, endOfText - contentTotal);
    const chromeText = buildChromeText(userText.slice(0, endOfText), contentRanges);

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
      source: 'claude',
      sourceFile: logPath.split('/').pop() || logPath,
      ccVersion,
      model,
      systemBlocks,
      toolsChars,
      userMessage: up,
      firstRequestTokens,
      summary: {
        categories: {
          sysPrompt: { chars: systemBlocks.total, detailKey: 'claude.sysPrompt', origin: 'capture' },
          tool_defs: { chars: toolsChars, detailKey: 'claude.tool_defs', origin: 'capture' },
          memoryGlobal: { chars: up.globalClaudeMd, detailKey: 'claude.memory.global', origin: 'capture' },
          memoryProject: { chars: up.projectClaudeMd, detailKey: 'claude.memory.project', origin: 'capture' },
          userMsgs: { chars: up.chrome, detailKey: 'claude.userMsgs', origin: 'capture' },
        },
        usage: {
          firstRequestInputTokens: firstRequestTokens,
        },
      },
      details: {
        'claude.sysPrompt': [
          '# claude.sysPrompt',
          '',
          `字符数: ${systemBlocks.total}`,
          '',
          systemTexts.join('\n\n--- system block ---\n\n'),
        ].join('\n'),
        'claude.tool_defs': [
          '# claude.tool_defs',
          '',
          `字符数: ${toolsChars}`,
          '',
          '```json',
          toolsJson,
          '```',
        ].join('\n'),
        'claude.userMsgs': [
          '# claude.userMsgs',
          '',
          `字符数: ${up.chrome}`,
          '',
          chromeText,
        ].join('\n'),
        'claude.memory.global': [
          '# claude.memory.global',
          '',
          `字符数: ${up.globalClaudeMd}`,
          '',
          globalClaudeMdText,
        ].join('\n'),
        'claude.memory.project': [
          '# claude.memory.project',
          '',
          `字符数: ${up.projectClaudeMd}`,
          '',
          projectClaudeMdText,
        ].join('\n'),
      },
    };
  }

  return null;
}

function buildChromeText(text: string, rangesToRemove: Array<[number, number]>): string {
  if (rangesToRemove.length === 0) return text;
  const ranges = rangesToRemove
    .map(([start, end]) => [Math.max(0, start), Math.min(text.length, end)] as [number, number])
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0]);
  let out = '';
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start > cursor) out += text.slice(cursor, start);
    cursor = Math.max(cursor, end);
  }
  if (cursor < text.length) out += text.slice(cursor);
  return out.trim();
}
