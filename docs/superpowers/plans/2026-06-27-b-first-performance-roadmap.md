# B-First Performance Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stabilize server verification and remove the current growth bottlenecks without prematurely rewriting the ontology schema.

**Architecture:** Keep existing public data shapes compatible where possible, add small helper modules for pagination and benchmark checks, and use SQLite migrations for low-risk indexes. Frontend pagination is additive: initial pages load recent turns and users can request more. Ontology table decomposition is deferred behind measurable triggers.

**Tech Stack:** TypeScript, Express, better-sqlite3, React, Zustand, Node test runner, Vite.

---

### Phase 0: Verification Groundwork

**Files:**
- Modify: `tsconfig.server.json`
- Modify: `server/routes/obsidian.ts`
- Modify: `server/routes/ontology.ts`
- Modify: `server/routes/scanner.ts`

- [ ] Fix service-side typecheck issues that are in project code.
- [ ] Keep dependency declaration noise out of server verification with appropriate compiler options.
- [ ] Verify with `npx tsc -p tsconfig.server.json --noEmit`.

### Phase 1: SQLite and API Hot Paths

**Files:**
- Modify: `server/db.ts`
- Modify: `server/routes/sessions.ts`
- Create: `server/routes/pagination.ts`
- Create: `server/routes/pagination.test.ts`
- Modify: `src/types/session.ts`

- [ ] Add `idx_turns_session_turn_index` in initial schema and migration path.
- [ ] Replace session detail `SELECT *` with explicit columns excluding `raw_jsonl`.
- [ ] Add `GET /sessions/:id/turns?limit=&offset=` with a paged response by default.
- [ ] Support `?all=1` for compatibility and internal refreshes.
- [ ] Verify query plan no longer uses a temp B-tree for ordered turn lists.

### Phase 2: Scanner I/O

**Files:**
- Modify: `server/routes/scanner.ts`

- [ ] Make quick metadata parse from already-read content instead of reading the JSONL twice.
- [ ] Preserve Claude/Codex metadata behavior.

### Phase 3: Frontend Pagination Compatibility

**Files:**
- Modify: `src/store/sessionStore.ts`
- Modify: `src/components/pages/TurnInspector.tsx`
- Modify: `src/types/session.ts`

- [ ] Store pagination metadata and expose `fetchMoreTurns`.
- [ ] Load the first page on session select.
- [ ] Add a simple "load more" control in the turn list.
- [ ] Keep auto-refresh behavior using `all=1` for now to avoid live-session regressions.

### Phase 4: Benchmark Harness

**Files:**
- Create: `scripts/bench-db.ts`
- Modify: `package.json`

- [ ] Add a script that reports DB size, key row sizes, and the turn-list query plan.
- [ ] Fail or clearly warn when the ordered turn-list query uses a temp B-tree.

### Deferred C-Path Triggers

Ontology table decomposition remains deferred until at least one trigger is hit:
- ontology JSON regularly exceeds 5-10MB,
- turn count regularly exceeds several thousand per session,
- topic summary or Obsidian sync shows measurable latency from whole-graph parsing.
