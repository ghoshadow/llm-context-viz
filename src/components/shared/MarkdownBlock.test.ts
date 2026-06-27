import assert from 'node:assert/strict';
import test from 'node:test';
import { isMarkdownTableRow, isMarkdownTableSeparator, tableCells, tableMarkers } from './markdownDiffTable';
import { DIFF_FILE_END, DIFF_FILE_START, preprocessToolMarkdown } from './markdownToolOutput';
import { parseUnifiedDiffFile } from './unifiedDiff';

test('parses diff-prefixed markdown table rows with row markers intact', () => {
  const rows = [
    ' | Method | Path |',
    ' |--------|------|',
    '-| POST | `/api/sessions/upload` |',
    '+| PATCH | `/api/sessions/:id` |',
    ' | GET | `/api/sessions` |',
  ];

  assert.equal(isMarkdownTableRow(rows[0]!), true);
  assert.equal(isMarkdownTableSeparator(rows[1]!), true);
  assert.deepEqual(tableCells(rows[2]!), ['POST', '`/api/sessions/upload`']);
  assert.deepEqual(tableMarkers(rows), ['context', 'context', 'delete', 'add', 'context']);
});

test('does not treat non-table pipe lines as valid tables', () => {
  assert.equal(isMarkdownTableRow('| just one row |'), true);
  assert.equal(isMarkdownTableSeparator('| just one row |'), false);
});

test('parses unified diff files into side-by-side rows', () => {
  const parsed = parseUnifiedDiffFile([
    'diff --git a/demo.md b/demo.md',
    'index 111..222 100644',
    '--- a/demo.md',
    '+++ b/demo.md',
    '@@ -10,4 +10,4 @@ section',
    ' keep',
    '-old only',
    '-old text',
    '+new text',
    '+new only',
    ' tail',
  ].join('\n'));

  assert.ok(parsed);
  assert.equal(parsed.oldPath, 'demo.md');
  assert.equal(parsed.newPath, 'demo.md');
  const changes = parsed.rows.filter((row) => row.type === 'change');
  assert.deepEqual(changes.map((row) => [row.left.kind, row.left.line, row.left.text, row.right.kind, row.right.line, row.right.text]), [
    ['context', 10, 'keep', 'context', 10, 'keep'],
    ['delete', 11, 'old only', 'add', 11, 'new text'],
    ['delete', 12, 'old text', 'add', 12, 'new only'],
    ['context', 13, 'tail', 'context', 13, 'tail'],
  ]);
});

test('parses fenced unified diff files without exposing fence lines', () => {
  const parsed = parseUnifiedDiffFile([
    '```diff',
    'diff --git a/demo.md b/demo.md',
    'index 111..222 100644',
    '--- a/demo.md',
    '+++ b/demo.md',
    '@@ -1 +1 @@',
    '-old',
    '+new',
    '```',
  ].join('\n'));

  assert.ok(parsed);
  assert.equal(parsed.rows.some((row) => row.type === 'meta' && row.text.includes('```')), false);
  assert.equal(parsed.rows.some((row) => row.type === 'change' && (row.left.text.includes('```') || row.right.text.includes('```'))), false);
});

test('parses multi-fenced diff files with table rows without exposing fence lines', () => {
  const parsed = parseUnifiedDiffFile([
    '```diff',
    'diff --git a/demo.md b/demo.md',
    'index 111..222 100644',
    '--- a/demo.md',
    '+++ b/demo.md',
    '@@ -1,4 +1,3 @@ first',
    '```',
    ' | Method | Path |',
    ' |--------|------|',
    '-| POST | `/api/sessions/upload` |',
    ' | GET | `/api/sessions` |',
    '```diff',
    '@@ -10,2 +9,2 @@ second',
    '-old',
    '+new',
    '```',
  ].join('\n'));

  assert.ok(parsed);
  assert.equal(parsed.rows.some((row) => row.type === 'hunk' && row.text.includes('@@ -10,2 +9,2 @@ second')), true);
  assert.equal(parsed.rows.some((row) => row.type === 'change' && row.left.text.includes('| POST | `/api/sessions/upload` |')), true);
  assert.equal(parsed.rows.some((row) => row.type === 'change' && (row.left.text.includes('```') || row.right.text.includes('```'))), false);
});

test('preprocesses tool output without breaking markdown tables or file trees', () => {
  const raw = [
    '- Current git diff (staged and unstaged changes): diff --git a/ARCHITECTURE_REPORT.md b/ARCHITECTURE_REPORT.md',
    'index ab18e17..89fc87f 100644',
    '--- a/ARCHITECTURE_REPORT.md',
    '+++ b/ARCHITECTURE_REPORT.md',
    '@@ -81,7 +81,6 @@ compute-deltas    │                      │                  │',
    'server/index.ts',
    '    ├── db.ts (SQLite singleton + schema)',
    '    ├── routes/sessions.ts',
    '-    │     ├── POST /upload (multer → runPipeline → INSERT)',
    '    │     ├── GET / (list)',
    '',
    ' | Method | Path | 请求 | 响应 |',
    ' |--------|------|------|------|',
    '-| POST | `/api/sessions/upload` | multipart(file) | `{ id }` |',
    ' | GET | `/api/sessions` | — | `SessionListItem[]` |',
    '',
    '-- `uploadOpen`, `scannerOpen`, `scanFiles[]`, `scanStatus`',
    '+- `scannerOpen`, `scanFiles[]`, `scanStatus`',
  ].join('\n');

  const processed = preprocessToolMarkdown(raw);

  assert.match(processed, /^- Current git diff \(staged and unstaged changes\):\n<!-- llm-context-viz:diff-file:start -->\n```diff\n/m);
  assert.match(processed, /```diff\ndiff --git a\/ARCHITECTURE_REPORT\.md b\/ARCHITECTURE_REPORT\.md\nindex ab18e17/);
  assert.match(processed, /server\/index\.ts\n    ├── db\.ts/);
  assert.match(processed, /\n \| Method \| Path \| 请求 \| 响应 \|\n \|--------\|------\|------\|------\|\n-\| POST \| `\/api\/sessions\/upload` \| multipart\(file\) \| `{ id }` \|/);
  assert.match(processed, /```diff\n-- `uploadOpen`, `scannerOpen`, `scanFiles\[\]`, `scanStatus`\n\+- `scannerOpen`, `scanFiles\[\]`, `scanStatus`\n```/);
  assert.equal((processed.match(/```diff/g) ?? []).length, 2);
  assert.equal((processed.match(new RegExp(DIFF_FILE_START, 'g')) ?? []).length, 1);
  assert.equal((processed.match(new RegExp(DIFF_FILE_END, 'g')) ?? []).length, 1);
});

test('preprocesses tab-indented git status lines as preformatted output', () => {
  const raw = [
    'Changes to be committed:',
    '  (use "git restore --staged <file>..." to unstage)',
    '\tmodified:   ARCHITECTURE_REPORT.md',
    '\tmodified:   DEBT_FIX_PLAN.md',
    '\tdeleted:    src/components/upload/UploadModal.tsx',
    '\tmodified:   src/store/sessionStore.ts',
  ].join('\n');

  const processed = preprocessToolMarkdown(raw);

  assert.match(processed, /^Changes to be committed:\n```diff\n  \(use "git restore --staged <file>\.\.\." to unstage\)\n\tmodified:   ARCHITECTURE_REPORT\.md\n\tmodified:   DEBT_FIX_PLAN\.md\n\tdeleted:    src\/components\/upload\/UploadModal\.tsx\n\tmodified:   src\/store\/sessionStore\.ts\n```$/);
});

test('keeps a full unified diff file section in one diff block', () => {
  const raw = [
    'diff --git a/DEBT_FIX_PLAN.md b/DEBT_FIX_PLAN.md',
    'index acc4f83..768a36e 100644',
    '--- a/DEBT_FIX_PLAN.md',
    '+++ b/DEBT_FIX_PLAN.md',
    "@@ -75,11 +75,11 @@ ToolDrilldown.tsx 的私有版本在 `>= 100000` 时用 `Math.round(n/1000)+'K'`",
    '',
    '---',
    '',
    '-## 5. upload 路由缺 sub-agent enrichment',
    '+## 5. 已过期：文件选择导入缺 sub-agent enrichment',
    '',
    '-**方案:**',
    '+**原方案（保留作历史记录，不再执行）:**',
    ' 1. 上传时，将文件内容写入临时目录（`/tmp/llm-viz-upload-{uuid}.jsonl`）',
    ' 2. 管线跑完后，用临时路径调用 `enrichWithSubAgents(turns, tmpDir)`',
    'diff --git a/server/routes/sessions.ts b/server/routes/sessions.ts',
    'index 5d66943..5bf9501 100644',
    '--- a/server/routes/sessions.ts',
    '+++ b/server/routes/sessions.ts',
    '@@ -20,66 +16,6 @@ const router = Router();',
    '',
    '-// ============================================================================',
    '-// Multer setup: accept single file upload, max 50 MB',
    '-// ============================================================================',
    '-',
    '-const upload = multer({',
    "-  storage: multer.memoryStorage(),",
    '-});',
  ].join('\n');

  const processed = preprocessToolMarkdown(raw);

  assert.match(processed, /^<!-- llm-context-viz:diff-file:start -->\n```diff\ndiff --git a\/DEBT_FIX_PLAN\.md b\/DEBT_FIX_PLAN\.md[\s\S]* 2\. 管线跑完后，用临时路径调用 `enrichWithSubAgents\(turns, tmpDir\)`\n```\n<!-- llm-context-viz:diff-file:end -->\n<!-- llm-context-viz:diff-file:start -->\n```diff\ndiff --git a\/server\/routes\/sessions\.ts b\/server\/routes\/sessions\.ts/);
  assert.match(processed, /-\/\/ ============================================================================\n-\/\/ Multer setup: accept single file upload, max 50 MB\n-\/\/ ============================================================================/);
  assert.doesNotMatch(processed, /```\n\n---\n\n```diff/);
  assert.equal((processed.match(/```diff/g) ?? []).length, 2);
  assert.equal((processed.match(new RegExp(DIFF_FILE_START, 'g')) ?? []).length, 2);
  assert.equal((processed.match(new RegExp(DIFF_FILE_END, 'g')) ?? []).length, 2);
});

test('keeps diff table and following hunk metadata in one diff file wrapper', () => {
  const raw = [
    'diff --git a/ARCHITECTURE_REPORT.md b/ARCHITECTURE_REPORT.md',
    'index ab18e17..89fc87f 100644',
    '--- a/ARCHITECTURE_REPORT.md',
    '+++ b/ARCHITECTURE_REPORT.md',
    '@@ -191,7 +189,6 @@ last_seen',
    '',
    ' | Method | Path | 请求 | 响应 |',
    ' |--------|------|------|------|',
    '-| POST | `/api/sessions/upload` | multipart(file) | `{ id }` |',
    ' | GET | `/api/sessions` | — | `SessionListItem[]` |',
    '',
    '@@ -212,10 +209,10 @@ del(path): Promise<void>     // DELETE',
    '',
    '### 4.3 状态管理 (Zustand)',
  ].join('\n');

  const processed = preprocessToolMarkdown(raw);
  const start = processed.indexOf(DIFF_FILE_START);
  const end = processed.indexOf(DIFF_FILE_END);
  const table = processed.indexOf('-| POST | `/api/sessions/upload`');
  const hunk = processed.indexOf('@@ -212,10 +209,10 @@ del(path): Promise<void>     // DELETE');

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.ok(start < table);
  assert.ok(table < hunk);
  assert.ok(hunk < end);
});

test('does not include following task prose in the final diff file wrapper', () => {
  const raw = [
    'diff --git a/src/demo.ts b/src/demo.ts',
    'index 111..222 100644',
    '--- a/src/demo.ts',
    '+++ b/src/demo.ts',
    '@@ -1 +1 @@',
    '-oldValue',
    '+newValue',
    '',
    '## Your task',
    '',
    'Based on the above changes:',
    '',
    '1. Create a new branch if on main',
    '2. Create a single commit with an appropriate message',
  ].join('\n');

  const processed = preprocessToolMarkdown(raw);
  const start = processed.indexOf(DIFF_FILE_START);
  const end = processed.indexOf(DIFF_FILE_END);
  const task = processed.indexOf('## Your task');

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.notEqual(task, -1);
  assert.ok(start < end);
  assert.ok(end < task);
});

test('keeps deletion marker lines inside a diff file wrapper after apparent hunk end', () => {
  const raw = [
    'diff --git a/src/demo.ts b/src/demo.ts',
    'index 111..222 100644',
    '--- a/src/demo.ts',
    '+++ b/src/demo.ts',
    '@@ -1 +1 @@',
    'unchanged',
    '-',
    '-removed tail',
    '+added tail',
    '',
    '## Your task',
  ].join('\n');

  const processed = preprocessToolMarkdown(raw);
  const end = processed.indexOf(DIFF_FILE_END);
  const singleDelete = processed.indexOf('\n-\n');
  const removedTail = processed.indexOf('-removed tail');
  const addedTail = processed.indexOf('+added tail');
  const task = processed.indexOf('## Your task');

  assert.notEqual(end, -1);
  assert.notEqual(singleDelete, -1);
  assert.notEqual(removedTail, -1);
  assert.notEqual(addedTail, -1);
  assert.notEqual(task, -1);
  assert.ok(singleDelete < end);
  assert.ok(removedTail < end);
  assert.ok(addedTail < end);
  assert.ok(end < task);
});

test('keeps deleted-file extended headers and body in one diff file wrapper', () => {
  const raw = [
    'diff --git a/src/components/upload/UploadModal.tsx b/src/components/upload/UploadModal.tsx',
    'deleted file mode 100644',
    'index b76e075..0000000',
    '--- a/src/components/upload/UploadModal.tsx',
    '+++ /dev/null',
    '@@ -1,8 +0,0 @@',
    "-import { useRef, useCallback } from 'react';",
    "-import { SEMANTIC } from '../../styles/theme';",
    '-',
    '-const styles: Record<string, React.CSSProperties> = {',
    '-  overlay: {',
    '-    position: \"fixed\",',
    '-  },',
    '-};',
    '',
    '## Your task',
  ].join('\n');

  const processed = preprocessToolMarkdown(raw);
  const start = processed.indexOf(DIFF_FILE_START);
  const end = processed.indexOf(DIFF_FILE_END);
  const deletedMode = processed.indexOf('deleted file mode 100644');
  const loneDelete = processed.indexOf('\n-\n');
  const body = processed.indexOf('-const styles: Record<string, React.CSSProperties> = {');
  const task = processed.indexOf('## Your task');

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.notEqual(deletedMode, -1);
  assert.notEqual(loneDelete, -1);
  assert.notEqual(body, -1);
  assert.notEqual(task, -1);
  assert.ok(start < deletedMode);
  assert.ok(deletedMode < end);
  assert.ok(loneDelete < end);
  assert.ok(body < end);
  assert.ok(end < task);
});
