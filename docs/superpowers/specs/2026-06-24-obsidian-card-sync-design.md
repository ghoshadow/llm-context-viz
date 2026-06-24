# Obsidian Knowledge Card Sync Design

## Goal

Add a first-version Obsidian sync feature that persists one ontology knowledge card as one Markdown note in a local Obsidian vault.

The feature should make the current knowledge card reusable outside this app while preserving traceability back to the original session, topic node, related nodes, relations, evidence, and generated or manually edited knowledge summary.

## Scope

In scope:

- Sync one selected topic knowledge card to one Markdown file.
- Use a configured local Obsidian vault path.
- Write Markdown directly to the local filesystem from the backend.
- Preserve user notes outside a managed sync block on repeated sync.
- Track sync status, note path, content hash, and errors in SQLite.
- Show sync state and actions in the ontology detail panel.

Out of scope for the first version:

- Obsidian plugin integration.
- Splitting a card into multiple atomic notes.
- Two-way sync from Obsidian back into the ontology database.
- Bulk sync of all cards.
- Automatic sync after every ontology rebuild.

## Recommended UX

The topic node detail panel adds an "同步到 Obsidian" action near the existing knowledge summary controls.

States:

- Not configured: show "配置 Obsidian" and open a small settings panel.
- Ready: show "同步到 Obsidian".
- Syncing: show "同步中".
- Synced: show "已同步" with the relative note path.
- Failed: show "同步失败" with retry.

The first version should require a topic card. Non-topic nodes do not show the sync action.

## Configuration

Store Obsidian settings locally in SQLite or a small config table:

- `vault_path`: absolute path to the Obsidian vault.
- `notes_dir`: relative directory inside the vault, default `LLM知识卡片`.
- `filename_template`: default `第{{startTurn}}-{{endTurn}}轮 - {{title}}.md`.

Backend validation:

- `vault_path` must exist and be a directory.
- `notes_dir` must be relative.
- Resolved note paths must stay inside `vault_path`.

## Data Model

Add table:

```sql
CREATE TABLE IF NOT EXISTS ontology_obsidian_syncs (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  topic_id TEXT NOT NULL,
  vault_path TEXT NOT NULL,
  note_path TEXT NOT NULL,
  content_hash TEXT,
  status TEXT NOT NULL,
  error TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  last_synced_at TEXT,
  PRIMARY KEY (session_id, topic_id)
);
```

`note_path` stores the path relative to the vault root so moving the vault can be handled later by updating config.

## Backend API

Add Obsidian config endpoints:

- `GET /api/obsidian/config`
- `PUT /api/obsidian/config`

Add card sync endpoints:

- `GET /api/sessions/:id/ontology/obsidian-card/:topicId`
- `POST /api/sessions/:id/ontology/obsidian-card/:topicId`

The POST endpoint:

1. Loads ontology data for the session.
2. Validates the target node exists and is type `topic`.
3. Loads saved knowledge summary from `ontology_card_summaries`.
4. Builds the full card context using the same aggregate-node logic as knowledge summary.
5. Renders Markdown.
6. Writes or updates the note in the configured vault.
7. Stores sync status and returns the final state.

If the card has no knowledge summary yet, the sync should still work by rendering the structured card content and marking the summary section as absent. The frontend can gently suggest generating a summary first, but should not block sync.

## Markdown Format

Each synced card becomes one note:

```md
---
source: llm-context-viz
session_id: "<session-id>"
topic_id: "<topic-id>"
aggregate_id: "<aggregate-id>"
turn_range: "1-20"
synced_at: "2026-06-24T00:00:00.000Z"
tags:
  - llm-context
  - ontology-card
---

# Card Title

<!-- llm-context-viz:start -->

## 知识总结

...

## 知识链路

### 问题/主题

...

### 为什么

...

### 怎么做

...

### 坑/教训

...

### 经验法则

...

### 工具/技巧

...

## 关系

- A --关系--> B
- A --相关-- B
- A <--互补--> B

## 证据

- 第 2 轮 · 用户 · 100%: ...

## 来源

- Session: `<session-id>`
- Topic ID: `<topic-id>`
- Turn range: 第 1-20 轮

<!-- llm-context-viz:end -->

## 我的补充

```

Repeated sync only replaces content between:

- `<!-- llm-context-viz:start -->`
- `<!-- llm-context-viz:end -->`

Content outside the managed block is preserved. If a file exists without both markers, the backend must not overwrite it and should return a conflict error with a suggested alternate filename.

## Filename Rules

Generate a safe filename from the aggregate title or topic label.

Rules:

- Remove `/ \ : * ? " < > |`.
- Collapse whitespace.
- Limit title part to 80 characters.
- Use turn range prefix when available.
- If the target filename exists but is not a managed note, append a short topic hash.

Example:

```text
LLM知识卡片/第001-020轮 - 本体构建与知识抽取.md
```

## Card Context Builder

Create a backend helper for reusable card context:

- `getKnowledgeCardContext(data, topicId)`

It should return:

- topic node
- aggregate metadata
- ordered card nodes
- card edges
- evidence grouped and sorted by turn
- saved summary status and summary text
- computed filename title and turn range

This avoids duplicating the current summary prompt logic and future Obsidian export logic.

## Security

The backend must:

- Resolve all paths using `path.resolve`.
- Reject writes outside `vault_path`.
- Reject absolute `notes_dir`.
- Create only the configured notes directory.
- Avoid overwriting unmanaged files.
- Write files with UTF-8.
- Return clear errors for missing vault, permission failure, path conflict, and missing ontology.

## Error Handling

Frontend should show:

- Missing vault config.
- Invalid vault path.
- File conflict.
- Filesystem write failure.
- Missing ontology data.
- Missing topic node.

Backend should persist the latest sync error in `ontology_obsidian_syncs` when sync fails after a topic is identified.

## Testing

Backend:

- Config validation rejects invalid paths.
- Markdown renderer includes summary, node sections, relations, evidence, and frontmatter.
- Sync creates a new note.
- Sync updates only the managed block.
- Sync preserves user content outside the managed block.
- Sync refuses to overwrite unmanaged existing files.
- Path traversal attempts are rejected.

Frontend:

- Topic detail shows sync action.
- Non-topic nodes do not show sync action.
- Config missing state leads to configuration UI.
- Success state displays relative note path.
- Failure state displays retry and error message.

Manual verification:

- Configure a temporary vault directory.
- Sync a card.
- Open the generated note in Obsidian.
- Edit below "我的补充".
- Sync again and confirm the user note is preserved.

## Implementation Order

1. Add shared card context helper.
2. Add Markdown renderer and safe path helpers.
3. Add DB table and config persistence.
4. Add backend config and sync endpoints.
5. Add frontend sync state and controls.
6. Run build and manual filesystem sync verification.

