# Project-Scoped Calibration Constants Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make calibration constants apply by project `cwd` instead of globally.

**Architecture:** Add a small shared constants store that resolves `<cwd>/.claude-trace/system-constants.json`, validates `cwd`, and loads/writes calibrated values. Backend routes use this store. The Claude pipeline resets to defaults for each run and loads constants for the transcript's `cwd` before computing context.

**Tech Stack:** TypeScript, Express, Node `fs/path`, existing `node:test` + `tsx` tests, React.

---

### Task 1: Add Project Constants Store

**Files:**
- Create: `server/services/calibration-constants.ts`
- Create: `server/services/calibration-constants.test.ts`

- [ ] Write tests for resolving, reading defaults, and writing project constants.
- [ ] Implement `resolveProjectConstantsPath(cwd)`, `readProjectConstants(cwd)`, and `writeProjectConstants(cwd, data)`.
- [ ] Verify with `npx tsx --test server/services/calibration-constants.test.ts`.

### Task 2: Scope Calibrate API by cwd

**Files:**
- Modify: `server/routes/calibrate.ts`

- [ ] Update `GET /current` to require `cwd` query param and return project/default metadata.
- [ ] Update `PUT /apply` to require `cwd` in body and write project constants.
- [ ] Keep invalid or unwritable cwd errors actionable.
- [ ] Verify with route smoke through the dev server.

### Task 3: Load Project Constants in Pipeline

**Files:**
- Modify: `src/pipeline/compute-context.ts`
- Modify: `src/pipeline/index.ts`
- Modify: `server/services/pipeline-service.ts`
- Test: `src/pipeline/compute-context.test.ts` or `server/services/calibration-constants.test.ts`

- [ ] Add reset/load APIs so constants do not leak across runs.
- [ ] Extract transcript `cwd` before running the Claude pipeline.
- [ ] Load `<cwd>/.claude-trace/system-constants.json` for each pipeline run.
- [ ] Fall back to built-in defaults when project constants are missing.

### Task 4: Update Calibrate UI

**Files:**
- Modify: `src/components/pages/CalibratePage.tsx`

- [ ] Fetch current constants with `cwd` when the selected session changes.
- [ ] Send `cwd` when applying constants.
- [ ] Rename the section to `当前项目生效的常量`.
- [ ] Show source path or default-source note.

### Task 5: Verify and Commit

**Files:**
- All modified files

- [ ] Run focused tests.
- [ ] Run `npm run build`.
- [ ] Smoke `GET /api/calibrate/current?cwd=...` and `PUT /api/calibrate/apply`.
- [ ] Commit with `fix(calibrate): scope constants by project`.
