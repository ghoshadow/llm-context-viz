// ============================================================================
// Stage 2: Compute context composition for each turn.
// ============================================================================

import type {
  TurnGroup,
  AssistantMessage,
  ContentBlock,
} from '../types/session';
import { BLOCK_WRAPPER_CHARS } from './constants';

// ---------------------------------------------------------------------------
// Token estimator interface
// ---------------------------------------------------------------------------

/** Simple token estimator: maps text length to approximate token count. */
export interface TokenEstimator {
  /** Estimate tokens from a raw text string. */
  estimate(text: string): number;
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

/**
 * Flattened per-turn context: category key -> cumulative tokens.
 *
 * This is the primary pipeline output consumed by compute-deltas,
 * compute-timeline, aggregate-session, and assembleTurns.
 */
export type TurnContextComposition = Record<string, number>;

/**
 * Rich per-turn context entry with raw character counts in addition to
 * token estimates. Consumers that need `{tokens, raw}` pairs should
 * call `computeContextRich` instead of `computeContext`.
 */
export interface CategoryMetrics {
  tokens: number;
  raw: number;
}

// ---------------------------------------------------------------------------
// Estimated system-module character sizes
// ---------------------------------------------------------------------------
// Defaults calibrated from a real API request capture (Claude Code v2.1.170,
// deepseek-v4-pro). These can be overridden by uploading a capture via the
// /api/calibrate endpoint, which writes system-constants.json.
//
// Measured from proxy capture:
//   system blocks:  5,768 chars (billing 85 + agent 62 + harness 5,621)
//   tools JSON:    98,949 chars (full JSON Schema for all ~50 tools)

let SYS_PROMPT_FALLBACK_CHARS  = 5768;
let TOOL_DEFS_FALLBACK_CHARS   = 98949;
const SKILLS_FALLBACK_CHARS      = 9122;
const MCP_FALLBACK_CHARS         = 222;
const REMINDERS_FALLBACK_CHARS   = 409;
let SYSTEM_REMINDER_CHROME_CHARS = 612;

// MEMORY is set at runtime from actual CLAUDE.md files on disk.
let MEMORY_FALLBACK_CHARS = 2474;

// Load calibrated constants from disk. Called at module load AND on every
// pipeline run so that applying new constants via the UI takes effect immediately.
export function loadCalibratedConstants() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    const path = require('path');
    const constantsPath = path.join(__dirname, 'system-constants.json');
    if (fs.existsSync(constantsPath)) {
      const data = JSON.parse(fs.readFileSync(constantsPath, 'utf-8'));
      if (data.SYS_PROMPT_FALLBACK_CHARS) SYS_PROMPT_FALLBACK_CHARS = data.SYS_PROMPT_FALLBACK_CHARS;
      if (data.TOOL_DEFS_FALLBACK_CHARS) TOOL_DEFS_FALLBACK_CHARS = data.TOOL_DEFS_FALLBACK_CHARS;
      if (data.SYSTEM_REMINDER_CHROME_CHARS) SYSTEM_REMINDER_CHROME_CHARS = data.SYSTEM_REMINDER_CHROME_CHARS;
    }
  } catch { /* browser-side or file not found — use defaults */ }
}
loadCalibratedConstants();

export function setMemoryChars(chars: number): void {
  if (chars > 0) MEMORY_FALLBACK_CHARS = chars;
}

// ---------------------------------------------------------------------------
// Helpers: content extraction
// ---------------------------------------------------------------------------

/**
 * Flatten ContentBlock trees into a plain text string.
 *
 * Handles text blocks, nested tool_result blocks, and nested text children.
 * Image blocks are ignored (no text contribution).
 */
/** Per-block JSON wrapper overhead: {"type":"text","text":"..."} ≈ 23 chars ≈ 8 tok @ 3.0. */

function extractContentText(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content;

  let result = '';
  for (const block of content) {
    if (block.type === 'text') {
      result += block.text;
      result += ' '.repeat(BLOCK_WRAPPER_CHARS); // JSON wrapper overhead
    } else if (block.type === 'tool_result') {
      // Recurse: tool_result.content is string | ContentBlock[]
      result += extractContentText(block.content);
    }
    // image blocks contribute no text
  }
  return result;
}

/**
 * Extract text from a tool_result block only (asserts the type).
 */
function extractToolResultText(block: ContentBlock): string {
  if (block.type !== 'tool_result') return '';
  return extractContentText(block.content);
}

// ---------------------------------------------------------------------------
// Helpers: tool-name classification
// ---------------------------------------------------------------------------

/** Returns true if the tool name indicates a sub-agent spawn. */
function isSubAgentTool(name: string): boolean {
  return name === 'Agent' || name === 'Workflow';
}

// ---------------------------------------------------------------------------
// Accumulator helpers
// ---------------------------------------------------------------------------

interface Accum {
  tokens: number;
  raw: number;
}

function initAccum(): Accum {
  return { tokens: 0, raw: 0 };
}

function addTo(acc: Accum, text: string, est: TokenEstimator): void {
  acc.raw += text.length;
  acc.tokens += est.estimate(text);
}

/** Seed an accum with a known character count (padding token estimate). */
function addPadding(acc: Accum, chars: number, est: TokenEstimator): void {
  acc.raw += chars;
  acc.tokens += est.estimate(' '.repeat(chars));
}

/** Sum all token values across the accumulator map. */
function totalTokens(acc: Record<string, Accum>): number {
  let sum = 0;
  for (const v of Object.values(acc)) {
    sum += v.tokens;
  }
  return Math.round(sum);
}

/**
 * Snapshot the accumulator map into Record<string, CategoryMetrics>
 * with rounded token values.
 */
function snapshot(acc: Record<string, Accum>): Record<string, CategoryMetrics> {
  const snap: Record<string, CategoryMetrics> = {};
  for (const key of Object.keys(acc)) {
    snap[key] = {
      tokens: Math.round(acc[key]!.tokens),
      raw: acc[key]!.raw,
    };
  }
  return snap;
}

/**
 * Convert CategoryMetrics to tokens-only Record<string, number>.
 */
function toTokenMap(metrics: Record<string, CategoryMetrics>): TurnContextComposition {
  const map: TurnContextComposition = {};
  for (const key of Object.keys(metrics)) {
    map[key] = metrics[key]!.tokens;
  }
  return map;
}

// ---------------------------------------------------------------------------
// Category registry
// ---------------------------------------------------------------------------

const CORE_CATEGORIES = [
  'sysPrompt',
  'tool_defs',
  'skills',
  'memory',
  'mcp',
  'reminders',
] as const;

const CONVO_CATEGORIES = [
  'toolResults',
  'thinking',
  'toolCalls',
  'userMsgs',
  'asstText',
  'subagent',
] as const;

const ALL_CATEGORIES = [...CORE_CATEGORIES, ...CONVO_CATEGORIES] as const;

/** Create a zeroed accumulator map with all 12 categories. */
function initCum(): Record<string, Accum> {
  const cum: Record<string, Accum> = {};
  for (const key of ALL_CATEGORIES) {
    cum[key] = initAccum();
  }
  return cum;
}

/**
 * Seed all core scaffolding categories with fallback character constants.
 * Called once before processing any turns to ensure they are never zero.
 */
function seedCoreScaffolding(
  cum: Record<string, Accum>,
  est: TokenEstimator,
): void {
  addPadding(cum.sysPrompt!,  SYS_PROMPT_FALLBACK_CHARS,  est);
  addPadding(cum.tool_defs!,   TOOL_DEFS_FALLBACK_CHARS,   est);
  addPadding(cum.skills!,     SKILLS_FALLBACK_CHARS,      est);
  addPadding(cum.memory!,     MEMORY_FALLBACK_CHARS,      est);
  addPadding(cum.mcp!,        MCP_FALLBACK_CHARS,         est);
  addPadding(cum.reminders!,  REMINDERS_FALLBACK_CHARS,   est);
  addPadding(cum.userMsgs!,   SYSTEM_REMINDER_CHROME_CHARS, est);
}

// ---------------------------------------------------------------------------
// Per-group scanning
// ---------------------------------------------------------------------------

/**
 * Accumulate one turn's content into the running cumulative accumulators.
 *
 * Sources:
 *   1. User message text (userMsgs)
 *   2. Assistant thinking / text / tool_use blocks (thinking, asstText, toolCalls)
 *   3. Tool-result follow-up messages (toolResults or subagent)
 *   4. System scaffolding lines:
 *      - subtype 'nested_memory'  -> memory
 *      - subtype 'task_reminder'  -> reminders
 */
function processGroup(
  group: TurnGroup,
  est: TokenEstimator,
  cum: Record<string, Accum>,
): void {
  const userContent = group.userLine.message.content;

  // ---- 1. User message text ----
  const userText = extractContentText(userContent);
  if (userText) {
    addTo(cum.userMsgs!, userText, est);
  }

  // ---- 2. Assistant messages: thinking, text, tool calls ----
  const toolIdToName = new Map<string, string>();

  for (const asst of group.asstLines) {
    const msg: AssistantMessage = asst.message;

    for (const block of msg.content) {
      if (block.type === 'thinking') {
        addTo(cum.thinking!, block.thinking, est);
      } else if (block.type === 'text') {
        addTo(cum.asstText!, block.text, est);
      } else if (block.type === 'tool_use') {
        const callText = block.name + JSON.stringify(block.input);
        addTo(cum.toolCalls!, callText, est);
        toolIdToName.set(block.id, block.name);
      }
    }
  }

  // ---- 3. Tool-result follow-up messages ----
  for (const trLine of [group.userLine, ...(group.toolResultLines ?? [])]) {
    const content = trLine?.message?.content;
    if (typeof content === 'string' || !content) continue;
    for (const block of content) {
      if (block.type === 'tool_result') {
        const resultText = extractToolResultText(block);
        if (!resultText) continue;

        const toolName = toolIdToName.get(block.tool_use_id) ?? 'unknown';
        if (isSubAgentTool(toolName)) {
          addTo(cum.subagent!, resultText, est);
        } else {
          addTo(cum.toolResults!, resultText, est);
        }
      }
    }
  }

  // ---- 4. System-line scaffolding ----
  // These appear as `type: 'system'` lines with a `subtype` discriminator.
  // Fallback constants are replaced with real payloads on first sighting.
  for (const sys of group.systemLines) {
    const subtype = sys.subtype;

    if (subtype === 'nested_memory' && cum.memory!.raw === MEMORY_FALLBACK_CHARS) {
      const payload = sys.message as { content?: string } | undefined;
      if (payload?.content) {
        // Replace fallback with real payload.
        cum.memory!.raw = 0;
        cum.memory!.tokens = 0;
        addTo(cum.memory!, payload.content, est);
      }
    } else if (subtype === 'task_reminder') {
      const payload = sys.message as {
        title?: string;
        description?: string;
      } | undefined;
      const parts = [payload?.title, payload?.description].filter(
        (s): s is string => typeof s === 'string' && s.length > 0,
      );
      if (parts.length > 0) {
        // Replace fallback with real payload on first sighting.
        if (cum.reminders!.raw === REMINDERS_FALLBACK_CHARS) {
          cum.reminders!.raw = 0;
          cum.reminders!.tokens = 0;
        }
        addTo(cum.reminders!, parts.join('\n'), est);
      }
    }
  }

  // ---- 5. Attachment lines (skill_listing, task_reminder) ----
  for (const att of group.attachmentLines ?? []) {
    if (att.type === 'skill_listing' && typeof att.content === 'string') {
      // Replace the hardcoded skills fallback with real skill listing from JSONL
      cum.skills!.raw = 0;
      cum.skills!.tokens = 0;
      addTo(cum.skills!, att.content, est);
    } else if (att.type === 'task_reminder') {
      const items: any[] = Array.isArray(att.content) ? att.content : (att.content ? [att.content] : []);
      for (const item of items) {
        const text = typeof item === 'string' ? item : (item?.title || '') + '\n' + (item?.description || '');
        if (text.trim()) {
          if (cum.reminders!.raw === REMINDERS_FALLBACK_CHARS) {
            cum.reminders!.raw = 0;
            cum.reminders!.tokens = 0;
          }
          addTo(cum.reminders!, text, est);
        }
      }
    } else if (att.type === 'mcp_instructions_delta') {
      // MCP server instructions — uses addedBlocks at attachment root
      const data: any = att.content;
      const blocks: string[] = Array.isArray(data?.addedBlocks) ? data.addedBlocks : [];
      const text = blocks.join('\n');
      if (text) {
        cum.mcp!.raw = 0;
        cum.mcp!.tokens = 0;
        addTo(cum.mcp!, text, est);
      }
    } else if (att.type === 'ultra_effort_enter') {
      // Ultra effort reminder — add to reminders
      const reminderText = 'Ultracode is on: optimize for the most exhaustive, correct answer.';
      if (cum.reminders!.raw === REMINDERS_FALLBACK_CHARS) {
        cum.reminders!.raw = 0;
        cum.reminders!.tokens = 0;
      }
      addTo(cum.reminders!, reminderText, est);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API — primary pipeline function
// ---------------------------------------------------------------------------

/**
 * Compute cumulative context composition for each turn.
 *
 * Walks every turn's assistant messages, user messages, tool results, and
 * system events, tallying token consumption by category:
 *
 *   | Key         | Source                              |
 *   |-------------|-------------------------------------|
 *   | sysPrompt   | Estimated system prompt (constant)  |
 *   | tools       | Estimated tool definitions (const)  |
 *   | skills      | Inline skill definitions (const)    |
 *   | memory      | nested_memory system lines          |
 *   | mcp         | MCP instructions (constant)         |
 *   | reminders   | task_reminder system lines          |
 *   | toolResults | Tool result content (non-Task)      |
 *   | thinking    | Assistant thinking blocks           |
 *   | toolCalls   | Tool use blocks (name + input JSON) |
 *   | userMsgs    | User message text                   |
 *   | asstText    | Assistant text response blocks      |
 *   | subagent    | Task-related tool results           |
 *
 * All categories are cumulative across turns. System scaffolding
 * (sysPrompt, tools, skills, mcp) uses fallback constants seeded on
 * the first turn. memory and reminders start from fallback constants
 * and are replaced with real payloads when found in the trace.
 *
 * @param groups    Turn groups from Stage 1 (identify-turns).
 * @param estimator Token estimator mapping text length to token count.
 * @returns Per-turn cumulative token maps (Record<string, number>).
 */
export function computeContext(
  groups: TurnGroup[],
  estimator: TokenEstimator,
): TurnContextComposition[] {
  const cum = initCum();
  seedCoreScaffolding(cum, estimator);

  const compositions: TurnContextComposition[] = [];

  let lastApiTotal = 0;

  for (const group of groups) {
    let turnApiMax = 0;
    for (const line of group.asstLines) {
      const usage = line.message.usage;
      if (!usage) continue;
      const t = usage.input_tokens + (usage.cache_read_input_tokens ?? 0);
      if (t > turnApiMax) turnApiMax = t;
    }

    if (turnApiMax > 0) {
      if (lastApiTotal > 0 && turnApiMax < lastApiTotal * 0.5) {
        for (const key of Object.keys(cum)) {
          cum[key] = initAccum();
        }
        seedCoreScaffolding(cum, estimator);
      }
      lastApiTotal = turnApiMax;
    }

    processGroup(group, estimator, cum);
    compositions.push(toTokenMap(snapshot(cum)));
  }

  return compositions;
}
