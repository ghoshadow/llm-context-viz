# Fix Ontology Shard Result Collection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ontology shard extraction recover large subagent JSON results persisted by Claude Agent SDK under `tool-results/call_*.json`.

**Architecture:** Keep the existing Agent SDK orchestration and SSE/storage contracts. Add a narrow recovery path in the backend collector and make the response parser understand nested text-wrapped JSON.

**Tech Stack:** TypeScript, Node ESM, `node:test`, `node:assert/strict`, Claude Agent SDK, Zod schema validation.

---

This plan is mirrored in `.trellis/tasks/07-03-fix-ontology-shard-result-collection/implement.md`.

## Files

- Modify: `server/llm/ontology-response-parser.ts`
- Modify: `server/llm/ontology-shard-collector.ts`
- Create: `server/llm/ontology-response-parser.test.ts`
- Create: `server/llm/ontology-shard-collector.test.ts`

## Tasks

1. Parse text-wrapped Agent results in `ontology-response-parser.ts`.
2. Add safe `tool-results/call_*.json` recovery helpers in `ontology-shard-collector.ts`.
3. Wire recovery into `collectShardTextResults()` using `tool_use_id -> file_path`.
4. Verify with focused tests, `npm test`, and `npm run build`.

For exact step-by-step code snippets, commands, and expected outcomes, use the Trellis implementation plan:

```text
.trellis/tasks/07-03-fix-ontology-shard-result-collection/implement.md
```
