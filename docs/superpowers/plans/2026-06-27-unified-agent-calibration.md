# Unified Agent Calibration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Claude-only calibration constants with a normalized, source-aware calibration system that supports Claude and Codex now, while leaving clean adapter slots for opencode and openclaw later.

**Architecture:** Introduce a shared `NormalizedCalibration` schema keyed by existing context categories, then adapt Claude and Codex capture extractors into that schema. Backend storage, auto-capture jobs, routes, pipelines, and UI become source-aware; source-specific code is isolated to extractors and launchers.

**Tech Stack:** TypeScript, Express, React, Node `fs/path/http/https/child_process`, existing `node:test` through `tsx`, existing CommonJS proxy scripts.

---

## File Structure

### New Files

- `src/pipeline/calibration-types.ts`
  - Owns `AgentSource`, `CalibrationCategoryKey`, `NormalizedCalibration`, `NormalizedCalibrationSummary`, and compatibility helpers.
- `src/pipeline/calibration-types.test.ts`
  - Tests legacy Claude summary conversion and category lookup.
- `src/pipeline/extract-codex-constants.ts`
  - Parses Codex `/responses` capture logs into `NormalizedCalibration`.
- `src/pipeline/extract-codex-constants.test.ts`
  - Tests Codex request, developer block classification, tools, hashes, and SSE usage extraction.
- `server/services/calibration-launchers.ts`
  - Builds source-specific child process arguments for `claude` and `codex`.
- `server/services/calibration-launchers.test.ts`
  - Tests launcher argument construction without spawning real CLIs.
- `server/services/codex-config.ts`
  - Reads the active Codex provider base URL from `~/.codex/config.toml` with a small TOML subset parser.
- `server/services/codex-config.test.ts`
  - Tests active provider detection, provider block parsing, and default fallback.

### Modified Files

- `server/services/calibration-constants.ts`
  - Replace Claude-only project constants storage with source-aware normalized storage.
  - Keep legacy `.claude-trace/system-constants.json` read compatibility.
- `server/services/calibration-constants.test.ts`
  - Cover Claude normalized writes, legacy reads, Codex writes, defaults, and invalid source behavior.
- `src/pipeline/extract-constants.ts`
  - Keep Claude-specific capture parsing but return normalized summary/categories.
- `src/pipeline/extract-constants.test.ts`
  - Update assertions from legacy keys to normalized category keys.
- `src/pipeline/compute-context.ts`
  - Load normalized Claude category constants instead of three module-level legacy keys.
  - Keep `loadCalibratedConstants()` accepting legacy input during migration.
- `src/pipeline/compute-context.test.ts`
  - Update tests to use normalized input and assert legacy compatibility.
- `src/pipeline/index.ts`
  - Re-export normalized calibration loader types if needed by server code.
- `src/pipeline/codex-jsonl.ts`
  - Accept a normalized Codex calibration object; use JSONL values first and calibrated categories only for missing core categories.
- `src/pipeline/codex-jsonl.test.ts`
  - Add a missing-tools test where Codex JSONL gets `tool_defs` from normalized calibration.
- `server/services/pipeline-service.ts`
  - Load Claude or Codex constants based on transcript source and cwd.
- `scripts/calibration-proxy-utils.cjs`
  - Parameterize trace directory and log prefix.
- `scripts/calibration-proxy-utils.test.cjs`
  - Cover `.claude-trace/api-log-*` and `.codex-trace/codex-api-log-*`.
- `scripts/calibration-proxy.cjs`
  - Accept `--source`, `--trace-dir`, and `--log-prefix`.
  - Keep Claude behavior as default.
- `server/services/calibration-job.ts`
  - Make job source-aware and select the right extractor/launcher.
- `server/services/calibration-job.test.ts`
  - Cover source defaulting and source-specific failure messages.
- `server/routes/calibrate.ts`
  - Accept `source` in `current`, `apply`, and `auto/start`.
  - Default missing `source` to `claude`.
- `src/components/pages/calibrationDetailModal.ts`
  - Change detail keys from a fixed Claude union to a string-based normalized detail key.
- `src/components/pages/calibrationDetailModal.test.ts`
  - Cover stable hashing for arbitrary source/category detail keys.
- `src/components/pages/CalibratePage.tsx`
  - Add source selector and render calibration categories from normalized data.
- `src/utils/sessionSource.ts`
  - Expand `SessionSource` to include `opencode` and `openclaw` enum values without adding parsers yet.
- `src/utils/sessionSource.test.ts`
  - Verify current Claude/Codex inference still works and explicit future sources round-trip.
- `docs/superpowers/specs/2026-06-26-codex-calibration-design.md`
  - Add a short note that Codex calibration now uses the unified normalized schema.

---

## Task 1: Normalized Calibration Types

**Files:**
- Create: `src/pipeline/calibration-types.ts`
- Create: `src/pipeline/calibration-types.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/pipeline/calibration-types.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  categoryChars,
  legacyClaudeSummaryToNormalized,
  normalizeAgentSource,
} from './calibration-types';

test('converts legacy Claude summary into normalized categories', () => {
  const normalized = legacyClaudeSummaryToNormalized({
    SYS_PROMPT_FALLBACK_CHARS: 111,
    TOOL_DEFS_FALLBACK_CHARS: 222,
    SYSTEM_REMINDER_CHROME_CHARS: 333,
  }, {
    SYS_PROMPT_FALLBACK_CHARS: '# sys',
    TOOL_DEFS_FALLBACK_CHARS: '# tools',
    SYSTEM_REMINDER_CHROME_CHARS: '# chrome',
  });

  assert.equal(normalized.categories.sysPrompt?.chars, 111);
  assert.equal(normalized.categories.tool_defs?.chars, 222);
  assert.equal(normalized.categories.userMsgs?.chars, 333);
  assert.equal(normalized.categories.sysPrompt?.detailKey, 'claude.sysPrompt');
  assert.equal(normalized.details?.['claude.userMsgs'], '# chrome');
});

test('categoryChars returns zero for missing categories', () => {
  const normalized = legacyClaudeSummaryToNormalized({
    SYS_PROMPT_FALLBACK_CHARS: 111,
    TOOL_DEFS_FALLBACK_CHARS: 222,
    SYSTEM_REMINDER_CHROME_CHARS: 333,
  });

  assert.equal(categoryChars(normalized, 'sysPrompt'), 111);
  assert.equal(categoryChars(normalized, 'memory'), 0);
});

test('normalizes supported agent sources and rejects unknown values', () => {
  assert.equal(normalizeAgentSource(undefined), 'claude');
  assert.equal(normalizeAgentSource('codex'), 'codex');
  assert.equal(normalizeAgentSource('opencode'), 'opencode');
  assert.equal(normalizeAgentSource('openclaw'), 'openclaw');
  assert.throws(() => normalizeAgentSource('other'), /Unsupported calibration source: other/);
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
npx tsx --test src/pipeline/calibration-types.test.ts
```

Expected: FAIL with an import error because `src/pipeline/calibration-types.ts` does not exist.

- [ ] **Step 3: Implement the normalized types**

Create `src/pipeline/calibration-types.ts`:

```ts
export type AgentSource = 'claude' | 'codex' | 'opencode' | 'openclaw';

export type CalibrationCategoryKey =
  | 'sysPrompt'
  | 'tool_defs'
  | 'skills'
  | 'memory'
  | 'mcp'
  | 'reminders'
  | 'userMsgs';

export interface CalibrationCategory {
  chars: number;
  tokens?: number;
  detailKey?: string;
  origin?: 'capture' | 'jsonl' | 'default';
}

export interface CalibrationUsage {
  firstRequestInputTokens?: number;
  firstRequestCachedTokens?: number;
  firstRequestOutputTokens?: number;
  firstRequestReasoningTokens?: number;
}

export interface NormalizedCalibrationSummary {
  categories: Partial<Record<CalibrationCategoryKey, CalibrationCategory>>;
  usage?: CalibrationUsage;
  toolNames?: string[];
  hashes?: Record<string, string>;
}

export interface NormalizedCalibration extends NormalizedCalibrationSummary {
  schemaVersion: 1;
  source: AgentSource;
  constantsSource?: 'project' | 'defaults';
  path?: string;
  cwd?: string;
  note?: string;
  appliedAt?: string;
  cliVersion?: string;
  ccVersion?: string;
  model?: string;
  wireApi?: string;
  rawLogPath?: string;
  details?: Record<string, string>;
}

export interface LegacyClaudeSummary {
  SYS_PROMPT_FALLBACK_CHARS: number;
  TOOL_DEFS_FALLBACK_CHARS: number;
  SYSTEM_REMINDER_CHROME_CHARS: number;
}

export type LegacyClaudeDetails = Partial<Record<keyof LegacyClaudeSummary, string>>;

export function normalizeAgentSource(value: unknown): AgentSource {
  if (value == null || value === '') return 'claude';
  if (value === 'claude' || value === 'codex' || value === 'opencode' || value === 'openclaw') return value;
  throw new Error(`Unsupported calibration source: ${String(value)}`);
}

export function categoryChars(
  calibration: Pick<NormalizedCalibrationSummary, 'categories'> | null | undefined,
  key: CalibrationCategoryKey,
): number {
  const chars = calibration?.categories?.[key]?.chars;
  return typeof chars === 'number' && Number.isFinite(chars) && chars > 0 ? chars : 0;
}

export function legacyClaudeSummaryToNormalized(
  summary: LegacyClaudeSummary,
  details?: LegacyClaudeDetails,
): NormalizedCalibrationSummary & { details?: Record<string, string> } {
  const normalizedDetails: Record<string, string> = {};
  if (details?.SYS_PROMPT_FALLBACK_CHARS) normalizedDetails['claude.sysPrompt'] = details.SYS_PROMPT_FALLBACK_CHARS;
  if (details?.TOOL_DEFS_FALLBACK_CHARS) normalizedDetails['claude.tool_defs'] = details.TOOL_DEFS_FALLBACK_CHARS;
  if (details?.SYSTEM_REMINDER_CHROME_CHARS) normalizedDetails['claude.userMsgs'] = details.SYSTEM_REMINDER_CHROME_CHARS;

  return {
    categories: {
      sysPrompt: { chars: Number(summary.SYS_PROMPT_FALLBACK_CHARS || 0), detailKey: 'claude.sysPrompt', origin: 'capture' },
      tool_defs: { chars: Number(summary.TOOL_DEFS_FALLBACK_CHARS || 0), detailKey: 'claude.tool_defs', origin: 'capture' },
      userMsgs: { chars: Number(summary.SYSTEM_REMINDER_CHROME_CHARS || 0), detailKey: 'claude.userMsgs', origin: 'capture' },
    },
    ...(Object.keys(normalizedDetails).length ? { details: normalizedDetails } : {}),
  };
}

export function normalizedToLegacyClaudeSummary(summary: NormalizedCalibrationSummary): LegacyClaudeSummary {
  return {
    SYS_PROMPT_FALLBACK_CHARS: categoryChars(summary, 'sysPrompt'),
    TOOL_DEFS_FALLBACK_CHARS: categoryChars(summary, 'tool_defs'),
    SYSTEM_REMINDER_CHROME_CHARS: categoryChars(summary, 'userMsgs'),
  };
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run:

```bash
npx tsx --test src/pipeline/calibration-types.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/calibration-types.ts src/pipeline/calibration-types.test.ts
git commit -m "feat(calibrate): add normalized calibration types"
```

---

## Task 2: Source-Aware Project Constants Store

**Files:**
- Modify: `server/services/calibration-constants.ts`
- Modify: `server/services/calibration-constants.test.ts`

- [ ] **Step 1: Replace tests with source-aware store coverage**

Update `server/services/calibration-constants.test.ts` to include these tests:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_CALIBRATION_CONSTANTS,
  readCalibrationConstants,
  readProjectConstants,
  resolveProjectConstantsPath,
  writeCalibrationConstants,
  writeProjectConstants,
} from './calibration-constants';

test('resolves constants path under source-specific project trace directory', () => {
  const project = mkdtempSync(join(tmpdir(), 'cal-constants-'));
  try {
    assert.equal(
      resolveProjectConstantsPath(project, 'claude'),
      join(project, '.claude-trace', 'system-constants.json'),
    );
    assert.equal(
      resolveProjectConstantsPath(project, 'codex'),
      join(project, '.codex-trace', 'codex-system-constants.json'),
    );
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('reads Claude defaults when project constants are missing', () => {
  const project = mkdtempSync(join(tmpdir(), 'cal-constants-'));
  try {
    const current = readCalibrationConstants(project, 'claude');
    assert.equal(current.constantsSource, 'defaults');
    assert.equal(current.cwd, project);
    assert.equal(current.categories.sysPrompt?.chars, DEFAULT_CALIBRATION_CONSTANTS.SYS_PROMPT_FALLBACK_CHARS);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('reads empty Codex defaults when project constants are missing', () => {
  const project = mkdtempSync(join(tmpdir(), 'cal-constants-'));
  try {
    const current = readCalibrationConstants(project, 'codex');
    assert.equal(current.constantsSource, 'defaults');
    assert.equal(current.source, 'codex');
    assert.equal(current.categories.tool_defs?.chars ?? 0, 0);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('writes and reads normalized Codex constants', () => {
  const project = mkdtempSync(join(tmpdir(), 'cal-constants-'));
  try {
    const written = writeCalibrationConstants(project, {
      source: 'codex',
      cliVersion: '0.142.2',
      model: 'gpt-5.5',
      wireApi: 'responses',
      rawLogPath: join(project, '.codex-trace', 'codex-api-log.jsonl'),
      summary: {
        categories: {
          sysPrompt: { chars: 123, detailKey: 'codex.instructions' },
          tool_defs: { chars: 456, detailKey: 'codex.tools' },
          skills: { chars: 789, detailKey: 'codex.skills' },
        },
        toolNames: ['exec_command'],
        hashes: { instructions: 'abc' },
      },
      details: {
        'codex.instructions': '# instructions',
        'codex.tools': '# tools',
      },
    });

    assert.equal(written.source, 'codex');
    assert.equal(written.constantsSource, 'project');
    assert.equal(written.path, join(project, '.codex-trace', 'codex-system-constants.json'));

    const current = readCalibrationConstants(project, 'codex');
    assert.equal(current.categories.tool_defs?.chars, 456);
    assert.equal(current.toolNames?.[0], 'exec_command');
    assert.equal(current.details?.['codex.tools'], '# tools');
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('reads legacy Claude constants and exposes normalized plus legacy compatibility', () => {
  const project = mkdtempSync(join(tmpdir(), 'cal-constants-'));
  try {
    mkdirSync(join(project, '.claude-trace'), { recursive: true });
    writeFileSync(join(project, '.claude-trace', 'system-constants.json'), JSON.stringify({
      source: 'project',
      cwd: project,
      ccVersion: '2.1.170',
      model: 'deepseek-v4-pro',
      SYS_PROMPT_FALLBACK_CHARS: 11,
      TOOL_DEFS_FALLBACK_CHARS: 22,
      SYSTEM_REMINDER_CHROME_CHARS: 33,
      details: {
        SYS_PROMPT_FALLBACK_CHARS: '# sys',
      },
    }, null, 2));

    const current = readCalibrationConstants(project, 'claude');
    assert.equal(current.categories.sysPrompt?.chars, 11);
    assert.equal(current.categories.tool_defs?.chars, 22);
    assert.equal(current.categories.userMsgs?.chars, 33);
    assert.equal(current.details?.['claude.sysPrompt'], '# sys');

    const legacy = readProjectConstants(project);
    assert.equal(legacy.SYS_PROMPT_FALLBACK_CHARS, 11);
    assert.equal(legacy.TOOL_DEFS_FALLBACK_CHARS, 22);
    assert.equal(legacy.SYSTEM_REMINDER_CHROME_CHARS, 33);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('legacy writeProjectConstants writes normalized Claude constants', () => {
  const project = mkdtempSync(join(tmpdir(), 'cal-constants-'));
  try {
    const written = writeProjectConstants(project, {
      ccVersion: '2.1.170',
      model: 'deepseek-v4-pro',
      summary: {
        SYS_PROMPT_FALLBACK_CHARS: 101,
        TOOL_DEFS_FALLBACK_CHARS: 202,
        SYSTEM_REMINDER_CHROME_CHARS: 303,
      },
    });

    assert.equal(written.SYS_PROMPT_FALLBACK_CHARS, 101);
    const normalized = readCalibrationConstants(project, 'claude');
    assert.equal(normalized.categories.sysPrompt?.chars, 101);
    assert.equal(normalized.categories.userMsgs?.chars, 303);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
npx tsx --test server/services/calibration-constants.test.ts
```

Expected: FAIL because `readCalibrationConstants` and source-aware path signatures do not exist.

- [ ] **Step 3: Implement source-aware storage**

Modify `server/services/calibration-constants.ts`:

```ts
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import {
  type AgentSource,
  type LegacyClaudeDetails,
  type LegacyClaudeSummary,
  type NormalizedCalibration,
  type NormalizedCalibrationSummary,
  legacyClaudeSummaryToNormalized,
  normalizeAgentSource,
  normalizedToLegacyClaudeSummary,
} from '../../src/pipeline/calibration-types';

export const DEFAULT_CALIBRATION_CONSTANTS = {
  SYS_PROMPT_FALLBACK_CHARS: 5768,
  TOOL_DEFS_FALLBACK_CHARS: 98949,
  SYSTEM_REMINDER_CHROME_CHARS: 612,
};

export type CalibrationConstantsSource = 'project' | 'defaults';

export interface ProjectCalibrationConstants {
  source: CalibrationConstantsSource;
  path: string;
  cwd: string;
  note?: string;
  appliedAt?: string;
  ccVersion?: string;
  model?: string;
  SYS_PROMPT_FALLBACK_CHARS: number;
  TOOL_DEFS_FALLBACK_CHARS: number;
  SYSTEM_REMINDER_CHROME_CHARS: number;
  details?: LegacyClaudeDetails | Record<string, string>;
}

export interface WriteProjectConstantsInput {
  summary: LegacyClaudeSummary | NormalizedCalibrationSummary;
  details?: LegacyClaudeDetails | Record<string, string>;
  ccVersion?: string;
  model?: string;
}

export interface WriteCalibrationConstantsInput {
  source?: AgentSource;
  summary: NormalizedCalibrationSummary;
  details?: Record<string, string>;
  ccVersion?: string;
  cliVersion?: string;
  model?: string;
  wireApi?: string;
  rawLogPath?: string;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function normalizeProjectCwd(cwd: string): string {
  if (!cwd || typeof cwd !== 'string') {
    throw new Error('缺少 cwd，无法确定当前项目。');
  }
  const normalized = resolve(cwd);
  if (!existsSync(normalized) || !statSync(normalized).isDirectory()) {
    throw new Error(`cwd 不是有效目录: ${normalized}`);
  }
  return normalized;
}

export function resolveProjectTraceDir(cwd: string, source: AgentSource = 'claude'): string {
  const agent = normalizeAgentSource(source);
  return join(normalizeProjectCwd(cwd), agent === 'claude' ? '.claude-trace' : `.${agent}-trace`);
}

export function resolveProjectConstantsPath(cwd: string, source: AgentSource = 'claude'): string {
  const agent = normalizeAgentSource(source);
  const filename = agent === 'claude' ? 'system-constants.json' : `${agent}-system-constants.json`;
  return join(resolveProjectTraceDir(cwd, agent), filename);
}

function ensureWritableTraceDir(cwd: string, source: AgentSource): string {
  const traceDir = resolveProjectTraceDir(cwd, source);
  try {
    mkdirSync(traceDir, { recursive: true });
    if (!statSync(traceDir).isDirectory()) {
      throw new Error('path exists but is not a directory');
    }
  } catch (err) {
    throw new Error(
      `项目日志目录不可写: ${traceDir}。请执行: sudo chown -R "$USER":staff ${shellQuote(traceDir)}。原因: ${(err as Error).message}`,
    );
  }
  return traceDir;
}

function defaultNormalizedConstants(cwd: string, source: AgentSource, path: string): NormalizedCalibration {
  if (source === 'claude') {
    const converted = legacyClaudeSummaryToNormalized(DEFAULT_CALIBRATION_CONSTANTS);
    return {
      schemaVersion: 1,
      source,
      constantsSource: 'defaults',
      path,
      cwd,
      note: '当前项目尚未应用校准常量。',
      ...converted,
    };
  }

  return {
    schemaVersion: 1,
    source,
    constantsSource: 'defaults',
    path,
    cwd,
    note: '当前项目尚未应用校准常量。',
    categories: {},
  };
}

function normalizeLoadedConstants(data: any, source: AgentSource, cwd: string, path: string): NormalizedCalibration {
  if (data?.schemaVersion === 1 && data?.categories && typeof data.categories === 'object') {
    return {
      ...data,
      schemaVersion: 1,
      source,
      constantsSource: 'project',
      path,
      cwd,
    };
  }

  if (source === 'claude') {
    const converted = legacyClaudeSummaryToNormalized({
      SYS_PROMPT_FALLBACK_CHARS: Number(data?.SYS_PROMPT_FALLBACK_CHARS ?? DEFAULT_CALIBRATION_CONSTANTS.SYS_PROMPT_FALLBACK_CHARS),
      TOOL_DEFS_FALLBACK_CHARS: Number(data?.TOOL_DEFS_FALLBACK_CHARS ?? DEFAULT_CALIBRATION_CONSTANTS.TOOL_DEFS_FALLBACK_CHARS),
      SYSTEM_REMINDER_CHROME_CHARS: Number(data?.SYSTEM_REMINDER_CHROME_CHARS ?? DEFAULT_CALIBRATION_CONSTANTS.SYSTEM_REMINDER_CHROME_CHARS),
    }, data?.details);
    return {
      schemaVersion: 1,
      source,
      constantsSource: 'project',
      path,
      cwd,
      appliedAt: data?.appliedAt,
      ccVersion: data?.ccVersion,
      model: data?.model,
      ...converted,
    };
  }

  return defaultNormalizedConstants(cwd, source, path);
}

export function readCalibrationConstants(cwd: string, source: AgentSource = 'claude'): NormalizedCalibration {
  const agent = normalizeAgentSource(source);
  const normalized = normalizeProjectCwd(cwd);
  const path = resolveProjectConstantsPath(normalized, agent);
  if (!existsSync(path)) return defaultNormalizedConstants(normalized, agent, path);
  const data = JSON.parse(readFileSync(path, 'utf-8'));
  return normalizeLoadedConstants(data, agent, normalized, path);
}

export function writeCalibrationConstants(cwd: string, input: WriteCalibrationConstantsInput): NormalizedCalibration {
  const agent = normalizeAgentSource(input.source);
  const normalized = normalizeProjectCwd(cwd);
  ensureWritableTraceDir(normalized, agent);
  const path = resolveProjectConstantsPath(normalized, agent);
  const data: NormalizedCalibration = {
    schemaVersion: 1,
    source: agent,
    constantsSource: 'project',
    path,
    cwd: normalized,
    appliedAt: new Date().toISOString(),
    ccVersion: input.ccVersion,
    cliVersion: input.cliVersion,
    model: input.model || 'unknown',
    wireApi: input.wireApi,
    rawLogPath: input.rawLogPath,
    categories: input.summary.categories,
    ...(input.summary.usage ? { usage: input.summary.usage } : {}),
    ...(input.summary.toolNames ? { toolNames: input.summary.toolNames } : {}),
    ...(input.summary.hashes ? { hashes: input.summary.hashes } : {}),
    ...(input.details ? { details: input.details } : {}),
  };

  try {
    writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
  } catch (err) {
    const traceDir = resolveProjectTraceDir(normalized, agent);
    throw new Error(
      `项目日志目录不可写: ${traceDir}。请执行: sudo chown -R "$USER":staff ${shellQuote(traceDir)}。原因: ${(err as Error).message}`,
    );
  }
  return data;
}

export function readProjectConstants(cwd: string): ProjectCalibrationConstants {
  const normalized = readCalibrationConstants(cwd, 'claude');
  const legacy = normalizedToLegacyClaudeSummary(normalized);
  return {
    source: normalized.constantsSource ?? 'defaults',
    path: normalized.path || resolveProjectConstantsPath(cwd, 'claude'),
    cwd: normalized.cwd || normalizeProjectCwd(cwd),
    note: normalized.note,
    appliedAt: normalized.appliedAt,
    ccVersion: normalized.ccVersion,
    model: normalized.model,
    ...legacy,
    details: normalized.details,
  };
}

export function writeProjectConstants(cwd: string, input: WriteProjectConstantsInput): ProjectCalibrationConstants {
  const converted = 'categories' in input.summary
    ? { ...input.summary, details: input.details as Record<string, string> | undefined }
    : legacyClaudeSummaryToNormalized(input.summary, input.details as LegacyClaudeDetails | undefined);
  const normalized = writeCalibrationConstants(cwd, {
    source: 'claude',
    summary: converted,
    details: converted.details,
    ccVersion: input.ccVersion,
    model: input.model,
  });
  const legacy = normalizedToLegacyClaudeSummary(normalized);
  return {
    source: 'project',
    path: normalized.path!,
    cwd: normalized.cwd!,
    appliedAt: normalized.appliedAt,
    ccVersion: normalized.ccVersion,
    model: normalized.model,
    ...legacy,
    details: input.details,
  };
}
```

- [ ] **Step 4: Run constants tests**

Run:

```bash
npx tsx --test src/pipeline/calibration-types.test.ts server/services/calibration-constants.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/calibration-types.ts src/pipeline/calibration-types.test.ts server/services/calibration-constants.ts server/services/calibration-constants.test.ts
git commit -m "feat(calibrate): store source-aware constants"
```

---

## Task 3: Normalize Claude Capture Extraction

**Files:**
- Modify: `src/pipeline/extract-constants.ts`
- Modify: `src/pipeline/extract-constants.test.ts`

- [ ] **Step 1: Update the Claude extractor test**

In `src/pipeline/extract-constants.test.ts`, update the assertions after `const extracted = extractConstants(logPath);`:

```ts
    assert.equal(extracted?.source, 'claude');
    assert.equal(extracted?.summary.categories.sysPrompt?.chars, extracted?.systemBlocks.total);
    assert.equal(extracted?.summary.categories.tool_defs?.chars, extracted?.toolsChars);
    assert.equal(extracted?.summary.categories.userMsgs?.chars, extracted?.userMessage.chrome);

    assert.ok(extracted?.details);
    assert.doesNotMatch(extracted.details['claude.sysPrompt'], /```text/);
    assert.match(extracted.details['claude.sysPrompt'], /Harness prompt text/);
    assert.match(extracted.details['claude.sysPrompt'], /```json\n\{"example":true\}\n```/);
    assert.match(extracted.details['claude.tool_defs'], /```json/);
    assert.match(extracted.details['claude.tool_defs'], /"name": "Read"/);
    assert.doesNotMatch(extracted.details['claude.userMsgs'], /```text/);
    assert.match(extracted.details['claude.userMsgs'], /Intro wrapper/);
    assert.match(extracted.details['claude.userMsgs'], /```bash\necho hello\n```/);
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npx tsx --test src/pipeline/extract-constants.test.ts
```

Expected: FAIL because `summary.categories` and normalized detail keys do not exist.

- [ ] **Step 3: Update `ExtractedConstants` type**

In `src/pipeline/extract-constants.ts`, import normalized types:

```ts
import type { NormalizedCalibrationSummary } from './calibration-types';
```

Change the `ExtractedConstants` interface fields:

```ts
  /** Agent source. */
  source: 'claude';
  /** Summary in normalized calibration schema. */
  summary: NormalizedCalibrationSummary;
  /** Markdown-viewable source content for each calibrated constant. */
  details?: Record<string, string>;
```

- [ ] **Step 4: Replace the returned summary and details**

Inside the return object in `extractConstants()`, replace the old `summary` and `details` block with:

```ts
      source: 'claude',
      summary: {
        categories: {
          sysPrompt: { chars: systemBlocks.total, detailKey: 'claude.sysPrompt', origin: 'capture' },
          tool_defs: { chars: toolsChars, detailKey: 'claude.tool_defs', origin: 'capture' },
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
      },
```

Keep `systemBlocks`, `toolsChars`, `userMessage`, and `firstRequestTokens` fields for UI context.

- [ ] **Step 5: Run Claude extractor tests**

Run:

```bash
npx tsx --test src/pipeline/extract-constants.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/pipeline/extract-constants.ts src/pipeline/extract-constants.test.ts
git commit -m "feat(calibrate): normalize Claude extraction"
```

---

## Task 4: Load Normalized Constants in Claude Context Computation

**Files:**
- Modify: `src/pipeline/compute-context.ts`
- Modify: `src/pipeline/compute-context.test.ts`
- Modify: `src/pipeline/index.ts`

- [ ] **Step 1: Update compute-context tests**

In `src/pipeline/compute-context.test.ts`, replace the existing test body with normalized input and add a legacy compatibility assertion:

```ts
test('loads normalized project constants and resets when missing for next project', () => {
  const projectA = mkdtempSync(join(tmpdir(), 'cal-project-a-'));
  const projectB = mkdtempSync(join(tmpdir(), 'cal-project-b-'));
  try {
    loadCalibratedConstants({
      schemaVersion: 1,
      source: 'claude',
      categories: {
        sysPrompt: { chars: 111 },
        tool_defs: { chars: 222 },
        userMsgs: { chars: 333 },
      },
    });

    const a = computeContext([group(projectA)], estimator)[0]!;
    assert.equal(a.sysPrompt, 111);
    assert.equal(a.tool_defs, 222);
    assert.equal(a.userMsgs, 333 + 2);

    loadCalibratedConstants(null);
    const b = computeContext([group(projectB)], estimator)[0]!;
    assert.equal(b.sysPrompt, 5768);
    assert.equal(b.tool_defs, 98949);
    assert.equal(b.userMsgs, 612 + 2);
  } finally {
    resetCalibratedConstants();
    rmSync(projectA, { recursive: true, force: true });
    rmSync(projectB, { recursive: true, force: true });
  }
});

test('keeps legacy calibrated constant input compatible during migration', () => {
  try {
    loadCalibratedConstants({
      SYS_PROMPT_FALLBACK_CHARS: 10,
      TOOL_DEFS_FALLBACK_CHARS: 20,
      SYSTEM_REMINDER_CHROME_CHARS: 30,
    });

    const comp = computeContext([group('/tmp')], estimator)[0]!;
    assert.equal(comp.sysPrompt, 10);
    assert.equal(comp.tool_defs, 20);
    assert.equal(comp.userMsgs, 30 + 2);
  } finally {
    resetCalibratedConstants();
  }
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npx tsx --test src/pipeline/compute-context.test.ts
```

Expected: FAIL because `loadCalibratedConstants()` does not read normalized `categories`.

- [ ] **Step 3: Update `compute-context.ts` imports and input type**

At the top of `src/pipeline/compute-context.ts`, add:

```ts
import {
  type NormalizedCalibrationSummary,
  categoryChars,
} from './calibration-types';
```

Replace `interface CalibratedConstantsInput` with:

```ts
interface LegacyCalibratedConstantsInput {
  SYS_PROMPT_FALLBACK_CHARS?: number;
  TOOL_DEFS_FALLBACK_CHARS?: number;
  SYSTEM_REMINDER_CHROME_CHARS?: number;
}

type CalibratedConstantsInput = NormalizedCalibrationSummary | LegacyCalibratedConstantsInput;
```

- [ ] **Step 4: Update `loadCalibratedConstants()`**

Replace the current function with:

```ts
export function loadCalibratedConstants(constants?: CalibratedConstantsInput | null) {
  resetCalibratedConstants();
  if (!constants) return;

  if ('categories' in constants) {
    const sysPrompt = categoryChars(constants, 'sysPrompt');
    const toolDefs = categoryChars(constants, 'tool_defs');
    const userChrome = categoryChars(constants, 'userMsgs');
    if (sysPrompt) SYS_PROMPT_FALLBACK_CHARS = sysPrompt;
    if (toolDefs) TOOL_DEFS_FALLBACK_CHARS = toolDefs;
    if (userChrome) SYSTEM_REMINDER_CHROME_CHARS = userChrome;
    return;
  }

  if (constants.SYS_PROMPT_FALLBACK_CHARS) SYS_PROMPT_FALLBACK_CHARS = constants.SYS_PROMPT_FALLBACK_CHARS;
  if (constants.TOOL_DEFS_FALLBACK_CHARS) TOOL_DEFS_FALLBACK_CHARS = constants.TOOL_DEFS_FALLBACK_CHARS;
  if (constants.SYSTEM_REMINDER_CHROME_CHARS) SYSTEM_REMINDER_CHROME_CHARS = constants.SYSTEM_REMINDER_CHROME_CHARS;
}
```

- [ ] **Step 5: Re-export the normalized loader type if needed**

In `src/pipeline/index.ts`, keep the existing export:

```ts
export { loadCalibratedConstants } from './compute-context';
```

Add:

```ts
export type { NormalizedCalibration, NormalizedCalibrationSummary } from './calibration-types';
```

- [ ] **Step 6: Run tests**

Run:

```bash
npx tsx --test src/pipeline/calibration-types.test.ts src/pipeline/compute-context.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/pipeline/compute-context.ts src/pipeline/compute-context.test.ts src/pipeline/index.ts
git commit -m "feat(calibrate): load normalized Claude constants"
```

---

## Task 5: Codex Capture Extractor

**Files:**
- Create: `src/pipeline/extract-codex-constants.ts`
- Create: `src/pipeline/extract-codex-constants.test.ts`

- [ ] **Step 1: Write Codex extractor tests**

Create `src/pipeline/extract-codex-constants.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractCodexConstants, parseResponsesSseUsage } from './extract-codex-constants';

test('parses usage from Responses API SSE body', () => {
  const usage = parseResponsesSseUsage([
    'event: response.completed',
    'data: {"response":{"usage":{"input_tokens":1200,"input_tokens_details":{"cached_tokens":300},"output_tokens":40,"output_tokens_details":{"reasoning_tokens":12}}}}',
    '',
  ].join('\n'));

  assert.equal(usage.firstRequestInputTokens, 1200);
  assert.equal(usage.firstRequestCachedTokens, 300);
  assert.equal(usage.firstRequestOutputTokens, 40);
  assert.equal(usage.firstRequestReasoningTokens, 12);
});

test('extracts normalized constants from Codex /responses capture', () => {
  const dir = mkdtempSync(join(tmpdir(), 'extract-codex-'));
  const logPath = join(dir, 'codex-api-log.jsonl');
  try {
    const entry = {
      request: {
        method: 'POST',
        url: 'http://127.0.0.1:9090/responses',
        headers: {
          'user-agent': 'codex-cli/0.142.2',
        },
        body: {
          model: 'gpt-5.5',
          instructions: 'You are Codex.',
          input: [
            {
              role: 'developer',
              content: [{ type: 'input_text', text: '<permissions instructions>runtime</permissions instructions>' }],
            },
            {
              role: 'developer',
              content: [{ type: 'input_text', text: '<skills_instructions>skills here</skills_instructions>' }],
            },
            {
              role: 'developer',
              content: [{ type: 'input_text', text: '<plugins_instructions>plugins here</plugins_instructions>' }],
            },
            {
              role: 'user',
              content: [{ type: 'input_text', text: 'hi' }],
            },
          ],
          tools: [{ type: 'function', name: 'exec_command', description: 'Run command' }],
        },
      },
      response: {
        status_code: 200,
        headers: { 'content-type': 'text/event-stream' },
        body: [
          'event: response.completed',
          'data: {"response":{"usage":{"input_tokens":2000,"input_tokens_details":{"cached_tokens":1000},"output_tokens":50,"output_tokens_details":{"reasoning_tokens":20}}}}',
          '',
        ].join('\n'),
      },
    };
    writeFileSync(logPath, JSON.stringify(entry) + '\n');

    const extracted = extractCodexConstants(logPath);

    assert.equal(extracted?.source, 'codex');
    assert.equal(extracted?.wireApi, 'responses');
    assert.equal(extracted?.cliVersion, '0.142.2');
    assert.equal(extracted?.model, 'gpt-5.5');
    assert.equal(extracted?.summary.categories.sysPrompt?.chars, 'You are Codex.'.length);
    assert.equal(extracted?.summary.categories.tool_defs?.chars, JSON.stringify(entry.request.body.tools).length);
    assert.equal(extracted?.summary.categories.reminders?.chars, '<permissions instructions>runtime</permissions instructions>'.length);
    assert.equal(extracted?.summary.categories.skills?.chars, '<skills_instructions>skills here</skills_instructions>'.length);
    assert.equal(extracted?.summary.categories.mcp?.chars, '<plugins_instructions>plugins here</plugins_instructions>'.length);
    assert.equal(extracted?.summary.usage?.firstRequestInputTokens, 2000);
    assert.equal(extracted?.summary.usage?.firstRequestCachedTokens, 1000);
    assert.equal(extracted?.summary.usage?.firstRequestOutputTokens, 50);
    assert.equal(extracted?.summary.usage?.firstRequestReasoningTokens, 20);
    assert.deepEqual(extracted?.summary.toolNames, ['exec_command']);
    assert.match(extracted?.summary.hashes?.instructions ?? '', /^[a-f0-9]{64}$/);
    assert.match(extracted?.details?.['codex.tools'] ?? '', /"name": "exec_command"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
npx tsx --test src/pipeline/extract-codex-constants.test.ts
```

Expected: FAIL because `extract-codex-constants.ts` does not exist.

- [ ] **Step 3: Implement Codex extractor**

Create `src/pipeline/extract-codex-constants.ts`:

```ts
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import type { CalibrationUsage, NormalizedCalibrationSummary } from './calibration-types';

type JsonObject = Record<string, any>;

export interface ExtractedCodexConstants {
  source: 'codex';
  sourceFile: string;
  cliVersion: string;
  model: string;
  wireApi: 'responses';
  instructionsChars: number;
  toolsChars: number;
  developerChars: number;
  runtimeChars: number;
  skillsChars: number;
  pluginsChars: number;
  summary: NormalizedCalibrationSummary;
  details?: Record<string, string>;
}

export function extractCodexConstants(logPath: string): ExtractedCodexConstants | null {
  const raw = readFileSync(logPath, 'utf-8');
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let entry: JsonObject;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.request?.method !== 'POST') continue;
    const url = String(entry.request?.url || entry.request?.upstream_url || '');
    if (!url.includes('/responses')) continue;
    const body = entry.request?.body;
    if (!body || typeof body !== 'object') continue;
    if (typeof body.instructions !== 'string' || !Array.isArray(body.input)) continue;

    const instructions = body.instructions;
    const tools = Array.isArray(body.tools) ? body.tools : [];
    const toolsJsonCompact = JSON.stringify(tools);
    const toolsJsonPretty = JSON.stringify(tools, null, 2);
    const developer = classifyDeveloperInput(body.input);
    const usage = parseResponsesSseUsage(entry.response?.body);
    const toolNames = tools
      .map((tool: any) => typeof tool?.name === 'string' ? tool.name : typeof tool?.function?.name === 'string' ? tool.function.name : '')
      .filter(Boolean)
      .sort();
    const cliVersion = parseCodexVersion(entry.request?.headers?.['user-agent']);

    return {
      source: 'codex',
      sourceFile: logPath.split('/').pop() || logPath,
      cliVersion,
      model: typeof body.model === 'string' ? body.model : 'unknown',
      wireApi: 'responses',
      instructionsChars: instructions.length,
      toolsChars: toolsJsonCompact.length,
      developerChars: developer.total,
      runtimeChars: developer.runtime,
      skillsChars: developer.skills,
      pluginsChars: developer.plugins,
      summary: {
        categories: {
          sysPrompt: { chars: instructions.length, detailKey: 'codex.instructions', origin: 'capture' },
          tool_defs: { chars: toolsJsonCompact.length, detailKey: 'codex.tools', origin: 'capture' },
          reminders: { chars: developer.runtime, detailKey: 'codex.runtime', origin: 'capture' },
          skills: { chars: developer.skills, detailKey: 'codex.skills', origin: 'capture' },
          mcp: { chars: developer.plugins, detailKey: 'codex.plugins', origin: 'capture' },
        },
        usage,
        toolNames,
        hashes: {
          instructions: sha256(instructions),
          tools: sha256(toolsJsonCompact),
        },
      },
      details: {
        'codex.instructions': ['# codex.instructions', '', `字符数: ${instructions.length}`, '', instructions].join('\n'),
        'codex.tools': ['# codex.tools', '', `字符数: ${toolsJsonCompact.length}`, '', '```json', toolsJsonPretty, '```'].join('\n'),
        'codex.runtime': ['# codex.runtime', '', `字符数: ${developer.runtime}`, '', developer.runtimeText].join('\n'),
        'codex.skills': ['# codex.skills', '', `字符数: ${developer.skills}`, '', developer.skillsText].join('\n'),
        'codex.plugins': ['# codex.plugins', '', `字符数: ${developer.plugins}`, '', developer.pluginsText].join('\n'),
      },
    };
  }
  return null;
}

export function parseResponsesSseUsage(body: unknown): CalibrationUsage {
  const text = typeof body === 'string' ? body : JSON.stringify(body ?? '');
  let usage: any = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const parsed = JSON.parse(payload);
      usage = parsed.response?.usage || parsed.usage || usage;
    } catch {
      continue;
    }
  }
  return {
    firstRequestInputTokens: numberOrUndefined(usage?.input_tokens),
    firstRequestCachedTokens: numberOrUndefined(usage?.input_tokens_details?.cached_tokens ?? usage?.cached_input_tokens),
    firstRequestOutputTokens: numberOrUndefined(usage?.output_tokens),
    firstRequestReasoningTokens: numberOrUndefined(usage?.output_tokens_details?.reasoning_tokens ?? usage?.reasoning_output_tokens),
  };
}

function classifyDeveloperInput(input: unknown[]): {
  total: number;
  runtime: number;
  skills: number;
  plugins: number;
  runtimeText: string;
  skillsText: string;
  pluginsText: string;
} {
  const parts = { runtime: [] as string[], skills: [] as string[], plugins: [] as string[] };
  for (const item of input) {
    if (item?.role !== 'developer') continue;
    for (const text of contentTexts(item.content)) {
      if (text.includes('<skills_instructions>')) parts.skills.push(text);
      else if (text.includes('<plugins_instructions>')) parts.plugins.push(text);
      else parts.runtime.push(text);
    }
  }
  const runtimeText = parts.runtime.join('\n\n');
  const skillsText = parts.skills.join('\n\n');
  const pluginsText = parts.plugins.join('\n\n');
  return {
    total: runtimeText.length + skillsText.length + pluginsText.length,
    runtime: runtimeText.length,
    skills: skillsText.length,
    plugins: pluginsText.length,
    runtimeText,
    skillsText,
    pluginsText,
  };
}

function contentTexts(content: unknown): string[] {
  if (typeof content === 'string') return [content];
  if (!Array.isArray(content)) return [];
  return content
    .map((block: any) => typeof block?.text === 'string' ? block.text : '')
    .filter(Boolean);
}

function parseCodexVersion(userAgent: unknown): string {
  const text = String(userAgent || '');
  return text.match(/codex(?:-cli)?\/([\d.]+)/)?.[1] || 'unknown';
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
```

- [ ] **Step 4: Run Codex extractor tests**

Run:

```bash
npx tsx --test src/pipeline/extract-codex-constants.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/extract-codex-constants.ts src/pipeline/extract-codex-constants.test.ts
git commit -m "feat(calibrate): extract Codex constants"
```

---

## Task 6: Codex Pipeline Uses Normalized Fallback Constants

**Files:**
- Modify: `src/pipeline/codex-jsonl.ts`
- Modify: `src/pipeline/codex-jsonl.test.ts`
- Modify: `server/services/pipeline-service.ts`

- [ ] **Step 1: Add Codex fallback test**

Append this test to `src/pipeline/codex-jsonl.test.ts`:

```ts
test('fills missing Codex core categories from normalized calibration constants', () => {
  const sample = [
    {
      timestamp: '2026-06-26T01:00:00.000Z',
      type: 'session_meta',
      payload: {
        session_id: 'sess_1',
        cwd: '/repo',
        cli_version: '0.99.0',
      },
    },
    {
      timestamp: '2026-06-26T01:00:01.000Z',
      type: 'event_msg',
      payload: { type: 'task_started', turn_id: 'turn_1' },
    },
    {
      timestamp: '2026-06-26T01:00:01.100Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: '检查 Codex 常量' },
    },
    {
      timestamp: '2026-06-26T01:00:02.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          last_token_usage: { input_tokens: 500, output_tokens: 20 },
        },
      },
    },
  ].map((line) => JSON.stringify(line)).join('\n');

  const { turns } = runCodexPipeline(sample, 'metadata.jsonl', {
    schemaVersion: 1,
    source: 'codex',
    categories: {
      sysPrompt: { chars: 30 },
      tool_defs: { chars: 60 },
      skills: { chars: 90 },
      mcp: { chars: 120 },
      reminders: { chars: 150 },
    },
  });

  const turn = turns[0]!;
  assert.ok((turn.comp.sysPrompt ?? 0) > 0);
  assert.ok((turn.comp.tool_defs ?? 0) > 0);
  assert.ok((turn.comp.skills ?? 0) > 0);
  assert.ok((turn.comp.mcp ?? 0) > 0);
  assert.ok((turn.comp.reminders ?? 0) > 0);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npx tsx --test src/pipeline/codex-jsonl.test.ts
```

Expected: FAIL because `runCodexPipeline()` does not accept a calibration argument.

- [ ] **Step 3: Add Codex calibration parameter**

In `src/pipeline/codex-jsonl.ts`, import:

```ts
import {
  type NormalizedCalibrationSummary,
  categoryChars,
} from './calibration-types';
```

Change `runCodexPipeline()` signature:

```ts
export function runCodexPipeline(
  jsonlText: string,
  filename: string,
  calibration?: NormalizedCalibrationSummary | null,
): {
```

Change:

```ts
  const turnData = assembleTurns(turns, sessionMeta);
```

to:

```ts
  const turnData = assembleTurns(turns, sessionMeta, calibration);
```

Change `assembleTurns()` signature:

```ts
function assembleTurns(
  turns: CodexTurn[],
  sessionMeta: JsonObject | null,
  calibration?: NormalizedCalibrationSummary | null,
): TurnData[] {
```

Change:

```ts
  const coreComp = buildCodexCoreComp(sessionMeta, turns);
```

to:

```ts
  const coreComp = buildCodexCoreComp(sessionMeta, turns, calibration);
```

- [ ] **Step 4: Apply calibration fallback in `buildCodexCoreComp()`**

Replace `buildCodexCoreComp()` with:

```ts
function buildCodexCoreComp(
  sessionMeta: JsonObject | null,
  turns: CodexTurn[],
  calibration?: NormalizedCalibrationSummary | null,
): Record<string, number> {
  const comp = initComp();
  addTokens(comp, 'sysPrompt', codexInstructionText(sessionMeta?.base_instructions));

  if (sessionMeta?.dynamic_tools != null) {
    addTokens(comp, 'tool_defs', stringifyInput(sessionMeta.dynamic_tools));
  }

  const seenDeveloperBlocks = new Set<string>();
  for (const turn of turns) {
    for (const event of turn.events) {
      const payload = event.payload;
      if (event.type !== 'response_item' || payload.type !== 'message' || payload.role !== 'developer') continue;
      if (!Array.isArray(payload.content)) {
        const text = textFromCodexContent(payload.content).trim();
        if (text && !seenDeveloperBlocks.has(text)) {
          seenDeveloperBlocks.add(text);
          addTokens(comp, codexDeveloperCategory(text), text);
        }
        continue;
      }

      for (const block of payload.content) {
        const text = textFromCodexContentBlock(block).trim();
        if (!text || seenDeveloperBlocks.has(text)) continue;
        seenDeveloperBlocks.add(text);
        addTokens(comp, codexDeveloperCategory(text), text);
      }
    }
  }

  applyCodexCalibrationFallback(comp, calibration);
  return comp;
}

function applyCodexCalibrationFallback(
  comp: Record<string, number>,
  calibration?: NormalizedCalibrationSummary | null,
): void {
  if (!calibration) return;
  for (const key of ['sysPrompt', 'tool_defs', 'skills', 'mcp', 'reminders'] as const) {
    if ((comp[key] ?? 0) > 0) continue;
    const chars = categoryChars(calibration, key);
    if (chars > 0) addTokens(comp, key, ' '.repeat(chars));
  }
}
```

- [ ] **Step 5: Load source-specific constants in pipeline service**

In `server/services/pipeline-service.ts`, change imports:

```ts
import { readCalibrationConstants, readProjectConstants } from './calibration-constants';
```

Change the Codex branch in `runPipelineOnContent()`:

```ts
  if (isCodexJsonl(jsonlContent)) {
    const cwd = extractCwdFromJsonl(jsonlContent);
    const constants = cwd ? readCalibrationConstants(cwd, 'codex') : null;
    return runCodexPipeline(jsonlContent, filename, constants);
  }
```

Keep the Claude branch loading `readProjectConstants(cwd)` until the source-aware route and UI task updates the apply/current flow.

- [ ] **Step 6: Run Codex pipeline tests**

Run:

```bash
npx tsx --test src/pipeline/codex-jsonl.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run pipeline service build check**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/pipeline/codex-jsonl.ts src/pipeline/codex-jsonl.test.ts server/services/pipeline-service.ts
git commit -m "feat(codex): use calibrated core fallbacks"
```

---

## Task 7: Generalize Proxy Log Paths

**Files:**
- Modify: `scripts/calibration-proxy-utils.cjs`
- Modify: `scripts/calibration-proxy-utils.test.cjs`
- Modify: `scripts/calibration-proxy.cjs`

- [ ] **Step 1: Add proxy utility tests**

In `scripts/calibration-proxy-utils.test.cjs`, add:

```js
test('makeLogFilePath supports Codex trace directory and prefix', () => {
  const cwd = path.resolve('/tmp/example-project');
  const logFile = makeLogFilePath(cwd, new Date('2026-06-26T01:02:03.456Z'), {
    traceDirName: '.codex-trace',
    logPrefix: 'codex-api-log',
  });
  assert.equal(
    logFile,
    path.join(cwd, '.codex-trace', 'codex-api-log-2026-06-26-01-02-03.jsonl'),
  );
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
node --test scripts/calibration-proxy-utils.test.cjs
```

Expected: FAIL because `makeLogFilePath()` ignores the third argument.

- [ ] **Step 3: Parameterize log path helpers**

In `scripts/calibration-proxy-utils.cjs`, replace `makeLogFilePath()` and `getProjectLogFilePath()` with:

```js
function normalizeTraceOptions(options = {}) {
  return {
    traceDirName: options.traceDirName || ".claude-trace",
    logPrefix: options.logPrefix || "api-log",
  };
}

function makeLogFilePath(cwd, date = new Date(), options = {}) {
  const opts = normalizeTraceOptions(options);
  return path.join(path.resolve(cwd), opts.traceDirName, `${opts.logPrefix}-${timestampForFile(date)}.jsonl`);
}

function getProjectLogFilePath(cwd, date = new Date(), options = {}) {
  const logFile = makeLogFilePath(cwd, date, options);
  const traceDir = path.dirname(logFile);
  try {
    ensureDir(traceDir);
    if (!fs.statSync(traceDir).isDirectory()) {
      throw new Error("trace path exists but is not a directory");
    }
    fs.accessSync(traceDir, fs.constants.W_OK);
  } catch (err) {
    const reason = err?.message ? ` (${err.message})` : "";
    throw new Error(`Project trace directory is not writable: ${traceDir}${reason}`);
  }
  return logFile;
}
```

Export `normalizeTraceOptions` in `module.exports`.

- [ ] **Step 4: Update proxy script arguments**

In `scripts/calibration-proxy.cjs`, extend `parseArgs()` defaults:

```js
    source: "claude",
    traceDirName: ".claude-trace",
    logPrefix: "api-log",
```

In the `for` loop, add:

```js
    else if (key === "--source" && value) {
      opts.source = value;
      opts.traceDirName = value === "codex" ? ".codex-trace" : `.${value}-trace`;
      opts.logPrefix = value === "codex" ? "codex-api-log" : "api-log";
      i += 1;
    }
    else if (key === "--trace-dir" && value) { opts.traceDirName = value; i += 1; }
    else if (key === "--log-prefix" && value) { opts.logPrefix = value; i += 1; }
```

Change:

```js
  const logFile = getProjectLogFilePath(opts.cwd);
```

to:

```js
  const logFile = getProjectLogFilePath(opts.cwd, new Date(), {
    traceDirName: opts.traceDirName,
    logPrefix: opts.logPrefix,
  });
```

- [ ] **Step 5: Make proxy launch Claude or Codex by source**

In `scripts/calibration-proxy.cjs`, replace the Claude-only launch block:

```js
  const claudePath = execSync("which claude", { encoding: "utf8" }).trim();
  const modeLabel = captureTarget.mode === "base-url"
    ? `mode=base-url upstream=${captureTarget.upstreamBaseUrl}`
    : `mode=connect target=${opts.targetHost}`;
  log(`READY port=${opts.port} ${modeLabel} log=${logFile}`);
  log(`Launching: ${claudePath} ${opts.claudeArgs.join(" ")}`);
```

with:

```js
  const cliName = opts.source === "codex" ? "codex" : "claude";
  const cliPath = execSync(`which ${cliName}`, { encoding: "utf8" }).trim();
  const childArgs = opts.source === "codex"
    ? [
        "exec",
        "--ephemeral",
        "--json",
        "-c", `model_providers.OpenAI.base_url="${proxyUrl}"`,
        "-s", "read-only",
        "-C", opts.cwd,
        ...(opts.claudeArgs.length ? opts.claudeArgs : ['Calibration probe: reply with "ok".']),
      ]
    : opts.claudeArgs;
  const modeLabel = captureTarget.mode === "base-url"
    ? `mode=base-url upstream=${captureTarget.upstreamBaseUrl}`
    : `mode=connect target=${opts.targetHost}`;
  log(`READY source=${opts.source} port=${opts.port} ${modeLabel} log=${logFile}`);
  log(`Launching: ${cliPath} ${childArgs.join(" ")}`);
```

Then change the spawn call:

```js
  const child = spawn(claudePath, opts.claudeArgs, {
```

to:

```js
  const child = spawn(cliPath, childArgs, {
```

Keep Anthropic/proxy environment behavior unchanged for Claude. For Codex, the `base_url` override is carried by the `-c model_providers.OpenAI.base_url="<proxyUrl>"` argument, so no certificate MITM is needed.

- [ ] **Step 6: Run proxy utility tests**

Run:

```bash
node --test scripts/calibration-proxy-utils.test.cjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/calibration-proxy-utils.cjs scripts/calibration-proxy-utils.test.cjs scripts/calibration-proxy.cjs
git commit -m "feat(calibrate): parameterize capture log paths"
```

---

## Task 8: Codex Config Reader

**Files:**
- Create: `server/services/codex-config.ts`
- Create: `server/services/codex-config.test.ts`

- [ ] **Step 1: Write Codex config tests**

Create `server/services/codex-config.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseCodexConfig,
  resolveCodexBaseUrlFromConfigText,
  resolveCodexConfigPath,
} from './codex-config';

test('resolves Codex config path under the provided home directory', () => {
  assert.equal(resolveCodexConfigPath('/Users/link'), '/Users/link/.codex/config.toml');
});

test('parses model provider blocks and active provider', () => {
  const parsed = parseCodexConfig([
    'model_provider = "DeepSeek"',
    '',
    '[model_providers.OpenAI]',
    'base_url = "https://api.openai.com/v1"',
    '',
    '[model_providers.DeepSeek]',
    'base_url = "http://127.0.0.1:9090"',
  ].join('\n'));

  assert.equal(parsed.modelProvider, 'DeepSeek');
  assert.equal(parsed.modelProviders.DeepSeek?.baseUrl, 'http://127.0.0.1:9090');
});

test('resolves active Codex base URL from config text', () => {
  const baseUrl = resolveCodexBaseUrlFromConfigText([
    'model_provider = "DeepSeek"',
    '[model_providers.OpenAI]',
    'base_url = "https://api.openai.com/v1"',
    '[model_providers.DeepSeek]',
    'base_url = "http://127.0.0.1:9090"',
  ].join('\n'));

  assert.equal(baseUrl, 'http://127.0.0.1:9090');
});

test('falls back to OpenAI provider when active provider is missing', () => {
  const baseUrl = resolveCodexBaseUrlFromConfigText([
    '[model_providers.OpenAI]',
    'base_url = "https://api.openai.com/v1"',
  ].join('\n'));

  assert.equal(baseUrl, 'https://api.openai.com/v1');
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
npx tsx --test server/services/codex-config.test.ts
```

Expected: FAIL because `codex-config.ts` does not exist.

- [ ] **Step 3: Implement Codex config reader**

Create `server/services/codex-config.ts`:

```ts
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

interface ParsedCodexProvider {
  baseUrl?: string;
}

interface ParsedCodexConfig {
  modelProvider?: string;
  modelProviders: Record<string, ParsedCodexProvider>;
}

export function resolveCodexConfigPath(home = homedir()): string {
  return join(home, '.codex', 'config.toml');
}

export function parseCodexConfig(text: string): ParsedCodexConfig {
  const out: ParsedCodexConfig = { modelProviders: {} };
  let section = '';
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const sectionMatch = /^\[([^\]]+)\]$/.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1]!;
      continue;
    }
    const kv = /^([A-Za-z0-9_.-]+)\s*=\s*"([^"]*)"$/.exec(line);
    if (!kv) continue;
    const key = kv[1]!;
    const value = kv[2]!;
    if (!section && key === 'model_provider') {
      out.modelProvider = value;
      continue;
    }
    const providerMatch = /^model_providers\.([A-Za-z0-9_.-]+)$/.exec(section);
    if (providerMatch && key === 'base_url') {
      const provider = providerMatch[1]!;
      out.modelProviders[provider] = { ...out.modelProviders[provider], baseUrl: value };
    }
  }
  return out;
}

export function resolveCodexBaseUrlFromConfigText(text: string): string {
  const parsed = parseCodexConfig(text);
  const active = parsed.modelProvider;
  if (active && parsed.modelProviders[active]?.baseUrl) return parsed.modelProviders[active]!.baseUrl!;
  if (parsed.modelProviders.OpenAI?.baseUrl) return parsed.modelProviders.OpenAI.baseUrl;
  const first = Object.values(parsed.modelProviders).find((provider) => provider.baseUrl);
  if (first?.baseUrl) return first.baseUrl;
  return 'https://api.openai.com/v1';
}

export function readCodexBaseUrl(configPath = resolveCodexConfigPath()): string {
  if (!existsSync(configPath)) return 'https://api.openai.com/v1';
  return resolveCodexBaseUrlFromConfigText(readFileSync(configPath, 'utf-8'));
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
npx tsx --test server/services/codex-config.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/services/codex-config.ts server/services/codex-config.test.ts
git commit -m "feat(codex): read calibration base url"
```

---

## Task 9: Source-Specific Calibration Launchers and Jobs

**Files:**
- Create: `server/services/calibration-launchers.ts`
- Create: `server/services/calibration-launchers.test.ts`
- Modify: `server/services/calibration-job.ts`
- Modify: `server/services/calibration-job.test.ts`

- [ ] **Step 1: Write launcher tests**

Create `server/services/calibration-launchers.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCalibrationProxyArgs } from './calibration-launchers';

test('builds Claude proxy args with backward-compatible defaults', () => {
  const args = buildCalibrationProxyArgs({
    source: 'claude',
    scriptPath: '/repo/scripts/calibration-proxy.cjs',
    cwd: '/work',
    targetHost: 'api.deepseek.com',
    port: 18000,
    timeoutMs: 45000,
    prompt: 'say hi',
  });

  assert.deepEqual(args, [
    '/repo/scripts/calibration-proxy.cjs',
    '--source', 'claude',
    '--cwd', '/work',
    '--target-host', 'api.deepseek.com',
    '--port', '18000',
    '--timeout-ms', '45000',
    '--',
    '-p', 'say hi',
  ]);
});

test('builds Codex proxy args using base-url capture mode', () => {
  const args = buildCalibrationProxyArgs({
    source: 'codex',
    scriptPath: '/repo/scripts/calibration-proxy.cjs',
    cwd: '/work',
    targetHost: 'http://127.0.0.1:9090',
    port: 18001,
    timeoutMs: 45000,
    prompt: 'Calibration probe: reply with "ok".',
  });

  assert.deepEqual(args, [
    '/repo/scripts/calibration-proxy.cjs',
    '--source', 'codex',
    '--cwd', '/work',
    '--target-host', 'http://127.0.0.1:9090',
    '--port', '18001',
    '--timeout-ms', '45000',
    '--',
    'Calibration probe: reply with "ok".',
  ]);
});
```

- [ ] **Step 2: Run launcher tests and verify they fail**

Run:

```bash
npx tsx --test server/services/calibration-launchers.test.ts
```

Expected: FAIL because `calibration-launchers.ts` does not exist.

- [ ] **Step 3: Implement launcher argument builder**

Create `server/services/calibration-launchers.ts`:

```ts
import type { AgentSource } from '../../src/pipeline/calibration-types';

export interface BuildCalibrationProxyArgsOptions {
  source: AgentSource;
  scriptPath: string;
  cwd: string;
  targetHost: string;
  port: number;
  timeoutMs: number;
  prompt: string;
}

export function buildCalibrationProxyArgs(options: BuildCalibrationProxyArgsOptions): string[] {
  const base = [
    options.scriptPath,
    '--source', options.source,
    '--cwd', options.cwd,
    '--target-host', options.targetHost,
    '--port', String(options.port),
    '--timeout-ms', String(options.timeoutMs),
    '--',
  ];

  if (options.source === 'codex') return [...base, options.prompt];

  return [...base, '-p', options.prompt];
}
```

- [ ] **Step 4: Update job tests**

In `server/services/calibration-job.test.ts`, add:

```ts
import { defaultCalibrationPrompt, defaultCalibrationTarget } from './calibration-job';

test('defaults calibration prompt by source', () => {
  assert.equal(defaultCalibrationPrompt('claude'), 'say hi');
  assert.equal(defaultCalibrationPrompt('codex'), 'Calibration probe: reply with "ok".');
});

test('defaults calibration target by source', () => {
  assert.equal(defaultCalibrationTarget('claude'), 'api.deepseek.com');
  assert.equal(defaultCalibrationTarget('codex', () => 'http://127.0.0.1:9090'), 'http://127.0.0.1:9090');
});
```

- [ ] **Step 5: Update `calibration-job.ts` imports and options**

In `server/services/calibration-job.ts`, import:

```ts
import type { AgentSource, NormalizedCalibration } from '../../src/pipeline/calibration-types';
import { normalizeAgentSource } from '../../src/pipeline/calibration-types';
import { extractCodexConstants } from '../../src/pipeline/extract-codex-constants';
import { buildCalibrationProxyArgs } from './calibration-launchers';
import { readCodexBaseUrl } from './codex-config';
```

Change:

```ts
import { extractConstants, type ExtractedConstants } from '../../src/pipeline/extract-constants';
```

to:

```ts
import { extractConstants } from '../../src/pipeline/extract-constants';
```

Change `CalibrationJobSnapshot.result`:

```ts
  source: AgentSource;
  result: NormalizedCalibration | null;
```

Change `StartCalibrationJobOptions`:

```ts
  source?: AgentSource;
```

Add exports:

```ts
export function defaultCalibrationPrompt(source: AgentSource): string {
  return source === 'codex' ? 'Calibration probe: reply with "ok".' : 'say hi';
}

export function defaultCalibrationTarget(source: AgentSource, readBaseUrl = readCodexBaseUrl): string {
  return source === 'codex' ? readBaseUrl() : 'api.deepseek.com';
}
```

- [ ] **Step 6: Select extractor and build normalized job result**

Inside `startCalibrationJob()`, add near the top:

```ts
  const source = normalizeAgentSource(options.source);
```

Replace target and prompt defaults:

```ts
  const targetHost = options.targetHost || defaultCalibrationTarget(source);
  const prompt = options.prompt || defaultCalibrationPrompt(source);
```

Set `source` on the job object.

Replace manual `args` construction with:

```ts
  const args = buildCalibrationProxyArgs({
    source,
    scriptPath: SCRIPT_PATH,
    cwd,
    targetHost,
    port,
    timeoutMs,
    prompt,
  });
```

Replace extraction block:

```ts
      const extracted = source === 'codex'
        ? extractCodexConstants(job.logFile)
        : extractConstants(job.logFile);
      if (!extracted) throw new Error('capture log did not contain a valid API request');
      job.result = {
        schemaVersion: 1,
        source,
        constantsSource: 'project',
        cwd: job.cwd,
        rawLogPath: job.logFile,
        cliVersion: 'cliVersion' in extracted ? extracted.cliVersion : undefined,
        ccVersion: 'ccVersion' in extracted ? extracted.ccVersion : undefined,
        model: extracted.model,
        wireApi: 'wireApi' in extracted ? extracted.wireApi : undefined,
        categories: extracted.summary.categories,
        usage: extracted.summary.usage,
        toolNames: extracted.summary.toolNames,
        hashes: extracted.summary.hashes,
        details: extracted.details,
      };
```

- [ ] **Step 7: Run job and launcher tests**

Run:

```bash
npx tsx --test server/services/calibration-launchers.test.ts server/services/calibration-job.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/services/calibration-launchers.ts server/services/calibration-launchers.test.ts server/services/calibration-job.ts server/services/calibration-job.test.ts
git commit -m "feat(calibrate): add source-aware jobs"
```

---

## Task 10: Source-Aware Calibration Routes

**Files:**
- Modify: `server/routes/calibrate.ts`
- Modify: `src/components/pages/CalibratePage.tsx`

- [ ] **Step 1: Update route imports**

In `server/routes/calibrate.ts`, replace constants imports with:

```ts
import {
  readCalibrationConstants,
  writeCalibrationConstants,
} from '../services/calibration-constants';
import { normalizeAgentSource } from '../../src/pipeline/calibration-types';
```

- [ ] **Step 2: Update `PUT /apply` body parsing**

Replace the body type and source handling:

```ts
    const body = req.body as {
      source?: string;
      cwd?: string;
      summary?: any;
      details?: Record<string, string>;
      ccVersion?: string;
      cliVersion?: string;
      model?: string;
      wireApi?: string;
      rawLogPath?: string;
    };
    const source = normalizeAgentSource(body.source);
```

Replace the write call:

```ts
    const data = writeCalibrationConstants(body.cwd, {
      source,
      summary: body.summary,
      details: body.details,
      ccVersion: body.ccVersion,
      cliVersion: body.cliVersion,
      model: body.model,
      wireApi: body.wireApi,
      rawLogPath: body.rawLogPath,
    });
```

- [ ] **Step 3: Update `GET /current` source query**

Replace:

```ts
    return res.json(readProjectConstants(cwd));
```

with:

```ts
    const source = normalizeAgentSource(_req.query.source);
    return res.json(readCalibrationConstants(cwd, source));
```

- [ ] **Step 4: Update auto start body**

In `router.post('/auto/start')`, keep:

```ts
    const job = await startCalibrationJob(req.body || {});
```

No route-level special case is needed because `startCalibrationJob()` normalizes source.

- [ ] **Step 5: Update the initial UI API calls minimally**

In `src/components/pages/CalibratePage.tsx`, add state near `autoJob`:

```ts
  const [calibrationSource, setCalibrationSource] = useState<'claude' | 'codex'>('claude');
```

Change current constants request:

```ts
    get<CurrentConstants>(`/calibrate/current?cwd=${encodeURIComponent(sessionCwd)}&source=${calibrationSource}`)
```

Add `calibrationSource` to that effect dependency array.

Change auto start body:

```ts
        source: calibrationSource,
```

Change apply body:

```ts
        source: calibrationSource,
```

Change refresh-after-apply request to include `source=${calibrationSource}`.

- [ ] **Step 6: Run build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/routes/calibrate.ts src/components/pages/CalibratePage.tsx
git commit -m "feat(calibrate): route requests by source"
```

---

## Task 11: Category-Driven Calibration UI

**Files:**
- Modify: `src/components/pages/calibrationDetailModal.ts`
- Modify: `src/components/pages/calibrationDetailModal.test.ts`
- Modify: `src/components/pages/CalibratePage.tsx`

- [ ] **Step 1: Update detail modal tests**

In `src/components/pages/calibrationDetailModal.test.ts`, replace fixed-key tests with:

```ts
test('builds stable translation cache slot for arbitrary calibration detail keys', () => {
  const first = getCalibrationDetailTranslationSlot('codex.tools', 'alpha');
  const second = getCalibrationDetailTranslationSlot('codex.tools', 'alpha');
  const third = getCalibrationDetailTranslationSlot('codex.instructions', 'alpha');

  assert.deepEqual(first, second);
  assert.notEqual(first.sectionIndex, third.sectionIndex);
});

test('renders tool detail as markdown for any tool_defs detail key', () => {
  const detail = ['# codex.tools', '', '字符数: 10', '', '```json', '{"name":"Read"}', '```'].join('\n');
  assert.deepEqual(getCalibrationDetailDisplay('codex.tools', detail), {
    text: detail,
    markdown: true,
  });
});

test('renders non-tool details as plain text', () => {
  const detail = ['# codex.instructions', '', '字符数: 10', '', 'hello'].join('\n');
  assert.deepEqual(getCalibrationDetailDisplay('codex.instructions', detail), {
    text: 'hello',
    markdown: false,
  });
});
```

- [ ] **Step 2: Run detail tests and verify they fail**

Run:

```bash
npx tsx --test src/components/pages/calibrationDetailModal.test.ts
```

Expected: FAIL because `CalibrationDetailKey` is still a fixed union.

- [ ] **Step 3: Generalize detail modal helper**

In `src/components/pages/calibrationDetailModal.ts`, replace:

```ts
export type CalibrationDetailKey =
  | 'SYS_PROMPT_FALLBACK_CHARS'
  | 'TOOL_DEFS_FALLBACK_CHARS'
  | 'SYSTEM_REMINDER_CHROME_CHARS';
```

with:

```ts
export type CalibrationDetailKey = string;
```

Change tool markdown detection:

```ts
  if (key.includes('tool_defs') || key.includes('tools')) {
    return { text: detail, markdown: true };
  }
```

Change section index base:

```ts
  return 930000000 + hashText(`${key}\n${text}`);
```

Change `unwrapPlainTextDetail()` regex to accept arbitrary headings:

```ts
function unwrapPlainTextDetail(_key: CalibrationDetailKey, detail: string): string {
  const legacy = /^# [^\n]+\n\n字符数: \d+\n\n```text\n([\s\S]*)\n```$/.exec(detail);
  if (legacy) return legacy[1]!;

  const current = /^# [^\n]+\n\n字符数: \d+\n\n([\s\S]*)$/.exec(detail);
  return current?.[1] ?? detail;
}
```

- [ ] **Step 4: Update `CalibratePage.tsx` types**

Replace `ConstantKey` with:

```ts
type ConstantKey = string;
```

Replace `ExtractedResult.summary` type:

```ts
  summary: {
    categories: Partial<Record<string, { chars: number; detailKey?: string }>>;
    usage?: {
      firstRequestInputTokens?: number;
      firstRequestCachedTokens?: number;
      firstRequestOutputTokens?: number;
      firstRequestReasoningTokens?: number;
    };
    toolNames?: string[];
    hashes?: Record<string, string>;
  };
```

Replace `CurrentConstants` fixed fields with:

```ts
  schemaVersion?: 1;
  source?: 'claude' | 'codex' | 'opencode' | 'openclaw';
  constantsSource?: 'project' | 'defaults';
  categories: Partial<Record<string, { chars: number; detailKey?: string }>>;
```

Keep `ccVersion`, `model`, `details`, `appliedAt`, `path`, and `cwd`.

- [ ] **Step 5: Add source selector UI**

Near the top controls in `CalibratePage.tsx`, add a compact selector:

```tsx
<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
  {(['claude', 'codex'] as const).map((source) => (
    <button
      key={source}
      onClick={() => setCalibrationSource(source)}
      style={{
        border: `1px solid ${calibrationSource === source ? S.accent : S.borderColor}`,
        borderRadius: 7,
        padding: '6px 10px',
        background: calibrationSource === source ? 'oklch(0.24 0.04 245)' : 'oklch(0.20 0.01 265)',
        color: calibrationSource === source ? S.textPrimary3 : S.textSecondary,
        cursor: 'pointer',
      }}
    >
      {source === 'claude' ? 'Claude Code' : 'Codex'}
    </button>
  ))}
</div>
```

- [ ] **Step 6: Render category cards from normalized summary**

Add helper inside `CalibratePage.tsx`:

```ts
  const categoryRows = useMemo(() => {
    const categories = result?.summary.categories ?? currentConstants?.categories ?? {};
    return Object.entries(categories)
      .filter(([, value]) => typeof value?.chars === 'number' && value.chars > 0)
      .map(([key, value]) => ({
        key,
        label: key,
        chars: value!.chars,
        detailKey: value!.detailKey,
        detail: value!.detailKey ? (result?.details?.[value!.detailKey] ?? currentConstants?.details?.[value!.detailKey]) : undefined,
      }));
  }, [currentConstants, result]);
```

Use `categoryRows` to render `StatCard` entries. The `DetailButton` opens:

```ts
openDetail(row.detailKey || row.key, { [row.detailKey || row.key]: row.detail }, row.label)
```

- [ ] **Step 7: Run UI helper tests and build**

Run:

```bash
npx tsx --test src/components/pages/calibrationDetailModal.test.ts
npm run build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/pages/calibrationDetailModal.ts src/components/pages/calibrationDetailModal.test.ts src/components/pages/CalibratePage.tsx
git commit -m "feat(calibrate): render normalized categories"
```

---

## Task 12: Session Source Enum Expansion

**Files:**
- Modify: `src/utils/sessionSource.ts`
- Modify: `src/utils/sessionSource.test.ts`

- [ ] **Step 1: Add source tests**

In `src/utils/sessionSource.test.ts`, add:

```ts
test('supports future explicit agent sources', () => {
  assert.equal(getSessionSource({ source: 'opencode' }), 'opencode');
  assert.equal(getSessionSource({ source: 'openclaw' }), 'openclaw');
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
npx tsx --test src/utils/sessionSource.test.ts
```

Expected: FAIL because `SessionSource` only accepts `claude | codex`.

- [ ] **Step 3: Expand source type**

In `src/utils/sessionSource.ts`, change:

```ts
export type SessionSource = 'claude' | 'codex';
```

to:

```ts
export type SessionSource = 'claude' | 'codex' | 'opencode' | 'openclaw';
```

Change explicit source branch:

```ts
  if (
    session.source === 'codex' ||
    session.source === 'claude' ||
    session.source === 'opencode' ||
    session.source === 'openclaw'
  ) return session.source;
```

- [ ] **Step 4: Run source tests**

Run:

```bash
npx tsx --test src/utils/sessionSource.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/sessionSource.ts src/utils/sessionSource.test.ts
git commit -m "feat(sessions): allow future agent sources"
```

---

## Task 13: Documentation Update

**Files:**
- Modify: `docs/superpowers/specs/2026-06-26-codex-calibration-design.md`

- [ ] **Step 1: Update storage and API sections**

In `docs/superpowers/specs/2026-06-26-codex-calibration-design.md`, change the old `src/pipeline/codex-system-constants.json` destination to:

```text
<cwd>/.codex-trace/codex-system-constants.json
```

Add this paragraph under "Extracted Constants":

```md
Codex constants use the shared normalized calibration schema. Codex-specific fields such as `instructionsChars`, `toolsChars`, and `developerChars` may still appear in extractor output for debugging, but the persisted project constants are stored under `categories.sysPrompt`, `categories.tool_defs`, `categories.skills`, `categories.mcp`, and `categories.reminders`.
```

- [ ] **Step 2: Update API examples**

Change examples so `PUT /api/calibrate/apply` sends:

```json
{
  "source": "codex",
  "cwd": "/absolute/project",
  "summary": {
    "categories": {
      "sysPrompt": { "chars": 21335, "detailKey": "codex.instructions" },
      "tool_defs": { "chars": 12345, "detailKey": "codex.tools" }
    }
  }
}
```

- [ ] **Step 3: Review the doc**

Run:

```bash
rg -n "src/pipeline/codex-system-constants.json|Do not merge Claude and Codex constants into one schema" docs/superpowers/specs/2026-06-26-codex-calibration-design.md
```

Expected: no matches.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-06-26-codex-calibration-design.md
git commit -m "docs: align Codex calibration with unified schema"
```

---

## Task 14: Final Verification

**Files:**
- No source edits expected.

- [ ] **Step 1: Run focused backend and pipeline tests**

Run:

```bash
npx tsx --test \
  src/pipeline/calibration-types.test.ts \
  src/pipeline/extract-constants.test.ts \
  src/pipeline/extract-codex-constants.test.ts \
  src/pipeline/compute-context.test.ts \
  src/pipeline/codex-jsonl.test.ts \
  server/services/calibration-constants.test.ts \
  server/services/codex-config.test.ts \
  server/services/calibration-launchers.test.ts \
  server/services/calibration-job.test.ts \
  src/utils/sessionSource.test.ts \
  src/components/pages/calibrationDetailModal.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run proxy utility tests**

Run:

```bash
node --test scripts/calibration-proxy-utils.test.cjs
```

Expected: PASS.

- [ ] **Step 3: Run production build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 4: Manual smoke test Claude current endpoint**

Start server:

```bash
npm run server
```

In a second terminal, run:

```bash
curl "http://127.0.0.1:4137/api/calibrate/current?cwd=$(pwd)&source=claude"
```

Expected JSON contains:

```json
{
  "schemaVersion": 1,
  "source": "claude",
  "categories": {
    "sysPrompt": { "chars": 5768 },
    "tool_defs": { "chars": 98949 },
    "userMsgs": { "chars": 612 }
  }
}
```

- [ ] **Step 5: Manual smoke test Codex current endpoint**

With the same server running, run:

```bash
curl "http://127.0.0.1:4137/api/calibrate/current?cwd=$(pwd)&source=codex"
```

Expected JSON contains:

```json
{
  "schemaVersion": 1,
  "source": "codex",
  "constantsSource": "defaults",
  "categories": {}
}
```

- [ ] **Step 6: Final commit**

If verification changed no files, no commit is needed. If docs or tests were adjusted during verification, commit them:

```bash
git status --short
git add docs/superpowers/specs/2026-06-26-codex-calibration-design.md src server scripts
git commit -m "test(calibrate): verify unified calibration"
```

---

## Self-Review Checklist

- Spec coverage:
  - Unified normalized schema: Task 1.
  - Project-scoped source-aware storage: Task 2.
  - Claude migration: Tasks 3 and 4.
  - Codex extraction and fallback: Tasks 5 and 6.
  - Raw API log persistence with source-specific trace directories: Task 7.
  - Codex base URL discovery: Task 8.
  - Automatic calibration source selection: Tasks 9 and 10.
  - Category-driven UI: Task 11.
  - Future agent source names: Task 12.
  - Documentation update: Task 13.
  - Verification: Task 14.
- Placeholder scan:
  - This plan intentionally avoids undefined future extractors for opencode/openclaw. They are represented only as supported source enum values.
- Type consistency:
  - `NormalizedCalibrationSummary.categories` is the one summary shape used by extractors, storage, pipelines, jobs, routes, and UI.
  - Claude legacy keys survive only through compatibility helpers and legacy wrapper functions.
