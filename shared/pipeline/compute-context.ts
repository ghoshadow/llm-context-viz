// ============================================================================
// Stage 2: Compute context composition for each turn.
// ============================================================================

import type {
  TurnGroup,
  AssistantMessage,
  ContentBlock,
} from '../types/session';
import { isSubAgentTool, extractContentText } from './utils';
import {
  type NormalizedCalibration,
  type NormalizedCalibrationSummary,
  categoryChars,
  memoryCategoryChars,
  CALIBRATION_DEFAULTS,
} from './calibration-types';

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
 * This is the primary pipeline output consumed by delta computation,
 * compute-timeline, aggregate-session, and assembleTurns.
 */
export type TurnContextComposition = Record<string, number>;

/**
 * Rich per-turn context entry with raw character counts in addition to
 * token estimates. Internally used by the `snapshot()` helper; consumers
 * typically use `TurnContextComposition` (tokens-only) as the pipeline output.
 */
export interface CategoryMetrics {
  tokens: number;
  raw: number;
}

// ---------------------------------------------------------------------------
// Estimated system-module character sizes
// ---------------------------------------------------------------------------
// 默认值来自 CALIBRATION_DEFAULTS（src/pipeline/calibration-types.ts），
// 这是唯一的真实来源。运行时可通过 loadCalibratedConstants() 从项目
// .claude-trace/system-constants.json 覆盖。

const DEFAULT_SYS_PROMPT_FALLBACK_CHARS = CALIBRATION_DEFAULTS.SYS_PROMPT_CHARS;
const DEFAULT_TOOL_DEFS_FALLBACK_CHARS = CALIBRATION_DEFAULTS.TOOL_DEFS_CHARS;
const DEFAULT_SYSTEM_REMINDER_CHROME_CHARS = CALIBRATION_DEFAULTS.USER_WRAPPER_CHARS;
const DEFAULT_MEMORY_FALLBACK_CHARS = CALIBRATION_DEFAULTS.MEMORY_CHARS;

let SYS_PROMPT_FALLBACK_CHARS  = DEFAULT_SYS_PROMPT_FALLBACK_CHARS;
let TOOL_DEFS_FALLBACK_CHARS   = DEFAULT_TOOL_DEFS_FALLBACK_CHARS;
const SKILLS_FALLBACK_CHARS      = CALIBRATION_DEFAULTS.SKILLS_CHARS;
const MCP_FALLBACK_CHARS         = CALIBRATION_DEFAULTS.MCP_CHARS;
const REMINDERS_FALLBACK_CHARS   = CALIBRATION_DEFAULTS.REMINDERS_CHARS;
let SYSTEM_REMINDER_CHROME_CHARS = DEFAULT_SYSTEM_REMINDER_CHROME_CHARS;

// MEMORY 在运行时从磁盘上的实际 CLAUDE.md 文件设置。
let MEMORY_FALLBACK_CHARS = DEFAULT_MEMORY_FALLBACK_CHARS;

export function resetCalibratedConstants() {
  SYS_PROMPT_FALLBACK_CHARS = DEFAULT_SYS_PROMPT_FALLBACK_CHARS;
  TOOL_DEFS_FALLBACK_CHARS = DEFAULT_TOOL_DEFS_FALLBACK_CHARS;
  SYSTEM_REMINDER_CHROME_CHARS = DEFAULT_SYSTEM_REMINDER_CHROME_CHARS;
  MEMORY_FALLBACK_CHARS = DEFAULT_MEMORY_FALLBACK_CHARS;
}

interface LegacyCalibratedConstantsInput {
  SYS_PROMPT_FALLBACK_CHARS?: number;
  TOOL_DEFS_FALLBACK_CHARS?: number;
  SYSTEM_REMINDER_CHROME_CHARS?: number;
}

type CalibratedConstantsInput = NormalizedCalibration | NormalizedCalibrationSummary | LegacyCalibratedConstantsInput;

// Apply project-scoped calibrated constants. Called on every pipeline run with
// constants already resolved by the server-side pipeline service.
export function loadCalibratedConstants(constants?: CalibratedConstantsInput | null) {
  resetCalibratedConstants();
  if (!constants) return;

  if ('categories' in constants) {
    const sysPrompt = categoryChars(constants, 'sysPrompt');
    const toolDefs = categoryChars(constants, 'tool_defs');
    const userChrome = categoryChars(constants, 'userMsgs');
    const memory = memoryCategoryChars(constants);
    if (sysPrompt) SYS_PROMPT_FALLBACK_CHARS = sysPrompt;
    if (toolDefs) TOOL_DEFS_FALLBACK_CHARS = toolDefs;
    if (userChrome) SYSTEM_REMINDER_CHROME_CHARS = userChrome;
    if (memory) MEMORY_FALLBACK_CHARS = memory;
    return;
  }

  if (constants.SYS_PROMPT_FALLBACK_CHARS) SYS_PROMPT_FALLBACK_CHARS = constants.SYS_PROMPT_FALLBACK_CHARS;
  if (constants.TOOL_DEFS_FALLBACK_CHARS) TOOL_DEFS_FALLBACK_CHARS = constants.TOOL_DEFS_FALLBACK_CHARS;
  if (constants.SYSTEM_REMINDER_CHROME_CHARS) SYSTEM_REMINDER_CHROME_CHARS = constants.SYSTEM_REMINDER_CHROME_CHARS;
}

export function setMemoryChars(chars: number): void {
  if (chars > 0) MEMORY_FALLBACK_CHARS = chars;
}

// ---------------------------------------------------------------------------
// Helpers: content extraction
// ---------------------------------------------------------------------------

/**
 * Extract text from a tool_result block only (asserts the type).
 */
function extractToolResultText(block: ContentBlock): string {
  if (block.type !== 'tool_result') return '';
  return extractContentText(block.content);
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
  'userWrapper',
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
  addPadding(cum.userWrapper!, SYSTEM_REMINDER_CHROME_CHARS, est);
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
      const items: Array<{ title?: string; description?: string } | string> = Array.isArray(att.content) ? att.content : (att.content ? [att.content] : []);
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
      const data = att.content;
      const blocks = Array.isArray((data as { addedBlocks?: string[] } | null)?.addedBlocks) ? (data as { addedBlocks: string[] }).addedBlocks : [];
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
 *   | userWrapper | Claude user message wrapper (const) |
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

  // Fallback constants are seeded into cum via seedCoreScaffolding at turn 0.
  // When real JSONL payloads are encountered during processGroup, the matching
  // categories (memory, reminders, mcp, skills) are reset to zero and
  // re-accumulated with measured content. If a later compression reset triggers
  // cum[key]=initAccum(), those payload categories would be overwritten with
  // zeroes. Preserve tracked (non-fallback) category values before reset,
  // then restore them afterward.
  const CORE_TRACKED_KEYS = ['memory', 'reminders', 'mcp', 'skills'] as const;
  const PRESERVED_CATEGORIES = [...CORE_TRACKED_KEYS] as readonly string[];

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
        // Save categories that have been overwritten with real payload data
        // (raw != fallback value) so compression reset doesn't lose them.
        const saved: Record<string, Accum> = {};
        for (const key of PRESERVED_CATEGORIES) {
          const a = cum[key];
          if (a && a.tokens > 0) {
            saved[key] = { tokens: a.tokens, raw: a.raw };
          }
        }
        for (const key of Object.keys(cum)) {
          cum[key] = initAccum();
        }
        seedCoreScaffolding(cum, estimator);
        // Restore payload-backed categories that were overwritten by reset
        for (const key of PRESERVED_CATEGORIES) {
          if (saved[key]) {
            cum[key] = saved[key]!;
          }
        }
      }
      lastApiTotal = turnApiMax;
    }

    processGroup(group, estimator, cum);
    compositions.push(toTokenMap(snapshot(cum)));
  }

  return compositions;
}
