// ============================================================================
// Stage 2: Compute context composition for each turn.
// ============================================================================

import type {
  TurnGroup,
  AssistantMessage,
  ContentBlock,
} from '../types/session';

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

export interface TurnContextEntry {
  /** 1-based turn index. */
  turnIndex: number;
  /** Cumulative category key -> {tokens, raw} up to and including this turn. */
  comp: Record<string, CategoryMetrics>;
  /** Cumulative total context tokens at turn end. */
  cumTotal: number;
}

// ---------------------------------------------------------------------------
// Estimated system-module character sizes
// ---------------------------------------------------------------------------
// Drawn from the prototype's observed character counts for a typical
// Claude Code session. When no real payload is found in the trace, these
// constants ensure scaffolding categories are non-zero (matching prototype
// behaviour where skil/memory/mcp/reminders never show zero).

const SYS_PROMPT_FALLBACK_CHARS  = 2900;
const TOOL_DEFS_FALLBACK_CHARS   = 11200;
const SKILLS_FALLBACK_CHARS      = 9122;
const MEMORY_FALLBACK_CHARS      = 2474;
const MCP_FALLBACK_CHARS         = 222;
const REMINDERS_FALLBACK_CHARS   = 409;

// ---------------------------------------------------------------------------
// Helpers: content extraction
// ---------------------------------------------------------------------------

/**
 * Flatten ContentBlock trees into a plain text string.
 *
 * Handles text blocks, nested tool_result blocks, and nested text children.
 * Image blocks are ignored (no text contribution).
 */
function extractContentText(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content;

  let result = '';
  for (const block of content) {
    if (block.type === 'text') {
      result += block.text;
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

/** Returns true if the tool name indicates a sub-agent (Task family). */
function isTaskTool(name: string): boolean {
  return name.startsWith('Task');
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
  'tools',
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
  addPadding(cum.tools!,      TOOL_DEFS_FALLBACK_CHARS,   est);
  addPadding(cum.skills!,     SKILLS_FALLBACK_CHARS,      est);
  addPadding(cum.memory!,     MEMORY_FALLBACK_CHARS,      est);
  addPadding(cum.mcp!,        MCP_FALLBACK_CHARS,         est);
  addPadding(cum.reminders!,  REMINDERS_FALLBACK_CHARS,   est);
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
  if (typeof userContent !== 'string') {
    for (const block of userContent) {
      if (block.type === 'tool_result') {
        const resultText = extractToolResultText(block);
        if (!resultText) continue;

        const toolName = toolIdToName.get(block.tool_use_id) ?? 'unknown';
        if (isTaskTool(toolName)) {
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

  for (const group of groups) {
    processGroup(group, estimator, cum);
    compositions.push(toTokenMap(snapshot(cum)));
  }

  return compositions;
}

// ---------------------------------------------------------------------------
// Rich variant — same logic, richer output
// ---------------------------------------------------------------------------

/**
 * Compute cumulative context composition with raw character counts.
 *
 * Identical to `computeContext` in logic, but returns `TurnContextEntry[]`
 * where each entry includes `{tokens, raw}` metrics per category plus
 * a `cumTotal` field.
 *
 * Use this when you need both estimated tokens and raw character counts
 * for diagnostics, debugging, or detailed display.
 */
export function computeContextRich(
  groups: TurnGroup[],
  estimator: TokenEstimator,
): TurnContextEntry[] {
  const cum = initCum();
  seedCoreScaffolding(cum, estimator);

  const entries: TurnContextEntry[] = [];

  for (const group of groups) {
    processGroup(group, estimator, cum);
    const comp = snapshot(cum);
    entries.push({
      turnIndex: group.turnIndex,
      comp,
      cumTotal: totalTokens(cum),
    });
  }

  return entries;
}
