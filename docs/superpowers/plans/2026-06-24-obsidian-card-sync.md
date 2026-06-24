# Obsidian Card Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build first-version one-click sync from one ontology topic knowledge card to one Markdown note in a local Obsidian vault.

**Architecture:** Add focused backend helpers for card-context extraction, Markdown rendering, and safe vault writes. Expose Obsidian config and card sync endpoints, then add a compact sync control in the ontology detail panel. Repeated sync updates only a managed Markdown block and preserves user notes outside it.

**Tech Stack:** TypeScript, Express, better-sqlite3, React, local filesystem writes, Markdown.

---

## Existing Context

The repository is currently on `main` and has uncommitted changes unrelated to this plan. Do not revert or overwrite them. Work with the current files as they are.

Relevant current files:

- `server/routes/sessions.ts` already contains ontology fetch/build and knowledge summary endpoints.
- `server/db.ts` initializes SQLite tables.
- `src/components/ontology/OntologyDetailPanel.tsx` already has topic-card knowledge summary UI and editable Markdown summary.
- `src/api/client.ts` exposes `get`, `post`, `put`, and `del`.
- `src/types/ontology.ts` defines ontology node/edge/evidence types.

Design spec:

- `docs/superpowers/specs/2026-06-24-obsidian-card-sync-design.md`

## File Structure

Create backend helper modules:

- `server/obsidian/card-context.ts`
  - Builds a reusable knowledge-card context from ontology data and `topicId`.
  - Shared by Obsidian sync and future summary/export features.

- `server/obsidian/markdown.ts`
  - Renders card context plus saved summary into a managed Obsidian Markdown block.
  - Provides safe filename helpers.

- `server/obsidian/sync.ts`
  - Validates vault config.
  - Resolves safe note paths.
  - Writes new notes.
  - Updates only `<!-- llm-context-viz:start -->` to `<!-- llm-context-viz:end -->` in managed notes.

- `server/routes/obsidian.ts`
  - `GET /api/obsidian/config`
  - `PUT /api/obsidian/config`

Modify backend files:

- `server/db.ts`
  - Add `obsidian_config` and `ontology_obsidian_syncs`.

- `server/index.ts`
  - Register `/api/obsidian`.

- `server/routes/sessions.ts`
  - Add card sync status and sync endpoints.

Modify frontend files:

- `src/components/ontology/OntologyDetailPanel.tsx`
  - Add sync state, config form, and sync controls for topic cards.

- `src/api/client.ts`
  - No required structural change unless better error handling is needed.

## Task 1: Backend Card Context And Markdown Helpers

**Files:**

- Create: `server/obsidian/card-context.ts`
- Create: `server/obsidian/markdown.ts`

- [ ] **Step 1: Create card context helper**

Create `server/obsidian/card-context.ts`:

```ts
import type { OntologyEvidence } from '../../src/types/ontology';

export interface ObsidianNodeLike {
  id: string;
  label: string;
  type: string;
  firstTurn: number;
  turns?: number[];
  aliases?: string[];
  claim?: string;
  snippet?: string;
  aggregateId?: string;
  evidence?: OntologyEvidence[];
}

export interface ObsidianEdgeLike {
  s: string;
  t: string;
  label: string;
  direction?: 'directed' | 'undirected' | 'bidirectional';
  firstTurn: number;
  conf?: number;
  evidence?: OntologyEvidence[];
}

export interface ObsidianAggregateLike {
  id: string;
  label: string;
  startTurn: number;
  endTurn: number;
  nodeIds?: string[];
}

export interface ObsidianOntologyDataLike {
  nodes: ObsidianNodeLike[];
  edges: ObsidianEdgeLike[];
  aggregates?: ObsidianAggregateLike[];
  types?: Array<{ key: string; label: string }>;
}

export interface KnowledgeCardContext {
  topic: ObsidianNodeLike;
  aggregate: ObsidianAggregateLike | null;
  nodes: ObsidianNodeLike[];
  edges: ObsidianEdgeLike[];
  evidence: OntologyEvidence[];
  title: string;
  startTurn: number;
  endTurn: number;
}

const TYPE_ORDER = ['topic', 'why', 'how_to', 'pitfall', 'heuristic', 'technique'];

export function nodeText(node: ObsidianNodeLike): string {
  return (node.claim || node.snippet || node.label || '').trim();
}

export function typeLabel(type: string): string {
  if (type === 'topic') return '问题/主题';
  if (type === 'why') return '为什么';
  if (type === 'how_to') return '怎么做';
  if (type === 'pitfall') return '坑/教训';
  if (type === 'heuristic') return '经验法则';
  if (type === 'technique') return '工具/技巧';
  return type;
}

export function getKnowledgeCardContext(data: ObsidianOntologyDataLike, topicId: string): KnowledgeCardContext {
  if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
    throw new Error('本体数据结构不完整');
  }

  const topic = data.nodes.find((node) => node.id === topicId);
  if (!topic) throw new Error('主题节点不存在');
  if (topic.type !== 'topic') throw new Error('只有问题/主题节点可以同步到 Obsidian');

  const aggregate = topic.aggregateId
    ? data.aggregates?.find((item) => item.id === topic.aggregateId) || null
    : null;

  const aggregateNodes = topic.aggregateId
    ? data.nodes.filter((node) => node.aggregateId === topic.aggregateId)
    : [];

  const relatedIds = new Set<string>([topic.id]);
  if (aggregateNodes.length === 0) {
    data.edges.forEach((edge) => {
      if (edge.s === topic.id) relatedIds.add(edge.t);
      if (edge.t === topic.id) relatedIds.add(edge.s);
    });
  }

  const nodes = (aggregateNodes.length > 0 ? aggregateNodes : data.nodes.filter((node) => relatedIds.has(node.id)))
    .slice()
    .sort((a, b) => {
      const ai = TYPE_ORDER.indexOf(a.type);
      const bi = TYPE_ORDER.indexOf(b.type);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
        || a.firstTurn - b.firstTurn
        || a.label.localeCompare(b.label);
    });

  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = data.edges
    .filter((edge) => nodeIds.has(edge.s) && nodeIds.has(edge.t))
    .slice()
    .sort((a, b) => a.firstTurn - b.firstTurn || a.s.localeCompare(b.s) || a.t.localeCompare(b.t));

  const evidenceMap = new Map<string, OntologyEvidence>();
  nodes.forEach((node) => {
    (node.evidence || []).forEach((ev) => {
      evidenceMap.set(`${ev.turn}:${ev.source}:${ev.text}`, ev);
    });
  });
  const evidence = Array.from(evidenceMap.values())
    .sort((a, b) => a.turn - b.turn || b.weight - a.weight || a.source.localeCompare(b.source));

  const turns = nodes.flatMap((node) => node.turns && node.turns.length > 0 ? node.turns : [node.firstTurn]);
  const startTurn = aggregate?.startTurn ?? Math.min(...turns, topic.firstTurn);
  const endTurn = aggregate?.endTurn ?? Math.max(...turns, topic.firstTurn);

  return {
    topic,
    aggregate,
    nodes,
    edges,
    evidence,
    title: aggregate?.label || topic.label,
    startTurn,
    endTurn,
  };
}
```

- [ ] **Step 2: Create Markdown renderer**

Create `server/obsidian/markdown.ts`:

```ts
import crypto from 'crypto';
import { KnowledgeCardContext, nodeText, typeLabel, type ObsidianEdgeLike } from './card-context';

export const MANAGED_START = '<!-- llm-context-viz:start -->';
export const MANAGED_END = '<!-- llm-context-viz:end -->';

export function sanitizeFilenamePart(value: string): string {
  return value
    .replace(/[\/\\:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    || '未命名知识卡片';
}

export function topicHash(sessionId: string, topicId: string): string {
  return crypto.createHash('sha1').update(`${sessionId}:${topicId}`).digest('hex').slice(0, 8);
}

export function renderFilename(context: KnowledgeCardContext, sessionId: string): string {
  const title = sanitizeFilenamePart(context.title);
  const range = `第${String(context.startTurn).padStart(3, '0')}-${String(context.endTurn).padStart(3, '0')}轮`;
  return `${range} - ${title}.md`;
}

function yamlString(value: string | null | undefined): string {
  const safe = String(value || '').replace(/"/g, '\\"');
  return `"${safe}"`;
}

function relationArrow(edge: ObsidianEdgeLike): string {
  if (edge.direction === 'undirected') return `--${edge.label}--`;
  if (edge.direction === 'bidirectional') return `<--${edge.label}-->`;
  return `--${edge.label}-->`;
}

function renderNodeSection(context: KnowledgeCardContext, type: string): string {
  const nodes = context.nodes.filter((node) => node.type === type);
  if (nodes.length === 0) return '';
  const lines = [`### ${typeLabel(type)}`, ''];
  for (const node of nodes) {
    lines.push(`- **${node.label}**：${nodeText(node) || node.label}`);
    if (node.aliases && node.aliases.length > 0) {
      lines.push(`  - 别名：${node.aliases.join('、')}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

export function renderManagedCardMarkdown(params: {
  sessionId: string;
  topicId: string;
  context: KnowledgeCardContext;
  summary: string | null;
  syncedAt: string;
}): string {
  const { sessionId, topicId, context, summary, syncedAt } = params;
  const nodeById = new Map(context.nodes.map((node) => [node.id, node]));
  const lines: string[] = [];

  lines.push(MANAGED_START, '');

  if (summary && summary.trim()) {
    lines.push('## 知识总结', '', summary.trim(), '');
  }

  lines.push('## 知识链路', '');
  for (const type of ['topic', 'why', 'how_to', 'pitfall', 'heuristic', 'technique']) {
    const section = renderNodeSection(context, type);
    if (section) lines.push(section);
  }

  if (context.edges.length > 0) {
    lines.push('## 关系', '');
    for (const edge of context.edges) {
      const source = nodeById.get(edge.s)?.label || edge.s;
      const target = nodeById.get(edge.t)?.label || edge.t;
      lines.push(`- ${source} ${relationArrow(edge)} ${target}`);
    }
    lines.push('');
  }

  if (context.evidence.length > 0) {
    lines.push('## 证据', '');
    for (const ev of context.evidence) {
      lines.push(`- 第 ${ev.turn} 轮 · ${ev.source} · ${Math.round(ev.weight * 100)}%: ${ev.text}`);
    }
    lines.push('');
  }

  lines.push('## 来源', '');
  lines.push(`- Session: \`${sessionId}\``);
  lines.push(`- Topic ID: \`${topicId}\``);
  lines.push(`- Turn range: 第 ${context.startTurn}-${context.endTurn} 轮`);
  if (context.aggregate?.id) lines.push(`- Aggregate ID: \`${context.aggregate.id}\``);
  lines.push('');
  lines.push(MANAGED_END);

  return lines.join('\n').trimEnd() + '\n';
}

export function renderFullNoteMarkdown(params: {
  sessionId: string;
  topicId: string;
  context: KnowledgeCardContext;
  summary: string | null;
  syncedAt: string;
}): string {
  const { context, sessionId, topicId, syncedAt } = params;
  const frontmatter = [
    '---',
    'source: llm-context-viz',
    `session_id: ${yamlString(sessionId)}`,
    `topic_id: ${yamlString(topicId)}`,
    `aggregate_id: ${yamlString(context.aggregate?.id || '')}`,
    `turn_range: ${yamlString(`${context.startTurn}-${context.endTurn}`)}`,
    `synced_at: ${yamlString(syncedAt)}`,
    'tags:',
    '  - llm-context',
    '  - ontology-card',
    '---',
    '',
    `# ${context.title}`,
    '',
  ].join('\n');

  return `${frontmatter}${renderManagedCardMarkdown(params)}\n## 我的补充\n\n`;
}

export function contentHash(content: string): string {
  return crypto.createHash('sha1').update(content).digest('hex');
}
```

- [ ] **Step 3: Run build**

Run: `npm run build`

Expected: TypeScript compiles and Vite build completes.

## Task 2: Backend Config, Safe Write, And API

**Files:**

- Create: `server/obsidian/sync.ts`
- Create: `server/routes/obsidian.ts`
- Modify: `server/db.ts`
- Modify: `server/index.ts`
- Modify: `server/routes/sessions.ts`

- [ ] **Step 1: Add database tables**

Modify `server/db.ts` inside `initDb()` SQL block after `ontology_card_summaries`:

```sql
CREATE TABLE IF NOT EXISTS obsidian_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  vault_path TEXT,
  notes_dir TEXT NOT NULL DEFAULT 'LLM知识卡片',
  filename_template TEXT NOT NULL DEFAULT '第{{startTurn}}-{{endTurn}}轮 - {{title}}.md',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

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

CREATE INDEX IF NOT EXISTS idx_ontology_obsidian_syncs_session
  ON ontology_obsidian_syncs(session_id, status, updated_at);
```

- [ ] **Step 2: Create safe sync helper**

Create `server/obsidian/sync.ts`:

```ts
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import path from 'path';
import { MANAGED_END, MANAGED_START, renderFullNoteMarkdown, renderManagedCardMarkdown, contentHash, renderFilename, topicHash } from './markdown';
import type { KnowledgeCardContext } from './card-context';

export interface ObsidianConfig {
  vaultPath: string | null;
  notesDir: string;
  filenameTemplate: string;
}

export interface ObsidianWriteResult {
  relativePath: string;
  hash: string;
  skipped: boolean;
}

export function validateConfig(config: ObsidianConfig): { ok: true; vaultRoot: string; notesDir: string } | { ok: false; error: string } {
  if (!config.vaultPath || !config.vaultPath.trim()) {
    return { ok: false, error: '尚未配置 Obsidian Vault 路径' };
  }
  const vaultRoot = path.resolve(config.vaultPath);
  if (!existsSync(vaultRoot)) return { ok: false, error: 'Obsidian Vault 路径不存在' };
  if (!statSync(vaultRoot).isDirectory()) return { ok: false, error: 'Obsidian Vault 路径不是目录' };
  const notesDir = config.notesDir || 'LLM知识卡片';
  if (path.isAbsolute(notesDir) || notesDir.includes('..')) {
    return { ok: false, error: '笔记目录必须是 Vault 内的相对路径' };
  }
  return { ok: true, vaultRoot, notesDir };
}

function ensureInside(root: string, target: string): void {
  const rel = path.relative(root, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('目标路径超出 Obsidian Vault');
  }
}

function replaceManagedBlock(existing: string, managed: string): string | null {
  const start = existing.indexOf(MANAGED_START);
  const end = existing.indexOf(MANAGED_END);
  if (start === -1 || end === -1 || end < start) return null;
  const before = existing.slice(0, start);
  const after = existing.slice(end + MANAGED_END.length);
  return `${before}${managed.trimEnd()}\n${after}`;
}

export function writeObsidianCard(params: {
  config: ObsidianConfig;
  sessionId: string;
  topicId: string;
  context: KnowledgeCardContext;
  summary: string | null;
}): ObsidianWriteResult {
  const validation = validateConfig(params.config);
  if (!validation.ok) throw new Error(validation.error);

  const syncedAt = new Date().toISOString();
  const notesRoot = path.resolve(validation.vaultRoot, validation.notesDir);
  ensureInside(validation.vaultRoot, notesRoot);
  mkdirSync(notesRoot, { recursive: true });

  const baseFilename = renderFilename(params.context, params.sessionId);
  let absolutePath = path.resolve(notesRoot, baseFilename);
  ensureInside(validation.vaultRoot, absolutePath);

  const fullNote = renderFullNoteMarkdown({ ...params, syncedAt });
  const managed = renderManagedCardMarkdown({ ...params, syncedAt });
  let nextContent = fullNote;

  if (existsSync(absolutePath)) {
    const existing = readFileSync(absolutePath, 'utf-8');
    const replaced = replaceManagedBlock(existing, managed);
    if (!replaced) {
      const parsed = path.parse(baseFilename);
      absolutePath = path.resolve(notesRoot, `${parsed.name}-${topicHash(params.sessionId, params.topicId)}${parsed.ext}`);
      ensureInside(validation.vaultRoot, absolutePath);
      if (existsSync(absolutePath)) {
        const existingAlt = readFileSync(absolutePath, 'utf-8');
        const replacedAlt = replaceManagedBlock(existingAlt, managed);
        if (!replacedAlt) throw new Error('目标文件已存在且不是受管理的知识卡片笔记');
        nextContent = replacedAlt;
      } else {
        nextContent = fullNote;
      }
    } else {
      nextContent = replaced;
    }
  }

  const hash = contentHash(nextContent);
  if (existsSync(absolutePath) && contentHash(readFileSync(absolutePath, 'utf-8')) === hash) {
    return { relativePath: path.relative(validation.vaultRoot, absolutePath), hash, skipped: true };
  }

  writeFileSync(absolutePath, nextContent, 'utf-8');
  return { relativePath: path.relative(validation.vaultRoot, absolutePath), hash, skipped: false };
}
```

- [ ] **Step 3: Add Obsidian config route**

Create `server/routes/obsidian.ts`:

```ts
import { Router } from 'express';
import { getDb } from '../db';
import { validateConfig } from '../obsidian/sync';

const router = Router();

function getConfigRow(): { vault_path: string | null; notes_dir: string; filename_template: string } {
  const db = getDb();
  const row = db.prepare(`
    SELECT vault_path, notes_dir, filename_template
    FROM obsidian_config
    WHERE id = 1
  `).get() as { vault_path: string | null; notes_dir: string; filename_template: string } | undefined;
  return row || { vault_path: null, notes_dir: 'LLM知识卡片', filename_template: '第{{startTurn}}-{{endTurn}}轮 - {{title}}.md' };
}

router.get('/config', (_req, res) => {
  const row = getConfigRow();
  const validation = validateConfig({
    vaultPath: row.vault_path,
    notesDir: row.notes_dir,
    filenameTemplate: row.filename_template,
  });
  return res.json({
    vaultPath: row.vault_path,
    notesDir: row.notes_dir,
    filenameTemplate: row.filename_template,
    configured: validation.ok,
    error: validation.ok ? null : validation.error,
  });
});

router.put('/config', (req, res) => {
  try {
    const { vaultPath, notesDir, filenameTemplate } = req.body || {};
    const next = {
      vaultPath: typeof vaultPath === 'string' && vaultPath.trim() ? vaultPath.trim() : null,
      notesDir: typeof notesDir === 'string' && notesDir.trim() ? notesDir.trim() : 'LLM知识卡片',
      filenameTemplate: typeof filenameTemplate === 'string' && filenameTemplate.trim()
        ? filenameTemplate.trim()
        : '第{{startTurn}}-{{endTurn}}轮 - {{title}}.md',
    };
    const validation = validateConfig(next);
    if (!validation.ok) return res.status(400).json({ error: validation.error });

    getDb().prepare(`
      INSERT INTO obsidian_config (id, vault_path, notes_dir, filename_template, updated_at)
      VALUES (1, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        vault_path = excluded.vault_path,
        notes_dir = excluded.notes_dir,
        filename_template = excluded.filename_template,
        updated_at = datetime('now')
    `).run(next.vaultPath, next.notesDir, next.filenameTemplate);

    return res.json({
      vaultPath: next.vaultPath,
      notesDir: next.notesDir,
      filenameTemplate: next.filenameTemplate,
      configured: true,
      error: null,
    });
  } catch (err) {
    return res.status(500).json({ error: '保存 Obsidian 配置失败: ' + (err instanceof Error ? err.message : String(err)) });
  }
});

export default router;
```

- [ ] **Step 4: Register Obsidian route**

Modify `server/index.ts`:

```ts
import obsidianRouter from './routes/obsidian';
```

Register it after calibrate:

```ts
app.use('/api/obsidian', obsidianRouter);
```

- [ ] **Step 5: Add card sync endpoints**

Modify `server/routes/sessions.ts`:

Add imports:

```ts
import { getKnowledgeCardContext, type ObsidianOntologyDataLike } from '../obsidian/card-context';
import { writeObsidianCard } from '../obsidian/sync';
```

Add helper near card summary helpers:

```ts
function getObsidianConfig(): { vaultPath: string | null; notesDir: string; filenameTemplate: string } {
  const row = getDb().prepare(`
    SELECT vault_path, notes_dir, filename_template
    FROM obsidian_config
    WHERE id = 1
  `).get() as { vault_path: string | null; notes_dir: string; filename_template: string } | undefined;
  return {
    vaultPath: row?.vault_path || null,
    notesDir: row?.notes_dir || 'LLM知识卡片',
    filenameTemplate: row?.filename_template || '第{{startTurn}}-{{endTurn}}轮 - {{title}}.md',
  };
}

function getSavedCardSummary(sessionId: string, topicId: string): string | null {
  const row = getDb().prepare(`
    SELECT summary
    FROM ontology_card_summaries
    WHERE session_id = ? AND topic_id = ? AND status = 'done'
  `).get(sessionId, topicId) as { summary: string | null } | undefined;
  return row?.summary || null;
}
```

Add routes before `POST /:id/ontology/build`:

```ts
router.get('/:id/ontology/obsidian-card/:topicId', (req, res) => {
  try {
    const row = getDb().prepare(`
      SELECT topic_id, vault_path, note_path, content_hash, status, error, last_synced_at, updated_at
      FROM ontology_obsidian_syncs
      WHERE session_id = ? AND topic_id = ?
    `).get(req.params.id, req.params.topicId) as {
      topic_id: string;
      vault_path: string;
      note_path: string;
      content_hash: string | null;
      status: string;
      error: string | null;
      last_synced_at: string | null;
      updated_at: string | null;
    } | undefined;

    const config = getObsidianConfig();
    return res.json({
      topicId: req.params.topicId,
      configured: Boolean(config.vaultPath),
      status: row?.status || 'not_synced',
      notePath: row?.note_path || null,
      error: row?.error || null,
      lastSyncedAt: row?.last_synced_at || null,
      updatedAt: row?.updated_at || null,
    });
  } catch (err) {
    return res.status(500).json({ error: '获取 Obsidian 同步状态失败: ' + (err instanceof Error ? err.message : String(err)) });
  }
});

router.post('/:id/ontology/obsidian-card/:topicId', (req, res) => {
  const sessionId = req.params.id;
  const topicId = req.params.topicId;
  try {
    const row = getDb()
      .prepare('SELECT ontology_json FROM ontology WHERE session_id = ?')
      .get(sessionId) as { ontology_json: string } | undefined;
    if (!row) return res.status(404).json({ error: '该会话尚无本体数据' });

    const data = JSON.parse(row.ontology_json) as ObsidianOntologyDataLike;
    const context = getKnowledgeCardContext(data, topicId);
    const config = getObsidianConfig();
    const summary = getSavedCardSummary(sessionId, topicId);
    const result = writeObsidianCard({ config, sessionId, topicId, context, summary });

    getDb().prepare(`
      INSERT INTO ontology_obsidian_syncs (
        session_id, topic_id, vault_path, note_path, content_hash, status, error,
        last_synced_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, 'synced', NULL, datetime('now'), datetime('now'))
      ON CONFLICT(session_id, topic_id) DO UPDATE SET
        vault_path = excluded.vault_path,
        note_path = excluded.note_path,
        content_hash = excluded.content_hash,
        status = 'synced',
        error = NULL,
        last_synced_at = datetime('now'),
        updated_at = datetime('now')
    `).run(sessionId, topicId, config.vaultPath, result.relativePath, result.hash);

    return res.json({
      topicId,
      configured: true,
      status: 'synced',
      notePath: result.relativePath,
      skipped: result.skipped,
      error: null,
      lastSyncedAt: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      const config = getObsidianConfig();
      if (config.vaultPath) {
        getDb().prepare(`
          INSERT INTO ontology_obsidian_syncs (
            session_id, topic_id, vault_path, note_path, status, error, updated_at
          )
          VALUES (?, ?, ?, '', 'error', ?, datetime('now'))
          ON CONFLICT(session_id, topic_id) DO UPDATE SET
            status = 'error',
            error = excluded.error,
            updated_at = datetime('now')
        `).run(sessionId, topicId, config.vaultPath, message);
      }
    } catch {
      // Ignore persistence errors while reporting the original sync failure.
    }
    return res.status(500).json({ error: '同步到 Obsidian 失败: ' + message });
  }
});
```

- [ ] **Step 6: Run build**

Run: `npm run build`

Expected: TypeScript compiles and Vite build completes.

## Task 3: Frontend Sync Controls

**Files:**

- Modify: `src/components/ontology/OntologyDetailPanel.tsx`

- [ ] **Step 1: Add interfaces**

Add near `CardSummaryStatus`:

```ts
interface ObsidianConfigStatus {
  vaultPath: string | null;
  notesDir: string;
  filenameTemplate: string;
  configured: boolean;
  error: string | null;
}

interface ObsidianSyncStatus {
  topicId: string;
  configured: boolean;
  status: 'not_synced' | 'synced' | 'error';
  notePath: string | null;
  error: string | null;
  lastSyncedAt: string | null;
  updatedAt?: string | null;
  skipped?: boolean;
}
```

- [ ] **Step 2: Add state and handlers inside `SelectedEntity`**

Add state after summary state:

```ts
const [obsidianStatus, setObsidianStatus] = useState<ObsidianSyncStatus>({
  topicId: node.id,
  configured: false,
  status: 'not_synced',
  notePath: null,
  error: null,
  lastSyncedAt: null,
});
const [obsidianConfig, setObsidianConfig] = useState<ObsidianConfigStatus | null>(null);
const [obsidianConfigOpen, setObsidianConfigOpen] = useState(false);
const [obsidianVaultPath, setObsidianVaultPath] = useState('');
const [obsidianNotesDir, setObsidianNotesDir] = useState('LLM知识卡片');
const [obsidianBusy, setObsidianBusy] = useState(false);
const [obsidianError, setObsidianError] = useState<string | null>(null);
```

Add handlers:

```ts
const loadObsidianStatus = async () => {
  if (!sessionId || node.type !== 'topic') return;
  try {
    const [config, status] = await Promise.all([
      get<ObsidianConfigStatus>('/obsidian/config'),
      get<ObsidianSyncStatus>(`/sessions/${sessionId}/ontology/obsidian-card/${encodeURIComponent(node.id)}`),
    ]);
    setObsidianConfig(config);
    setObsidianStatus(status);
    setObsidianVaultPath(config.vaultPath || '');
    setObsidianNotesDir(config.notesDir || 'LLM知识卡片');
    setObsidianError(status.error || config.error);
  } catch (err) {
    setObsidianError(err instanceof Error ? err.message : '获取 Obsidian 状态失败');
  }
};

const handleSaveObsidianConfig = async () => {
  setObsidianBusy(true);
  setObsidianError(null);
  try {
    const config = await put<ObsidianConfigStatus>('/obsidian/config', {
      vaultPath: obsidianVaultPath,
      notesDir: obsidianNotesDir || 'LLM知识卡片',
    });
    setObsidianConfig(config);
    setObsidianConfigOpen(false);
    await loadObsidianStatus();
  } catch (err) {
    setObsidianError(err instanceof Error ? err.message : '保存 Obsidian 配置失败');
  } finally {
    setObsidianBusy(false);
  }
};

const handleSyncObsidian = async () => {
  if (!sessionId || node.type !== 'topic') return;
  if (!obsidianConfig?.configured) {
    setObsidianConfigOpen(true);
    return;
  }
  setObsidianBusy(true);
  setObsidianError(null);
  try {
    const status = await post<ObsidianSyncStatus>(
      `/sessions/${sessionId}/ontology/obsidian-card/${encodeURIComponent(node.id)}`,
    );
    setObsidianStatus(status);
  } catch (err) {
    setObsidianError(err instanceof Error ? err.message : '同步到 Obsidian 失败');
  } finally {
    setObsidianBusy(false);
  }
};
```

Call `loadObsidianStatus()` inside the existing `useEffect` that resets summary status for `node.id/sessionId`.

- [ ] **Step 3: Add sync UI below knowledge summary block**

Inside `node.type === 'topic' && summaryNodeCount > 0` block, after the summary panel, add:

```tsx
<div style={{ marginTop: 9, border: '1px solid oklch(0.32 0.014 265)', borderRadius: 9, padding: '9px 10px', background: 'oklch(0.19 0.01 265 / 0.46)' }}>
  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
    <button
      type="button"
      onClick={handleSyncObsidian}
      disabled={obsidianBusy}
      style={{
        border: '1px solid oklch(0.45 0.09 165 / 0.55)',
        borderRadius: 7,
        padding: '6px 10px',
        background: obsidianStatus.status === 'synced' ? 'oklch(0.74 0.12 165 / 0.16)' : 'oklch(0.24 0.012 265)',
        color: obsidianStatus.status === 'synced' ? 'oklch(0.84 0.10 165)' : 'oklch(0.78 0.01 265)',
        cursor: obsidianBusy ? 'default' : 'pointer',
        fontFamily: 'inherit',
        fontSize: 11.5,
        fontWeight: 600,
      }}
    >
      {obsidianBusy
        ? '同步中'
        : obsidianStatus.status === 'synced'
          ? '已同步'
          : obsidianStatus.status === 'error'
            ? '同步失败'
            : obsidianConfig?.configured
              ? '同步到 Obsidian'
              : '配置 Obsidian'}
    </button>
    <button
      type="button"
      onClick={() => setObsidianConfigOpen((open) => !open)}
      style={{
        border: '1px solid oklch(0.30 0.014 265)',
        borderRadius: 7,
        padding: '6px 9px',
        background: 'transparent',
        color: SEMANTIC.textMuted,
        cursor: 'pointer',
        fontFamily: 'inherit',
        fontSize: 11,
      }}
    >
      设置
    </button>
  </div>
  {obsidianStatus.notePath && (
    <div style={{ marginTop: 6, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: SEMANTIC.textMuted, wordBreak: 'break-all' }}>
      {obsidianStatus.notePath}
    </div>
  )}
  {obsidianError && (
    <div style={{ marginTop: 6, fontSize: 11.5, color: 'oklch(0.76 0.13 45)', lineHeight: 1.45 }}>
      {obsidianError}
    </div>
  )}
  {obsidianConfigOpen && (
    <div style={{ marginTop: 9, display: 'flex', flexDirection: 'column', gap: 7 }}>
      <input
        value={obsidianVaultPath}
        onChange={(event) => setObsidianVaultPath(event.target.value)}
        placeholder="/Users/you/Documents/ObsidianVault"
        style={{
          width: '100%',
          boxSizing: 'border-box',
          border: '1px solid oklch(0.30 0.014 265)',
          borderRadius: 7,
          padding: '7px 9px',
          background: 'oklch(0.16 0.008 265)',
          color: SEMANTIC.textPrimary,
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 11.5,
        }}
      />
      <input
        value={obsidianNotesDir}
        onChange={(event) => setObsidianNotesDir(event.target.value)}
        placeholder="LLM知识卡片"
        style={{
          width: '100%',
          boxSizing: 'border-box',
          border: '1px solid oklch(0.30 0.014 265)',
          borderRadius: 7,
          padding: '7px 9px',
          background: 'oklch(0.16 0.008 265)',
          color: SEMANTIC.textPrimary,
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 11.5,
        }}
      />
      <button
        type="button"
        onClick={handleSaveObsidianConfig}
        disabled={obsidianBusy}
        style={{
          alignSelf: 'flex-end',
          border: '1px solid oklch(0.45 0.09 165 / 0.55)',
          borderRadius: 7,
          padding: '5px 11px',
          background: 'oklch(0.30 0.06 165 / 0.45)',
          color: 'oklch(0.86 0.10 165)',
          cursor: obsidianBusy ? 'default' : 'pointer',
          fontFamily: 'inherit',
          fontSize: 11.5,
          fontWeight: 600,
        }}
      >
        保存配置
      </button>
    </div>
  )}
</div>
```

- [ ] **Step 4: Run build**

Run: `npm run build`

Expected: TypeScript compiles and Vite build completes.

## Task 4: Integration Verification

**Files:**

- No planned source edits unless verification reveals defects.

- [ ] **Step 1: Run full build**

Run: `npm run build`

Expected: TypeScript compiles and Vite build completes.

- [ ] **Step 2: Run whitespace check**

Run: `git diff --check`

Expected: no output and exit code 0.

- [ ] **Step 3: Manual endpoint smoke test with temporary vault**

Use an existing session/topic if available in local DB. If no ontology data exists, skip this manual endpoint test and report that no local ontology fixture was available.

Run:

```bash
tmpvault="$(mktemp -d /tmp/obsidian-vault-XXXXXX)"
curl -s -X PUT http://127.0.0.1:4137/api/obsidian/config \
  -H 'Content-Type: application/json' \
  -d "{\"vaultPath\":\"$tmpvault\",\"notesDir\":\"LLM知识卡片\"}"
```

Expected: JSON includes `"configured":true`.

Then use browser UI or API to sync one topic card and confirm a `.md` file appears under `$tmpvault/LLM知识卡片`.

- [ ] **Step 4: Report changed files**

Run:

```bash
git status --short
git diff --stat
```

Expected: source changes are visible and no generated Obsidian temp files are tracked.

