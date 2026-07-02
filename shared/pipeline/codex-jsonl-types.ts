export type JsonObject = Record<string, unknown>;

export interface CodexLine {
  order: number;
  timestamp: string;
  type: string;
  payload: JsonObject;
}

export interface TokenUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
}

export interface CodexTurn {
  turnId: string;
  startTs: string;
  endTs: string;
  prompt: string;
  model: string;
  contextLimit: number;
  events: CodexLine[];
  tokenUsages: Array<{ line: CodexLine; usage: TokenUsage }>;
  durationMs?: number;
  aborted?: boolean;
  compacted?: boolean;
}

export interface ToolCall {
  callId: string;
  name: string;
  input: string;
  ts: string;
  order: number;
}

export interface ToolResult {
  callId: string;
  output: string;
  ts: string;
  order: number;
  isError: boolean;
  durationMs?: number;
}
