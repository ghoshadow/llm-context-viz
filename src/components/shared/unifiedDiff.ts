export interface SideBySideCell {
  line: number | null;
  marker: '+' | '-' | '';
  text: string;
  kind: 'context' | 'add' | 'delete' | 'blank';
}

export type SideBySideRow =
  | { type: 'meta'; text: string }
  | { type: 'hunk'; text: string }
  | { type: 'change'; left: SideBySideCell; right: SideBySideCell };

export interface ParsedUnifiedDiffFile {
  title: string;
  oldPath: string;
  newPath: string;
  rows: SideBySideRow[];
}

export function stripMarkdownCodeFences(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !line.startsWith('```'))
    .join('\n');
}

function parseHunkHeader(line: string): { oldLine: number; newLine: number } | null {
  const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
  if (!match) return null;
  return {
    oldLine: Number(match[1]),
    newLine: Number(match[2]),
  };
}

function blankCell(): SideBySideCell {
  return { line: null, marker: '', text: '', kind: 'blank' };
}

export function parseUnifiedDiffFile(text: string): ParsedUnifiedDiffFile | null {
  const lines = stripMarkdownCodeFences(text).split('\n');
  if (!lines.some((line) => line.startsWith('diff --git '))) return null;

  const title = lines.find((line) => line.startsWith('diff --git ')) ?? 'diff';
  const oldPath = lines.find((line) => line.startsWith('--- '))?.replace(/^---\s+(?:a\/)?/, '') ?? 'old';
  const newPath = lines.find((line) => line.startsWith('+++ '))?.replace(/^\+\+\+\s+(?:b\/)?/, '') ?? 'new';
  const rows: SideBySideRow[] = [];
  let oldLine = 0;
  let newLine = 0;
  let pendingDeleted: SideBySideCell[] = [];

  const flushDeleted = () => {
    for (const left of pendingDeleted) {
      rows.push({ type: 'change', left, right: blankCell() });
    }
    pendingDeleted = [];
  };

  for (const line of lines) {
    const hunk = parseHunkHeader(line);
    if (hunk) {
      flushDeleted();
      oldLine = hunk.oldLine;
      newLine = hunk.newLine;
      rows.push({ type: 'hunk', text: line });
      continue;
    }

    if (line.startsWith('diff --git ') || line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ')) {
      flushDeleted();
      rows.push({ type: 'meta', text: line });
      continue;
    }

    if (line.startsWith('-')) {
      pendingDeleted.push({
        line: oldLine,
        marker: '-',
        text: line.slice(1),
        kind: 'delete',
      });
      oldLine += 1;
      continue;
    }

    if (line.startsWith('+')) {
      const right: SideBySideCell = {
        line: newLine,
        marker: '+',
        text: line.slice(1),
        kind: 'add',
      };
      const left = pendingDeleted.shift() ?? blankCell();
      rows.push({ type: 'change', left, right });
      newLine += 1;
      continue;
    }

    flushDeleted();
    const textLine = line.startsWith(' ') ? line.slice(1) : line;
    rows.push({
      type: 'change',
      left: { line: oldLine || null, marker: '', text: textLine, kind: 'context' },
      right: { line: newLine || null, marker: '', text: textLine, kind: 'context' },
    });
    if (oldLine) oldLine += 1;
    if (newLine) newLine += 1;
  }

  flushDeleted();
  return { title, oldPath, newPath, rows };
}
