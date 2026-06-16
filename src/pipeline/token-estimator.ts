// ============================================================================
// Token Estimator — shared utilities across pipeline stages
// ============================================================================

/**
 * Estimate token count from raw text length.
 *
 * Default heuristic: length / 4, based on the rule of thumb that one token
 * corresponds to roughly 4 characters for English text. An explicit ratio
 * can be passed to override the default.
 */
export function estimateTokens(text: string, charsPerToken?: number): number {
  const ratio = charsPerToken ?? 4;
  return text.length / ratio;
}

/**
 * Derive the actual chars-per-token ratio from real API usage data.
 *
 * Usage is recorded on every assistant message (`usage.input_tokens` /
 * `usage.output_tokens`). Dividing the raw character count by the reported
 * token count yields a per-model / per-workload calibration factor that can
 * be fed back into `estimateTokens` for more accurate estimates.
 */
export function calibrateRatio(usageTokens: number, rawChars: number): number {
  if (usageTokens <= 0) return 4; // fallback to default heuristic
  return rawChars / usageTokens;
}

// ============================================================================
// Known / estimated system-module character sizes (from prototype)
// ============================================================================

/** System prompt base (CLI instructions, environment info, etc.). */
export const SYS_PROMPT_CHARS = 2900;

/** Tool definitions (schema JSON for every registered tool). */
export const TOOL_DEFS_CHARS = 11200;

/** Inline skill definitions injected into the system prompt. */
export const SKILLS_CHARS = 9122;

/** Session memory / CLAUDE.md contents. */
export const MEMORY_CHARS = 2474;

/** MCP server configuration blocks. */
export const MCP_CHARS = 222;

/** Periodic reminders and scheduled-task descriptions. */
export const REMINDERS_CHARS = 409;

/**
 * Observed chars-per-token ratio from prototype real-usage data.
 *
 * This is the divisor used to convert the module character constants into
 * approximate token counts. It comes from averaging actual `usage.input_tokens`
 * against raw character lengths on a large Claude Code session.
 */
const OBSERVED_RATIO = 1.1614;

/** Registry of known system-module character constants. */
const MODULE_CHARS: Record<string, number> = {
  sys_prompt: SYS_PROMPT_CHARS,
  tool_defs: TOOL_DEFS_CHARS,
  skills: SKILLS_CHARS,
  memory: MEMORY_CHARS,
  mcp: MCP_CHARS,
  reminders: REMINDERS_CHARS,
};

/**
 * Return an estimated token count for a known system module.
 *
 * Looks up the module's pre-measured character size and converts it to
 * tokens using the observed ratio from prototype data. If the key is not
 * recognized the function returns 0 rather than throwing, so callers can
 * safely probe optional modules.
 */
export function estimateModuleTokens(moduleKey: string): number {
  const chars = MODULE_CHARS[moduleKey];
  if (chars === undefined) return 0;
  return chars / OBSERVED_RATIO;
}
