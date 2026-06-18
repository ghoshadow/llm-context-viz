export const meta = {
  name: 'ontology-auto-extract',
  description: 'Implement automated ontology extraction with sharded parallel LLM + SSE progress',
  phases: [
    { title: 'Foundation', detail: 'Create provider.ts, prompt.ts, extract-session.ts, sse.ts' },
    { title: 'Orchestrator', detail: 'Create extract-ontology.ts coordinator' },
    { title: 'Integration', detail: 'Modify sessions.ts, store, UI, scripts' },
  ],
};

// ============================================================================
// Phase 1: Foundation — 4 independent new files in parallel
// ============================================================================
phase('Foundation');

const PROMPT_PROVIDER = `Create the file /Users/link/Documents/Anaconda/llm-context-viz/server/llm/provider.ts

This is a zero-dependency LLM provider that uses Node native fetch to call the Anthropic Messages API. The project uses ESM ("type": "module") and the API is compatible with DeepSeek endpoint at api.deepseek.com/anthropic.

Export a chat() function with signature:
  async function chat(system, messages, overrides)

Parameters:
- system: string - the system prompt
- messages: Array of {role: 'user'|'assistant', content: string}
- overrides (optional): {baseUrl?: string, apiKey?: string, model?: string}

Returns: Promise resolving to {text: string, usage: {input: number, output: number}}

Configuration from env vars:
- LLM_BASE_URL defaults to 'https://api.deepseek.com/anthropic'
- LLM_API_KEY is REQUIRED - throw clear error if not set
- LLM_MODEL defaults to 'deepseek-v4-pro'

Implementation:
1. Build URL: baseUrl + '/v1/messages'
2. POST with headers: Content-Type application/json, x-api-key the key, anthropic-version 2023-06-01
3. Request body: {model, max_tokens: 32000, system: [{type:'text', text: system}], messages: [{role:'user', content:[{type:'text', text: messageContent}]}]}
4. If messages array has multiple entries, include them all
5. Use AbortController with 300000ms timeout
6. Parse response: response.content[0].text for text, response.usage.input_tokens/output_tokens for usage
7. If !response.ok, throw with status and body text

Use Chinese for error messages (matching project style). Create the server/llm/ directory if needed. Write the complete file.`;

const PROMPT_PROMPT = `Create the file /Users/link/Documents/Anaconda/llm-context-viz/server/llm/prompt.ts

Extract the ontology extraction prompt template from the existing shell script into TypeScript. FIRST read /Users/link/Documents/Anaconda/llm-context-viz/scripts/extract-ontology.sh (especially lines 65-175) to understand the existing prompt template.

The module is ESM. Export TWO functions:

1. buildFullPrompt(content, meta) - Full prompt for first shard
2. buildCompactPrompt(content, meta) - Compact prompt for subsequent shards

Where meta is: {sessionId: string, partN: number, totalParts: number, turnRange: string, turnCount: number}

buildFullPrompt includes:
- Complete entity type definitions (7 types: mechanism/agent/system/error/func/code/command with key, label, description)
- Entity field specification (id, label, type, conf, firstTurn, turns, aliases, snippet, note)
- Relation field specification (s, t, label, firstTurn, conf)
- Output format: JSON with candidates[], relations[], config{}
- Shard context: "This is part N/M, containing turns X-Y only"
- Full extraction rules (source restriction, error-to-concept reclassification, disambiguation, relationship constraints)
- The actual session content appended at the end
- MUST end with instruction to output PURE JSON without markdown code blocks

buildCompactPrompt includes:
- Brief: "Follow the entity types and rules defined earlier. This is part N/M, turns X-Y."
- The actual session content
- Same JSON output instruction

Use Chinese for prompt text (matching extract-ontology.sh style). Create server/llm/ directory if needed. Write the complete file.`;

const PROMPT_EXTRACT = `Create the file /Users/link/Documents/Anaconda/llm-context-viz/server/content/extract-session.ts

Extract the core logic from /Users/link/Documents/Anaconda/llm-context-viz/scripts/extract-session-content.ts into a reusable ESM module. Read that file FIRST to understand the extraction logic.

Export TWO functions:

1. extractSessionContent(rawJsonl) - returns string
   This is the existing outputFromRaw logic moved here. Parse JSONL lines, extract user messages (skip pure tool_result), assistant thinking, assistant text replies. Format with turn markers.

2. extractContentWithTurns(rawJsonl) - returns TurnContent[]
   Same extraction but returns structured array:
   TurnContent = {turnNum: number, content: string}
   Where content is the formatted text for that turn: "=== TURN N (USER) ===\\n...\\n[THINK] ...\\n[REPLY] ..."

Implementation details from the existing script:
- Parse each line as JSON, check type field
- User message (type 'user', msg.role 'user'): extract text from msg.content (string or array of blocks)
- Skip if ALL content blocks are tool_result type
- Assistant (type 'assistant'): extract thinking blocks (block.thinking) and text blocks (block.text)
- A new turn starts with a user message that is NOT pure tool_result
- No truncation - extract everything
- Handle both string content and array-of-blocks format

Create server/content/ directory if needed. Write the complete file.`;

const PROMPT_SSE = `Create the file /Users/link/Documents/Anaconda/llm-context-viz/src/utils/sse.ts

A utility for consuming Server-Sent Events from a fetch ReadableStream. ESM module.

Export a single function:

async function consumeSSE(url, body, handlers, signal)

Parameters:
- url: string - the endpoint URL
- body: object - JSON request body (POSTed)
- handlers: object with optional callbacks:
  onStart(data), onShardStart(data), onShardDone(data), onShardRetry(data),
  onShardError(data), onMerge(data), onBuild(), onComplete(data), onError(data)
- signal (optional): AbortSignal

Implementation:
1. POST to url with headers: Content-Type application/json, Accept text/event-stream
2. If !response.ok, read error body and throw
3. Get response.body.getReader()
4. Create TextDecoder, accumulate chunks into a line buffer
5. Parse SSE format: lines starting with "event: " followed by "data: " followed by empty line
6. When a complete event is parsed, JSON.parse the data and call the appropriate handler
7. Handle chunk boundaries: incomplete lines should be buffered and completed on next chunk
8. If connection closes without 'complete' or 'error' event, call onError with a message

SSE event types to handle:
- "start" -> onStart({shards, totalTurns})
- "shard-start" -> onShardStart({shardIndex})
- "shard-done" -> onShardDone({shardIndex, candidates, relations})
- "shard-retry" -> onShardRetry({shardIndex, attempt})
- "shard-error" -> onShardError({shardIndex, error})
- "merge" -> onMerge({candidates, relations})
- "build" -> onBuild()
- "complete" -> onComplete({sessionId, meta, stats, data})
- "error" -> onError({stage, message, detail})

Write the complete file.`;

const [r1, r2, r3, r4] = await parallel([
  () => agent(PROMPT_PROVIDER, { label: 'provider.ts' }),
  () => agent(PROMPT_PROMPT, { label: 'prompt.ts' }),
  () => agent(PROMPT_EXTRACT, { label: 'extract-session.ts' }),
  () => agent(PROMPT_SSE, { label: 'sse.ts' }),
]);

log('Foundation: provider=' + !!r1 + ' prompt=' + !!r2 + ' extract=' + !!r3 + ' sse=' + !!r4);

// ============================================================================
// Phase 2: Orchestrator
// ============================================================================
phase('Orchestrator');

const PROMPT_ORCHESTRATOR = `Create the file /Users/link/Documents/Anaconda/llm-context-viz/server/llm/extract-ontology.ts

This is the main orchestrator. FIRST read these files to understand the interfaces:
- /Users/link/Documents/Anaconda/llm-context-viz/server/llm/provider.ts
- /Users/link/Documents/Anaconda/llm-context-viz/server/llm/prompt.ts
- /Users/link/Documents/Anaconda/llm-context-viz/server/content/extract-session.ts
- /Users/link/Documents/Anaconda/llm-context-viz/src/pipeline/build-ontology.ts
- /Users/link/Documents/Anaconda/llm-context-viz/src/types/ontology.ts

ESM module. Export:

interface ExtractSuccess {
  success: true;
  buildOutput: OntologyBuildOutput;
  shardStats: { total: number; succeeded: number; failed: number };
}

interface ExtractFailure {
  success: false;
  stage: 'content' | 'llm' | 'parse' | 'build' | 'store';
  message: string;
  detail?: string;
}

async function extractAndBuild(
  rawJsonl: string,
  sessionId: string,
  onEvent: (event: string, data: Record<string, unknown>) => void,
  options?: { shardSize?: number; overlap?: number; maxShards?: number },
): Promise<ExtractSuccess | ExtractFailure>

Implementation flow (6 steps):

STEP 1 - Extract: Call extractContentWithTurns(rawJsonl). If empty, return failure with stage 'content'. Fire onEvent('start', {shards, totalTurns}).

STEP 2 - Shard: Defaults shardSize=50, overlap=5, maxShards=20.
  effectiveSize = shardSize - overlap
  numShards = Math.min(maxShards, Math.ceil((totalTurns - overlap) / effectiveSize))
  For i in 0..numShards-1:
    startTurn = i * effectiveSize + 1
    endTurn = Math.min(startTurn + shardSize - 1, totalTurns)
    Select turns with turnNum in [startTurn, endTurn]
    Build shard object with turn content joined, turnRange string, index

STEP 3 - Parallel LLM: Promise.all over shards. For each shard:
  - Build prompt: index===0 ? buildFullPrompt(content, meta) : buildCompactPrompt(content, meta)
  - Call chat(systemPrompt, messages) from provider
  - Parse JSON from response text (see helper below)
  - If parse fails, retry up to 2 times with note "Please output pure JSON without markdown wrapping"
  - Fire onEvent('shard-done', {shardIndex, candidates, relations}) on success
  - Fire onEvent('shard-error', {shardIndex, error}) on final failure
  - Collect results

JSON parsing helper (inline):
  1. Try JSON.parse directly
  2. Try stripping triple-backtick-json wrapper (regex)
  3. Try stripping any triple-backtick wrapper
  4. Return null if all fail (trigger retry)

STEP 4 - Merge: Fire onEvent('merge', {candidates, relations}). Merge rules:
  - Candidates by id: keep highest conf, merge turns arrays (sort unique), merge aliases (unique), keep snippet from highest conf entry
  - Relations by [s,t,label].sort().join('::') key: keep highest conf, firstTurn = min
  - config.reclassify: shallow merge all shards, conflict -> last wins

STEP 5 - Build: Fire onEvent('build', {}). Call buildOntology({candidates: merged, relations: merged, config: merged}). If throws, return failure stage 'build'.

STEP 6 - Return: {success: true, buildOutput, shardStats: {total, succeeded, failed}}

Error handling:
- ALL shards fail LLM -> failure stage 'llm'
- ALL shards fail parse -> failure stage 'parse'
- Partial failures -> continue with successful ones, reflected in shardStats

Import paths: use .js extensions for ESM (e.g., './provider.js', '../../src/pipeline/build-ontology.js').

Create server/llm/ directory if needed. Write the complete file.`;

const r5 = await agent(PROMPT_ORCHESTRATOR, { label: 'extract-ontology.ts' });
log('Orchestrator: extract-ontology=' + !!r5);

// ============================================================================
// Phase 3: Integration — modify existing files
// ============================================================================
phase('Integration');

const PROMPT_REFACTOR_SCRIPT = `Refactor /Users/link/Documents/Anaconda/llm-context-viz/scripts/extract-session-content.ts to be a thin CLI wrapper.

Read the file first. Then:
1. REMOVE the outputFromRaw function entirely
2. ADD import: import { extractSessionContent } from '../server/content/extract-session.js';
3. In the file-path mode (arg.endsWith('.jsonl')), replace outputFromRaw(raw) with process.stdout.write(extractSessionContent(raw))
4. In the session-ID mode, replace outputFromRaw(session.raw_jsonl) with process.stdout.write(extractSessionContent(session.raw_jsonl)) and outputFromRaw(content) with process.stdout.write(extractSessionContent(content))
5. Keep all CLI argument parsing, DB reading, and error handling logic intact
6. The script must maintain identical CLI behavior

Use targeted Edit operations. Do NOT rewrite the entire file.`;

const PROMPT_ADD_ENDPOINT = `Add a new SSE endpoint POST /:id/ontology/extract to /Users/link/Documents/Anaconda/llm-context-viz/server/routes/sessions.ts

Read the ENTIRE file first. Pay attention to existing imports, patterns, and the existing /ontology/build handler.

INSERT the new endpoint AFTER the existing POST /:id/ontology/build handler (before the export default line).

The endpoint:
- Is async (unlike other handlers, because LLM calls are async)
- Sets SSE response headers: Content-Type text/event-stream, Cache-Control no-cache, Connection keep-alive, X-Accel-Buffering no
- Defines a send(event, data) helper: res.write("event: " + event + "\\ndata: " + JSON.stringify(data) + "\\n\\n")
- Gets session from DB, retrieves raw_jsonl (from DB or disk file like the extract script does)
- If no raw_jsonl available, sends error event and ends
- Dynamically imports extractAndBuild from ../llm/extract-ontology.js
- Calls extractAndBuild(rawJsonl, sessionId, send, {shardSize, overlap})
- On success: INSERT OR REPLACE into ontology table (same pattern as /build endpoint), send complete event
- On failure: send error event
- Always calls res.end() in finally block
- Wraps in try/catch with console.error (match existing style)
- Chinese error messages (match existing style)

Also check if 'fs' imports (existsSync, readFileSync) are already imported. If not, add them.

Use targeted Edit operations. Insert the new code before export default router.`;

const PROMPT_UPDATE_STORE = `Update /Users/link/Documents/Anaconda/llm-context-viz/src/store/sessionStore.ts to add extractOntology support.

Read the ENTIRE file first. Understand the existing patterns (imports, interface, initial state, actions).

ADDITIONS needed:

1. Add import at top: import { consumeSSE } from '../utils/sse.js';

2. Add to SessionStore interface (before the closing brace):
   extractOntology: (options?: { shardSize?: number; overlap?: number }) => Promise<boolean>;
   extractPhase: 'idle' | 'extracting' | 'merging' | 'building';
   extractProgress: { shardsTotal: number; shardsCompleted: number; shardDetails: Array<{ index: number; status: 'pending' | 'running' | 'done' | 'error'; candidates?: number; relations?: number; error?: string }> };
   extractError: string | null;

3. Add initial state values:
   extractPhase: 'idle' as const,
   extractProgress: { shardsTotal: 0, shardsCompleted: 0, shardDetails: [] },
   extractError: null,

4. Add the extractOntology implementation (in the actions object returned to create):
   - Get currentSessionId from getState()
   - Reset extractPhase to 'extracting', clear extractError
   - Initialize shardDetails array (will be populated by SSE events)
   - Call consumeSSE('/sessions/' + currentSessionId + '/ontology/extract', { shardSize, overlap }, { event handlers })
   - Event handlers update the store in real-time:
     onStart: set extractProgress with shardsTotal, init shardDetails with pending entries
     onShardDone: update extractProgress.shardsCompleted, update shardDetails entry
     onShardError: update shardDetails entry with error
     onMerge: set extractPhase to 'merging'
     onBuild: set extractPhase to 'building'
     onComplete: call getState().fetchOntology(), reset extractPhase to 'idle'
     onError: set extractError, reset extractPhase to 'idle'
   - Return true on complete, false on error
   - Wrap in try/catch

Use targeted Edit operations for each section.`;

const PROMPT_UPDATE_UI = `Update /Users/link/Documents/Anaconda/llm-context-viz/src/components/ontology/OntologyPage.tsx to add the auto-extract UI.

Read the ENTIRE file first. Understand the existing component structure, imports, state, and the empty state render section (where !ontologyData branch renders).

ADDITIONS needed:

1. Add destructured values from useSessionStore:
   - extractOntology
   - extractPhase
   - extractProgress
   - extractError

2. Add local state: shardSize (default 50), overlap (default 5)

3. In the empty state section (!ontologyData), add a NEW auto-extract card ABOVE the existing manual build form. Structure:

   A card with border, rounded corners, dark background matching project theme. Contains:

   a) Header: icon + "自动提取" title + description text "从会话内容中自动抽取实体和关系，分片并行调用 LLM 并实时返回进度。"

   b) Parameter inputs (inline, compact):
      "分片大小" number input (default 50)
      "重叠" number input (default 5)

   c) Start button: prominent accent color, shows "开始自动提取"
      Disabled when extractPhase !== 'idle'
      onClick calls extractOntology({ shardSize, overlap })

   d) Progress section (only shown when extractPhase !== 'idle'):
      - Phase text: extracting → "正在提取实体 (N/M 分片)" | merging → "正在合并结果..." | building → "正在构建图谱..."
      - Progress bar: full-width, colored fill with percentage width
      - Shard detail list: each shard shown with icon (checkmark/spinner/dot) and detail text
      - If extractError: red error text with retry button

   e) The EXISTING manual build form should remain below, collapsed by default

STYLING: Match the existing project style exactly:
- Use SEMANTIC tokens from '../../styles/theme' for colors
- Use inline styles (the project convention)
- Dark theme with oklch colors
- IBM Plex Sans for text, IBM Plex Mono for numbers
- Existing accent color: oklch(0.74 0.12 165) green/teal
- Use flexbox for layout

Use targeted Edit operations. Do NOT rewrite the entire 662-line file — make targeted additions to the existing empty state render block.`;

const [r6, r7, r8, r9] = await parallel([
  () => agent(PROMPT_REFACTOR_SCRIPT, { label: 'refactor-extract-script' }),
  () => agent(PROMPT_ADD_ENDPOINT, { label: 'add-extract-endpoint' }),
  () => agent(PROMPT_UPDATE_STORE, { label: 'update-session-store' }),
  () => agent(PROMPT_UPDATE_UI, { label: 'update-ontology-page' }),
]);

log('Integration: script=' + !!r6 + ' endpoint=' + !!r7 + ' store=' + !!r8 + ' ui=' + !!r9);
log('All phases complete. Verify with: cd /Users/link/Documents/Anaconda/llm-context-viz && npm run server');
