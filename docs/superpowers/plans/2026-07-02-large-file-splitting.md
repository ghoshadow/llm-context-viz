# Large File Splitting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the highest-value files over 500 lines into focused modules without changing runtime behavior or public imports.

**Architecture:** Keep existing public entry files stable and move internal units behind them. Start with low-risk React component splits, then pure graph layout extraction, then shared Codex pipeline extraction, then ontology extraction backend extraction. Each task must be behavior-preserving and verified before moving to the next.

**Tech Stack:** TypeScript, React 19, Vite, Node test runner with `tsx`, Express backend, existing project scripts in `package.json`.

---

## Scope

This plan covers the files marked "建议拆" in `CC_CLI_PROGRESSING/file-lines-by-architecture-2026-07-02.md`:

- `src/components/pages/turnInspectorPanels.tsx`
- `src/components/ontology/OntologyGraph.tsx`
- `shared/pipeline/codex-jsonl.ts`
- `server/llm/extract-ontology.ts`
- `src/components/ontology/OntologySelectedEntity.tsx`
- `src/components/shared/MarkdownBlock.tsx`
- `src/components/pages/CalibratePage.tsx`

Do not change UI copy, API response shapes, exported public functions, database schema, or visual styling unless required to keep extracted code compiling.

## File Structure Target

### Turn Inspector Panels

- Keep: `src/components/pages/turnInspectorPanels.tsx`
  - Responsibility: compatibility barrel re-export for existing imports.
- Create: `src/components/pages/turn-inspector/TurnListItem.tsx`
  - Responsibility: one turn row in the inspector sidebar.
- Create: `src/components/pages/turn-inspector/ContextStructure.tsx`
  - Responsibility: context composition tree/structure panel.
- Create: `src/components/pages/turn-inspector/ExecutionTimeline.tsx`
  - Responsibility: timeline segment rendering and selected step detail panel wiring.
- Create: `src/components/pages/turn-inspector/DeltaPanel.tsx`
  - Responsibility: per-turn token delta summary.
- Create: `src/components/pages/turn-inspector/ToolUsagePanel.tsx`
  - Responsibility: cumulative tool usage panel.

### Ontology Graph

- Keep: `src/components/ontology/OntologyGraph.tsx`
  - Responsibility: React interaction, scrolling/focus, SVG rendering.
- Create: `src/components/ontology/ontologyGraphLayout.ts`
  - Responsibility: layout types, constants, `edgeKey`, `truncate`, `rectPort`, `makeEdgePath`, `buildOntologyGraphLayout`.
- Create: `src/components/ontology/ontologyGraphLayout.test.ts`
  - Responsibility: one small layout regression check for visible node/edge output.

### Codex JSONL Pipeline

- Keep: `shared/pipeline/codex-jsonl.ts`
  - Responsibility: public `isCodexJsonl` and `runCodexPipeline` orchestration.
- Create: `shared/pipeline/codex-jsonl-types.ts`
  - Responsibility: internal `JsonObject`, `CodexLine`, `TokenUsage`, `CodexTurn`, `ToolCall`, `ToolResult`.
- Create: `shared/pipeline/codex-jsonl-parser.ts`
  - Responsibility: `parseCodexLines`, `firstPayload`, `isObject`, text conversion helpers, duration helper.
- Create: `shared/pipeline/codex-jsonl-turns.ts`
  - Responsibility: `buildCodexTurns` and `finalizeTurn`.
- Create: `shared/pipeline/codex-jsonl-segments.ts`
  - Responsibility: `buildSegments`, tool call/result collection, token metric helpers, duration assignment.
- Create: `shared/pipeline/codex-jsonl-summary.ts`
  - Responsibility: category metadata, context composition helpers, `assembleTurns`, `aggregateCodexSession`.

### Ontology Extraction Backend

- Keep: `server/llm/extract-ontology.ts`
  - Responsibility: public types and `extractAndBuild` high-level orchestration.
- Create: `server/llm/ontology-response-parser.ts`
  - Responsibility: JSON extraction from agent output, validation error formatting, tool result text extraction.
- Create: `server/llm/ontology-shard-collector.ts`
  - Responsibility: Agent SDK query loop and shard text result collection.
- Create: `server/llm/ontology-merge.ts`
  - Responsibility: shard result merge, aggregate construction, similar label merge, label similarity.
- Create: `server/llm/ontology-confidence.ts`
  - Responsibility: evidence weighting, status inference, evidence normalization, confidence computation, label deduplication, snippet quality.

### Ontology Selected Entity

- Keep: `src/components/ontology/OntologySelectedEntity.tsx`
  - Responsibility: selected entity container and section composition.
- Create: `src/components/ontology/useEntitySummary.ts`
  - Responsibility: summary status loading, generation, edit/save, polling.
- Create: `src/components/ontology/useObsidianCardSync.ts`
  - Responsibility: Obsidian config/status loading, config save, card sync.
- Create: `src/components/ontology/EntitySummarySection.tsx`
  - Responsibility: topic summary button, summary display, summary edit form.
- Create: `src/components/ontology/EntityEvidenceSection.tsx`
  - Responsibility: confidence notes and ordered evidence rendering.
- Create: `src/components/ontology/EntityRelationsSection.tsx`
  - Responsibility: related edge list rendering and node selection.
- Create: `src/components/ontology/ObsidianActionsSection.tsx`
  - Responsibility: Obsidian config form and sync controls.

### Markdown Block

- Keep: `src/components/shared/MarkdownBlock.tsx`
  - Responsibility: public `MarkdownBlock`, `CodeBlock`, and `renderInlineMarkdown` exports.
- Create: `src/components/shared/markdownInline.tsx`
  - Responsibility: `renderInlineMarkdown`.
- Create: `src/components/shared/MarkdownCodeBlock.tsx`
  - Responsibility: syntax highlighter language registration and code block rendering.
- Create: `src/components/shared/MarkdownDiffFileBlock.tsx`
  - Responsibility: side-by-side diff rendering helpers and `DiffFileBlock`.
- Create: `src/components/shared/markdownTable.tsx`
  - Responsibility: table parsing helpers and table row rendering styles.

### Calibration Page

- Keep: `src/components/pages/CalibratePage.tsx`
  - Responsibility: page composition and top-level state wiring.
- Create: `src/components/pages/useCurrentCalibrationConstants.ts`
  - Responsibility: current constants fetch by cwd/source.
- Create: `src/components/pages/useAutoCalibrationJob.ts`
  - Responsibility: auto calibration start/cancel/poll lifecycle.
- Create: `src/components/pages/useCalibrationDetailTranslation.ts`
  - Responsibility: detail modal translation lookup, manual translate, copy handling.

---

### Task 1: Split Turn Inspector Panels

**Files:**
- Create: `src/components/pages/turn-inspector/TurnListItem.tsx`
- Create: `src/components/pages/turn-inspector/ContextStructure.tsx`
- Create: `src/components/pages/turn-inspector/ExecutionTimeline.tsx`
- Create: `src/components/pages/turn-inspector/DeltaPanel.tsx`
- Create: `src/components/pages/turn-inspector/ToolUsagePanel.tsx`
- Modify: `src/components/pages/turnInspectorPanels.tsx`
- Verify: `src/components/pages/TurnInspector.tsx`

- [ ] **Step 1: Snapshot current exports and imports**

Run:

```bash
rg -n "from './turnInspectorPanels'|export function" src/components/pages/TurnInspector.tsx src/components/pages/turnInspectorPanels.tsx
```

Expected: `TurnInspector.tsx` imports `ContextStructure`, `DeltaPanel`, `ExecutionTimeline`, `ToolUsagePanel`, `TurnListItem`; `turnInspectorPanels.tsx` exports those five components.

- [ ] **Step 2: Move `TurnListItem` into its own file**

Create `src/components/pages/turn-inspector/TurnListItem.tsx` by moving:

- `COLLAPSED_H` is not needed here.
- `TurnListItemProps`
- `TurnListItem`

Use these imports:

```tsx
import { SEMANTIC, SELECTED_ITEM, UNSELECTED_ITEM } from '../../../styles/theme';
import { fmtK } from '../../../utils/format';
import { getStructuredTextPreview } from '../../shared/structuredText';
```

Remove the moved declarations from `src/components/pages/turnInspectorPanels.tsx`.

- [ ] **Step 3: Move `ContextStructure` into its own file**

Create `src/components/pages/turn-inspector/ContextStructure.tsx` by moving:

- `ContextStructureProps`
- `ContextStructure`

Use these imports:

```tsx
import { COLORS, LABELS, SEMANTIC, OVERFLOW, OK_STATE } from '../../../styles/theme';
import { fmt, fmtK } from '../../../utils/format';
import { CHARS_PER_TOKEN } from '../../../pipeline/utils';
```

Remove the moved declarations from `src/components/pages/turnInspectorPanels.tsx`.

- [ ] **Step 4: Move `ExecutionTimeline` into its own file**

Create `src/components/pages/turn-inspector/ExecutionTimeline.tsx` by moving:

- `COLLAPSED_H`
- `ExecutionTimelineProps`
- `ExecutionTimeline`

Use these imports:

```tsx
import { useMemo } from 'react';
import { SEMANTIC, STEP_SELECTED, STEP_COLORS } from '../../../styles/theme';
import { fmtDur, fmtK } from '../../../utils/format';
import type { TimelineSegment } from '../../../types/session';
import { isTaskName, segColor } from '../turnInspectorLogic';
import { TurnStepDetailPanel } from '../TurnStepDetailPanel';
```

Remove the moved declarations from `src/components/pages/turnInspectorPanels.tsx`.

- [ ] **Step 5: Move `DeltaPanel` and `ToolUsagePanel` into their own files**

Create `src/components/pages/turn-inspector/DeltaPanel.tsx` by moving:

- `DeltaPanelProps`
- `DELTA_KEYS_ORDER`
- `DeltaPanel`

Use these imports:

```tsx
import { DELTA_LABELS, SEMANTIC } from '../../../styles/theme';
import { fmtK } from '../../../utils/format';
```

Create `src/components/pages/turn-inspector/ToolUsagePanel.tsx` by moving:

- `ToolUsagePanelProps`
- `ToolUsagePanel`

Use these imports:

```tsx
import { SEMANTIC } from '../../../styles/theme';
import { fmtK } from '../../../utils/format';
```

Remove the moved declarations from `src/components/pages/turnInspectorPanels.tsx`.

- [ ] **Step 6: Convert `turnInspectorPanels.tsx` to a compatibility barrel**

Replace `src/components/pages/turnInspectorPanels.tsx` with:

```tsx
export { TurnListItem } from './turn-inspector/TurnListItem';
export { ContextStructure } from './turn-inspector/ContextStructure';
export { ExecutionTimeline } from './turn-inspector/ExecutionTimeline';
export { DeltaPanel } from './turn-inspector/DeltaPanel';
export { ToolUsagePanel } from './turn-inspector/ToolUsagePanel';
```

- [ ] **Step 7: Verify TypeScript and app build**

Run:

```bash
npm run build
```

Expected: command exits 0. If TypeScript reports missing imports, add only the imports needed by the extracted component.

- [ ] **Step 8: Commit**

```bash
git add src/components/pages/turnInspectorPanels.tsx src/components/pages/turn-inspector
git commit -m "refactor(ui): split turn inspector panels"
```

### Task 2: Extract Ontology Graph Layout

**Files:**
- Create: `src/components/ontology/ontologyGraphLayout.ts`
- Create: `src/components/ontology/ontologyGraphLayout.test.ts`
- Modify: `src/components/ontology/OntologyGraph.tsx`

- [ ] **Step 1: Add a failing layout test**

Create `src/components/ontology/ontologyGraphLayout.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOntologyGraphLayout } from './ontologyGraphLayout';

test('builds visible ontology graph layout with selected neighbors', () => {
  const layout = buildOntologyGraphLayout({
    data: {
      types: [{ key: 'topic', label: 'Topic', color: 'red' }],
      nodes: [
        { id: 'a', type: 'topic', label: 'Alpha', aliases: [], turns: [1], firstTurn: 1, conf: 0.9, status: 'confirmed', evidence: [], snippet: '' },
        { id: 'b', type: 'topic', label: 'Beta', aliases: [], turns: [2], firstTurn: 2, conf: 0.8, status: 'confirmed', evidence: [], snippet: '' },
      ],
      edges: [{ s: 'a', t: 'b', label: 'relates', conf: 0.7, firstTurn: 2, evidence: [] }],
      aggregates: [],
    },
    activeTypes: { topic: true },
    turn: 2,
    selectedNodeId: 'a',
  });

  assert.equal(layout.nodes.length, 2);
  assert.equal(layout.edges.length, 1);
  assert.equal(layout.neighborSet.has('b'), true);
});
```

- [ ] **Step 2: Run the new test and confirm it fails**

Run:

```bash
node --import tsx --test src/components/ontology/ontologyGraphLayout.test.ts
```

Expected: FAIL because `./ontologyGraphLayout` does not exist.

- [ ] **Step 3: Move layout types and pure functions**

Create `src/components/ontology/ontologyGraphLayout.ts` by moving from `OntologyGraph.tsx`:

- `LayoutAggregate`
- `LayoutLane`
- `LayoutNode`
- `LayoutEdge`
- `GraphLayout`
- layout constants
- `edgeKey`
- `truncate`
- `rectPort`
- `makeEdgePath`
- `buildLayout`

Rename `buildLayout` to `buildOntologyGraphLayout` and export these symbols:

```ts
export type { LayoutAggregate, LayoutLane, LayoutNode, LayoutEdge, GraphLayout };
export { edgeKey, truncate, makeEdgePath, buildOntologyGraphLayout };
```

The exported function signature must accept one object argument:

```ts
export function buildOntologyGraphLayout({
  data,
  activeTypes,
  turn,
  selectedNodeId,
}: {
  data: OntologyData;
  activeTypes: Record<string, boolean>;
  turn: number;
  selectedNodeId: string | null;
}): GraphLayout
```

- [ ] **Step 4: Update `OntologyGraph.tsx` imports and callsite**

In `src/components/ontology/OntologyGraph.tsx`, import:

```tsx
import {
  buildOntologyGraphLayout,
  edgeKey,
  makeEdgePath,
  type LayoutEdge,
} from './ontologyGraphLayout';
```

Replace the existing `buildLayout(data, activeTypes, turn, selectedNodeId)` call with:

```tsx
buildOntologyGraphLayout({ data, activeTypes, turn, selectedNodeId })
```

Remove moved layout declarations from `OntologyGraph.tsx`.

- [ ] **Step 5: Run targeted and full verification**

Run:

```bash
node --import tsx --test src/components/ontology/ontologyGraphLayout.test.ts
npm run build
```

Expected: both commands exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/components/ontology/OntologyGraph.tsx src/components/ontology/ontologyGraphLayout.ts src/components/ontology/ontologyGraphLayout.test.ts
git commit -m "refactor(ui): extract ontology graph layout"
```

### Task 3: Split Codex JSONL Pipeline Internals

**Files:**
- Create: `shared/pipeline/codex-jsonl-types.ts`
- Create: `shared/pipeline/codex-jsonl-parser.ts`
- Create: `shared/pipeline/codex-jsonl-turns.ts`
- Create: `shared/pipeline/codex-jsonl-segments.ts`
- Create: `shared/pipeline/codex-jsonl-summary.ts`
- Modify: `shared/pipeline/codex-jsonl.ts`
- Verify: `src/pipeline/codex-jsonl.test.ts`

- [ ] **Step 1: Run baseline Codex pipeline tests**

Run:

```bash
node --import tsx --experimental-test-module-mocks --test src/pipeline/codex-jsonl.test.ts
```

Expected: PASS before refactor.

- [ ] **Step 2: Extract internal types**

Create `shared/pipeline/codex-jsonl-types.ts` containing the existing internal types:

```ts
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
```

Remove those type declarations from `shared/pipeline/codex-jsonl.ts` and import them as types.

- [ ] **Step 3: Extract parser helpers**

Create `shared/pipeline/codex-jsonl-parser.ts` and move:

- `parseCodexLines`
- `firstPayload`
- `isToolCallPayload`
- `toolNameFor`
- `stringifyInput`
- `outputToText`
- `textFromCodexContent`
- `textFromCodexContentBlock`
- `textFromCodexReasoningSummary`
- `durationToMs`
- `msBetween`
- `numberOrZero`
- `isObject`

Export all moved functions that are used by other split modules. Keep their bodies byte-for-byte where possible.

- [ ] **Step 4: Extract turn construction**

Create `shared/pipeline/codex-jsonl-turns.ts` and move:

- `buildCodexTurns`
- `finalizeTurn`

Import `textFromCodexContent`, `durationToMs`, and `isObject` from `codex-jsonl-parser.ts`.

- [ ] **Step 5: Extract segment construction**

Create `shared/pipeline/codex-jsonl-segments.ts` and move:

- `buildSegments`
- `collectToolCalls`
- `collectToolResults`
- `computeTokenMetrics`
- `computeSegmentMetrics`
- `assignDurations`
- `nearestInputTokens`
- `nearestOutputTokens`
- `nearestReasoningTokens`
- `nearestUsage`
- `findPeakStep`

Import shared helpers from `codex-jsonl-parser.ts`, internal types from `codex-jsonl-types.ts`, and existing utilities from `./utils`.

- [ ] **Step 6: Extract summary and context composition**

Create `shared/pipeline/codex-jsonl-summary.ts` and move:

- `CATEGORY_META`
- `EMPTY_COMP_KEYS`
- `assembleTurns`
- `aggregateCodexSession`
- `initComp`
- `addTokens`
- `addTokenCount`
- `deltaBetween`
- `sumComp`
- `buildCodexCoreComp`
- `applyCodexCalibrationFallback`
- `codexInstructionText`
- `codexDeveloperCategory`
- `incrementTool`
- `addToolResultTokens`
- `cloneTools`
- `firstTurnCwd`

Import `buildSegments` from `codex-jsonl-segments.ts` and parser helpers/types as needed.

- [ ] **Step 7: Reduce public entry file**

Update `shared/pipeline/codex-jsonl.ts` so it imports split helpers and only contains:

- imports
- `isCodexJsonl`
- `runCodexPipeline`

Keep `isCodexJsonl` body unchanged unless it needs `isObject` imported from `codex-jsonl-parser.ts`.

- [ ] **Step 8: Run Codex pipeline and build verification**

Run:

```bash
node --import tsx --experimental-test-module-mocks --test src/pipeline/codex-jsonl.test.ts
npm run build
```

Expected: both commands exit 0.

- [ ] **Step 9: Commit**

```bash
git add shared/pipeline/codex-jsonl.ts shared/pipeline/codex-jsonl-*.ts
git commit -m "refactor(pipeline): split codex jsonl internals"
```

### Task 4: Split Ontology Extraction Backend

**Files:**
- Create: `server/llm/ontology-response-parser.ts`
- Create: `server/llm/ontology-shard-collector.ts`
- Create: `server/llm/ontology-merge.ts`
- Create: `server/llm/ontology-confidence.ts`
- Modify: `server/llm/extract-ontology.ts`

- [ ] **Step 1: Run baseline backend tests**

Run:

```bash
npm test
```

Expected: PASS before refactor.

- [ ] **Step 2: Extract response parser**

Create `server/llm/ontology-response-parser.ts` and move:

- `parseJsonFromText`
- `formatValidationError`
- `toOntologyEvidence`
- `collectParsedItems`
- `textFromToolResultContent`

Export all five functions. Keep function bodies unchanged.

- [ ] **Step 3: Extract shard collector**

Create `server/llm/ontology-shard-collector.ts` and move:

- `LLM_EXTRACTION_TIMEOUT_MS`
- `collectShardTextResults`

Also move/import the needed type dependencies. Export:

```ts
export async function collectShardTextResults(...)
```

Keep `ShardError` exported from `extract-ontology.ts` for compatibility, or move it to `ontology-shard-collector.ts` and re-export it from `extract-ontology.ts`:

```ts
export type { ShardError } from './ontology-shard-collector.js';
```

- [ ] **Step 4: Extract merge helpers**

Create `server/llm/ontology-merge.ts` and move:

- `Aggregate`
- `buildAggregates`
- `mergeSimilarAggregates`
- `mergeResults`
- `jaccardSimilarity`

Export `buildAggregates`, `mergeResults`, and `jaccardSimilarity`.

- [ ] **Step 5: Extract confidence helpers**

Create `server/llm/ontology-confidence.ts` and move:

- `EVIDENCE_WEIGHT_CAP`
- `evidenceWeight`
- `evidenceScore`
- `inferStatus`
- `normalizeEvidence`
- `nodeShardCount`
- `snippetSupportsLabel`
- `computeConf`
- `dedupByLabel`
- `checkSnippetQuality`

Export the functions used by `extract-ontology.ts`: `inferStatus`, `normalizeEvidence`, `computeConf`, `dedupByLabel`, `checkSnippetQuality`.

- [ ] **Step 6: Update `extract-ontology.ts` imports**

Import the extracted helpers into `server/llm/extract-ontology.ts`:

```ts
import { collectShardTextResults } from './ontology-shard-collector.js';
import { buildAggregates, mergeResults } from './ontology-merge.js';
import { computeConf, dedupByLabel, inferStatus, normalizeEvidence, checkSnippetQuality } from './ontology-confidence.js';
```

Remove moved declarations from `extract-ontology.ts`. Preserve exported public types: `ShardResult`, `ShardError`, `ExtractSuccess`, `ExtractFailure`, `ExtractResult`, `extractAndBuild`.

- [ ] **Step 7: Run backend and build verification**

Run:

```bash
npm test
npm run build
```

Expected: both commands exit 0.

- [ ] **Step 8: Commit**

```bash
git add server/llm/extract-ontology.ts server/llm/ontology-*.ts
git commit -m "refactor(llm): split ontology extraction internals"
```

### Task 5: Split Ontology Selected Entity

**Files:**
- Create: `src/components/ontology/useEntitySummary.ts`
- Create: `src/components/ontology/useObsidianCardSync.ts`
- Create: `src/components/ontology/EntitySummarySection.tsx`
- Create: `src/components/ontology/EntityEvidenceSection.tsx`
- Create: `src/components/ontology/EntityRelationsSection.tsx`
- Create: `src/components/ontology/ObsidianActionsSection.tsx`
- Modify: `src/components/ontology/OntologySelectedEntity.tsx`

- [ ] **Step 1: Run build baseline**

Run:

```bash
npm run build
```

Expected: PASS before refactor.

- [ ] **Step 2: Extract summary hook**

Create `src/components/ontology/useEntitySummary.ts` by moving summary state and handlers from `OntologySelectedEntity.tsx`:

- `SummaryStatus`
- `CardSummaryStatus`
- `loadSummaryStatus`
- `handleGenerateSummary`
- `handleEditSummary`
- `handleCancelSummaryEdit`
- `handleSaveSummary`
- polling effect for running summaries

Expose a hook:

```ts
export function useEntitySummary({
  sessionId,
  nodeId,
  nodeType,
}: {
  sessionId: string | null;
  nodeId: string;
  nodeType: string;
})
```

Return all state and handlers currently read by the JSX.

- [ ] **Step 3: Extract Obsidian hook**

Create `src/components/ontology/useObsidianCardSync.ts` by moving Obsidian state and handlers:

- `ObsidianConfigStatus`
- `ObsidianSyncStatus`
- `loadObsidianStatus`
- `handleSaveObsidianConfig`
- `handleSyncObsidian`

Expose:

```ts
export function useObsidianCardSync({
  sessionId,
  nodeId,
  nodeType,
}: {
  sessionId: string | null;
  nodeId: string;
  nodeType: string;
})
```

Return config/status state, editable form fields, setters, busy/error flags, and handlers.

- [ ] **Step 4: Extract presentational sections**

Move JSX sections from `OntologySelectedEntity.tsx` into:

- `EntitySummarySection.tsx`: summary button, summary body, edit/save controls.
- `ObsidianActionsSection.tsx`: Obsidian config form, sync button, status messages.
- `EntityEvidenceSection.tsx`: confidence notes and evidence list.
- `EntityRelationsSection.tsx`: related nodes list and `onSelectNode` wiring.

Pass props explicitly. Do not import global state into section components.

- [ ] **Step 5: Rewire container**

In `OntologySelectedEntity.tsx`:

- Keep entity header and basic node metadata.
- Use `useEntitySummary`.
- Use `useObsidianCardSync`.
- Keep memoized derived values: `orderedEvidence`, `confidenceNotes`, `cardNodes`, `cardEdges`, `related`.
- Render extracted sections.

- [ ] **Step 6: Verify build**

Run:

```bash
npm run build
```

Expected: command exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/components/ontology/OntologySelectedEntity.tsx src/components/ontology/useEntitySummary.ts src/components/ontology/useObsidianCardSync.ts src/components/ontology/EntitySummarySection.tsx src/components/ontology/EntityEvidenceSection.tsx src/components/ontology/EntityRelationsSection.tsx src/components/ontology/ObsidianActionsSection.tsx
git commit -m "refactor(ui): split ontology selected entity"
```

### Task 6: Split Markdown Block Renderer

**Files:**
- Create: `src/components/shared/markdownInline.tsx`
- Create: `src/components/shared/MarkdownCodeBlock.tsx`
- Create: `src/components/shared/MarkdownDiffFileBlock.tsx`
- Create: `src/components/shared/markdownTable.tsx`
- Modify: `src/components/shared/MarkdownBlock.tsx`
- Verify: `src/components/shared/MarkdownBlock.test.ts`

- [ ] **Step 1: Run baseline Markdown tests**

Run:

```bash
node --import tsx --test src/components/shared/MarkdownBlock.test.ts
```

Expected: PASS before refactor.

- [ ] **Step 2: Extract inline renderer**

Create `src/components/shared/markdownInline.tsx` by moving `renderInlineMarkdown`.

Export:

```tsx
export function renderInlineMarkdown(text: string, keyPrefix: string): React.ReactNode[]
```

Import it back into `MarkdownBlock.tsx` and continue re-exporting it from `MarkdownBlock.tsx`.

- [ ] **Step 3: Extract code block**

Create `src/components/shared/MarkdownCodeBlock.tsx` by moving:

- syntax highlighter imports and language registration
- `CODE_BLOCK_STYLE`
- `CodeBlock`

Export:

```tsx
export function CodeBlock({ code, lang }: { code: string; lang: string })
```

Import it into `MarkdownBlock.tsx` and continue re-exporting `CodeBlock` from `MarkdownBlock.tsx`.

- [ ] **Step 4: Extract diff file block**

Create `src/components/shared/MarkdownDiffFileBlock.tsx` by moving:

- diff styles
- `markerSymbol`
- `markerColor`
- `rowBackground`
- `sideCellStyle`
- `sideTextColor`
- `SideCell`
- `DiffFileBlock`

Export:

```tsx
export function DiffFileBlock({ text }: { text: string })
```

Import it into `MarkdownBlock.tsx`.

- [ ] **Step 5: Extract table helpers**

Create `src/components/shared/markdownTable.tsx` by moving:

- `isTableRow`
- `isTableSeparator`
- `parseAlignments`
- `parseTableCells`
- table styles

Export the helper functions used by `MarkdownBlock.tsx`. If table rendering is inline inside `MarkdownBlock`, keep only the small render loop there and use imported helpers/styles.

- [ ] **Step 6: Verify Markdown tests and build**

Run:

```bash
node --import tsx --test src/components/shared/MarkdownBlock.test.ts
npm run build
```

Expected: both commands exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/components/shared/MarkdownBlock.tsx src/components/shared/markdownInline.tsx src/components/shared/MarkdownCodeBlock.tsx src/components/shared/MarkdownDiffFileBlock.tsx src/components/shared/markdownTable.tsx
git commit -m "refactor(ui): split markdown renderer"
```

### Task 7: Extract Calibration Page Hooks

**Files:**
- Create: `src/components/pages/useCurrentCalibrationConstants.ts`
- Create: `src/components/pages/useAutoCalibrationJob.ts`
- Create: `src/components/pages/useCalibrationDetailTranslation.ts`
- Modify: `src/components/pages/CalibratePage.tsx`

- [ ] **Step 1: Run build baseline**

Run:

```bash
npm run build
```

Expected: PASS before refactor.

- [ ] **Step 2: Extract current constants hook**

Create `src/components/pages/useCurrentCalibrationConstants.ts`:

```ts
import { useEffect, useState } from 'react';
import { get } from '../../api/client';
import type { AgentSource } from './calibrationCategories';

export function useCurrentCalibrationConstants<T>({
  sessionCwd,
  calibrationSource,
  onError,
}: {
  sessionCwd: string | null | undefined;
  calibrationSource: Extract<AgentSource, 'claude' | 'codex'>;
  onError: (message: string) => void;
}) {
  const [currentConstants, setCurrentConstants] = useState<T | null>(null);

  useEffect(() => {
    if (!sessionCwd) {
      setCurrentConstants(null);
      return;
    }
    get<T>(`/calibrate/current?cwd=${encodeURIComponent(sessionCwd)}&source=${calibrationSource}`)
      .then(setCurrentConstants)
      .catch((err) => onError((err as Error).message));
  }, [calibrationSource, onError, sessionCwd]);

  return { currentConstants, setCurrentConstants };
}
```

Use it in `CalibratePage.tsx` and remove the old current-constants effect.

- [ ] **Step 3: Extract auto calibration job hook**

Create `src/components/pages/useAutoCalibrationJob.ts` by moving:

- `AutoCalibrationStatus`
- `AutoCalibrationJob`
- `autoJob`
- `autoRunning`
- `handleAutoStart`
- `handleAutoCancel`
- polling effect

Expose:

```ts
export function useAutoCalibrationJob({
  sessionCwd,
  calibrationSource,
  autoPrompt,
  autoTargetHost,
  onResult,
  onError,
  onBeforeStart,
}: {
  sessionCwd: string | null | undefined;
  calibrationSource: Extract<AgentSource, 'claude' | 'codex'>;
  autoPrompt: string;
  autoTargetHost: string;
  onResult: (result: ExtractedResult) => void;
  onError: (message: string) => void;
  onBeforeStart: () => void;
})
```

Keep `ExtractedResult` exported from `CalibratePage.tsx` or move it to a small `calibrationPageTypes.ts` if TypeScript needs it in both files.

- [ ] **Step 4: Extract detail translation hook**

Create `src/components/pages/useCalibrationDetailTranslation.ts` by moving:

- `detailTranslations`
- `detailTranslating`
- `detailTranslateError`
- `detailCopied`
- saved translation lookup effect
- `handleDetailCopy`
- `handleDetailTranslate`

Expose a hook that accepts `detailModal`, `detailDisplay`, `detailTranslatedDisplay`, `currentSessionId`, `currentTurnIndex`, and `detailTranslationSlot`.

- [ ] **Step 5: Rewire `CalibratePage.tsx`**

In `CalibratePage.tsx`:

- Keep page-level fields: selected source, prompt, target host, result, applied/applying, modal open/close.
- Use the three hooks.
- Keep `handleApply` in the page because it coordinates result, current constants refresh, cwd, and applied state.

- [ ] **Step 6: Verify build**

Run:

```bash
npm run build
```

Expected: command exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/components/pages/CalibratePage.tsx src/components/pages/useCurrentCalibrationConstants.ts src/components/pages/useAutoCalibrationJob.ts src/components/pages/useCalibrationDetailTranslation.ts
git commit -m "refactor(ui): extract calibration page hooks"
```

---

## Final Verification

After all tasks are complete, run:

```bash
npm test
npm run build
```

Expected:
- `npm test` exits 0.
- `npm run build` exits 0.

Then update `CC_CLI_PROGRESSING/file-lines-by-architecture-2026-07-02.md` with the new file list and line counts, or create a new dated report if preserving the old snapshot matters.

