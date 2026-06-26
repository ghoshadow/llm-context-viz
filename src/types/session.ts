// ============================================================================
// JSONL Line Types — Claude Code session transcript lines
// ============================================================================

export type LineType =
  | 'assistant'
  | 'user'
  | 'system'
  | 'attachment'
  | 'mode'
  | 'permission-mode'
  | 'ai-title'
  | 'last-prompt'
  | 'file-history-snapshot'
  | 'task_reminder'
  | 'Project'
  | 'nested_memory';

// --- Message content blocks ---

export interface ThinkingContent {
  type: 'thinking';
  thinking: string;
  signature: string;
}

export interface RedactedThinkingContent {
  type: 'redacted_thinking';
  /** Base64-encoded encrypted thinking data.  Not human-readable. */
  data: string;
}

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ToolUseContent {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown> | object;
}

export type MessageContent = ThinkingContent | RedactedThinkingContent | TextContent | ToolUseContent;

// --- Base session line ---

export interface SessionLine {
  type: LineType;
  uuid: string;
  parentUuid?: string;
  timestamp: string;
  sessionId: string;
  cwd?: string;
  gitBranch?: string;
}

// --- Assistant line ---

export interface AssistantMessage {
  model: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  content: MessageContent[];
  stop_reason: string;
}

export interface AssistantLine extends SessionLine {
  type: 'assistant';
  message: AssistantMessage;
}

// --- System line ---

export interface SystemLine extends SessionLine {
  type: 'system';
  /** Subtype discriminator for system events. */
  subtype: string;
  /** Arbitrary event payload (content varies by subtype). */
  message?: unknown;
}

// --- User line (content blocks for multimodal) ---

export interface ContentBlockText {
  type: 'text';
  text: string;
}

export interface ContentBlockImage {
  type: 'image';
  source: {
    type: 'base64' | 'url';
    media_type: string;
    data: string;
  };
}

export interface ContentBlockToolResult {
  type: 'tool_result';
  tool_use_id: string;
  content: string | ContentBlock[];
  is_error?: boolean;
}

export type ContentBlock = ContentBlockText | ContentBlockImage | ContentBlockToolResult;

export interface UserLine extends SessionLine {
  type: 'user';
  message: {
    role: 'user';
    content: string | ContentBlock[];
  };
  promptId?: string;
}

// ============================================================================
// Processed Data Types — pipeline output (context categorization)
// ============================================================================

/** Group classification for a context category. */
export type CategoryGroup = 'io' | 'convo' | 'core';

export interface ContextCategory {
  key: string;
  label: string;
  group: CategoryGroup;
  /** Whether the token count is estimated rather than exact. */
  estimated: boolean;
  tokens: number;
  /** Raw character/byte count before tokenization. */
  raw: number;
}

export interface SeriesPoint {
  /** Request index. */
  i: number;
  /** Cumulative assembled context tokens at this request. */
  assembled: number;
  /** Billed input tokens for this request. */
  input: number;
  /** Output tokens generated for this request. */
  output: number;
}

export interface ToolAggregation {
  name: string;
  calls: number;
  resultTokens: number;
  task: boolean;
}

export interface SessionSummary {
  session: {
    model: string;
    version: string;
    cwd: string;
    aiTitle?: string;
    requests: number;
    peakIndex: number;
    peakTokens: number;
    peakCacheHit: number;
    peakTurnIdx: number;
    peakStep: number;
    totalOutput: number;
    contextLimit: number;
  };
  categories: ContextCategory[];
  series: SeriesPoint[];
  tools: ToolAggregation[];
}

// ============================================================================
// Turn Grouping — pipeline stage 1 output
// ============================================================================

export interface TurnGroup {
  /** 1-based turn index. */
  turnIndex: number;
  /** The initiating user message that starts this turn. */
  userLine: UserLine;
  /** All assistant responses in this turn. */
  asstLines: AssistantLine[];
  /** System events between the user message and end of turn. */
  systemLines: SystemLine[];
  /** Tool-result user messages that arrive between assistant responses. */
  toolResultLines: UserLine[];
  /** System attachments (skill_listing, task_reminder, etc.) not in systemLines. */
  attachmentLines?: Array<{ type: string; content: any; timestamp: string }>;
  /** First event timestamp (ISO). */
  startTs: string;
  /** Last event timestamp (ISO). */
  endTs: string;
}

// ============================================================================
// Turn Types — granular per-turn breakdown
// ============================================================================

export type SegmentKind = 'm' | 't' | 's' | 'i';

export interface ToolCallDetail {
  name: string;
  input: string;
  tok: number;
}

export interface SegmentDetail {
  think?: string;
  thinkTok?: number;
  text?: string;
  textTok?: number;
  calls?: ToolCallDetail[];
  inTok?: number;
  outTok?: number;
  name?: string;
  input?: string;
  result?: string;
  resultTok?: number;
  isError?: boolean;
  subAgents?: { file: string; model: string; prompt: string; asstCount: number; durMs: number; toolCalls: string[] }[];
  /** Cumulative tools snapshot at this step (t-type / s-type only). */
  stepTools?: Record<string, { calls: number; resultTokens: number; task: boolean }>;
}

export interface TimelineSegment {
  k: SegmentKind;
  n: string;
  ms: number;
  ts: string;
  det: SegmentDetail;
}

export interface TurnDelta {
  thinking?: number;
  asstText?: number;
  toolCalls?: number;
  toolResults?: number;
  userMsgs?: number;
  subagent?: number;
}

/** Alias for TurnData used by the timeline stage and session aggregation. */
export type TimelineResult = TurnData;

export interface TurnData {
  /** Zero-based turn index. */
  i: number;
  /** User prompt text. */
  prompt: string;
  /** ISO timestamp. */
  ts: string;
  /** Number of assistant API requests in this turn. */
  asstReqs: number;
  /** Max context-window input tokens at turn end. */
  maxInput: number;
  /** Cache hit tokens at the peak request of this turn. */
  maxCacheHit?: number;
  /** 0-based index of the peak request within this turn. */
  maxReqIdx?: number;
  maxReqStep?: number;
  /** Output tokens consumed in this turn. */
  outTok: number;
  /** Tool name -> call count. */
  tools: Record<string, number>;
  /** Token delta breakdown by category. */
  delta: TurnDelta;
  /** Total wall-clock duration in ms. */
  durMs: number;
  /** Time spent in model inference (ms). */
  modelMs: number;
  /** Time spent in tool execution (ms). */
  toolMs: number;
  /** Time spent in sub-agent work (ms). */
  subMs: number;
  /** Number of assistant steps/requests. */
  stepCount: number;
  /** Longest single segment. */
  longest: {
    k: string;
    n: string;
    ms: number;
  };
  /** Ordered timeline segments. */
  segs: TimelineSegment[];
  /** Cumulative context composition by category key -> tokens. */
  comp: Record<string, number>;
  /** Cache hit from the last request (for cum_total display). */
  cumCacheHit?: number;
  cumTools?: Record<string, { calls: number; resultTokens: number; task: boolean }>;
  /** Cumulative total context tokens at turn end. */
  cumTotal: number;
  /** True when context compression was detected at this turn boundary
   *  (cumTotal dropped >50% after summarization). */
  compressionReset?: boolean;
}

// ============================================================================
// API Types — server-side REST responses
// ============================================================================

export interface SessionListItem {
  id: string;
  filename: string;
  source?: 'claude' | 'codex';
  model: string;
  version: string;
  ai_title?: string;
  total_requests: number;
  peak_tokens: number;
  peak_cache_hit?: number;
  turn_count: number;
  created_at: string;
}

export interface SessionDetail extends SessionListItem {
  cwd: string;
  peak_index: number;
  total_output: number;
  context_limit: number;
  raw_size: number;
  categories: ContextCategory[];
  tools: ToolAggregation[];
  series: SeriesPoint[];
}

export interface TurnSummary {
  id: string;
  turn_index: number;
  prompt: string;
  timestamp: string;
  asst_reqs: number;
  max_input: number;
  max_cache_hit?: number;
  max_req_idx?: number;
  max_req_step?: number;
  cum_cache_hit?: number;
  out_tok: number;
  cum_total: number;
  dur_ms: number;
  step_count: number;
  compression_reset?: boolean;
}

export interface TurnDetail extends TurnSummary {
  model_ms: number;
  tool_ms: number;
  sub_ms: number;
  comp: Record<string, number>;
  delta: Record<string, number>;
  tools: Record<string, number>;
  segs: TimelineSegment[];
  longest: { k: string; n: string; ms: number };
}
