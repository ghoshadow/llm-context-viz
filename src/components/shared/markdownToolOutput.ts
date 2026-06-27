import { isMarkdownTableRow, isMarkdownTableSeparator } from './markdownDiffTable';

export const DIFF_FILE_START = '<!-- llm-context-viz:diff-file:start -->';
export const DIFF_FILE_END = '<!-- llm-context-viz:diff-file:end -->';

const DIFF_LIKE_START = /^(diff --git |index [0-9a-f]|--- |\+\+\+ |@@ )/;
const INDENTED_TOOL_LINE = /^(\t+| {2,}|\| |│|├|└)/;
const FILE_TREE_CHARS = /[├└│─]/;
const CODE_OR_PATCH_LINE = /^([+\- ]\s{2,}|[+\-]\s{0,3}(const|let|var|import|export|return|if|try|catch|function|router\.|\/|\*|}|{))/;
const DIFF_MARKDOWN_LIST = /^[+\-](?:[-*]|\d+\.)\s+/;
const LIKELY_TREE_ROOT = /\b[\w./-]+\.(?:tsx?|jsx?|md|json|css|html|cjs|mjs)\b/;
const HUNK_HEADER = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/;

function isDiffTableRow(line: string): boolean {
  return isMarkdownTableRow(line);
}

function isPlainMarkdownTableSeparator(line: string): boolean {
  return isMarkdownTableSeparator(line);
}

function isToolLikeLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (DIFF_LIKE_START.test(trimmed)) return true;
  if (DIFF_MARKDOWN_LIST.test(trimmed)) return true;
  if (FILE_TREE_CHARS.test(line)) return true;
  if (INDENTED_TOOL_LINE.test(line)) return true;
  if (CODE_OR_PATCH_LINE.test(trimmed)) return true;
  return false;
}

function fenceBlock(lines: string[], lang = 'diff'): string[] {
  return ['```' + lang, ...lines, '```'];
}

function isDiffFileStart(line: string): boolean {
  return line.trim().startsWith('diff --git ');
}

function isDiffMetaLine(line: string): boolean {
  return /^(index [0-9a-f]|old mode |new mode |deleted file mode |new file mode |similarity index |dissimilarity index |rename from |rename to |copy from |copy to |--- |\+\+\+ |@@ )/.test(line.trim());
}

function parseHunkCounts(line: string): { oldCount: number; newCount: number } | null {
  const match = line.match(HUNK_HEADER);
  if (!match) return null;
  return {
    oldCount: match[1] === undefined ? 1 : Number(match[1]),
    newCount: match[2] === undefined ? 1 : Number(match[2]),
  };
}

function isDiffContinuationLine(line: string): boolean {
  if (line === '\\ No newline at end of file') return true;
  if (line === '') return true;
  const first = line[0];
  return first === ' ' || first === '+' || first === '-';
}

function collectDiffFileBlock(lines: string[], start: number): { block: string[]; nextIndex: number } {
  const block: string[] = [];
  let i = start;
  let oldRemaining: number | null = null;
  let newRemaining: number | null = null;

  const inHunk = () => oldRemaining !== null && newRemaining !== null;
  const hunkComplete = () => oldRemaining === 0 && newRemaining === 0;

  while (i < lines.length) {
    const current = lines[i]!;
    if (i > start && isDiffFileStart(current)) break;

    const hunkCounts = parseHunkCounts(current.trim());
    if (hunkCounts) {
      oldRemaining = hunkCounts.oldCount;
      newRemaining = hunkCounts.newCount;
      block.push(current);
      i += 1;
      continue;
    }

    if (inHunk() && hunkComplete()) {
      const stillLooksDiffish =
        isDiffTableRow(current) ||
        isPlainMarkdownTableSeparator(current) ||
        isDiffContinuationLine(current) ||
        isToolLikeLine(current);
      if (!stillLooksDiffish) {
        oldRemaining = null;
        newRemaining = null;
        continue;
      }
    }

    if (!inHunk() && i > start && !isDiffMetaLine(current)) break;

    block.push(current);

    if (inHunk() && current !== '\\ No newline at end of file') {
      const first = current[0] ?? ' ';
      if (first === '-') {
        oldRemaining = Math.max(0, oldRemaining! - 1);
      } else if (first === '+') {
        newRemaining = Math.max(0, newRemaining! - 1);
      } else {
        oldRemaining = Math.max(0, oldRemaining! - 1);
        newRemaining = Math.max(0, newRemaining! - 1);
      }
    }

    i += 1;
  }

  return { block, nextIndex: i };
}

function emitDiffFileBlock(block: string[], out: string[]): void {
  let chunk: string[] = [];
  let i = 0;

  out.push(DIFF_FILE_START);

  const flushChunk = () => {
    if (chunk.length === 0) return;
    while (chunk.length > 0 && !chunk[0]!.trim()) chunk.shift();
    while (chunk.length > 0 && !chunk[chunk.length - 1]!.trim()) chunk.pop();
    if (chunk.length === 0) return;
    out.push(...fenceBlock(chunk));
    chunk = [];
  };

  while (i < block.length) {
    const current = block[i]!;
    const next = block[i + 1] ?? '';
    if (isDiffTableRow(current) && isPlainMarkdownTableSeparator(next)) {
      flushChunk();
      while (i < block.length && isDiffTableRow(block[i]!)) {
        out.push(block[i]!.trimEnd());
        i += 1;
      }
      if (i < block.length) out.push('');
      continue;
    }

    chunk.push(current);
    i += 1;
  }

  flushChunk();
  out.push(DIFF_FILE_END);
}

/**
 * Convert raw tool output into MarkdownBlock-friendly Markdown.
 *
 * Tool logs often contain un-fenced git diffs, file trees, and tables with
 * diff prefixes (`-|`, `+|`, ` |`). This keeps normal prose/list Markdown
 * intact while fencing structured output so it stays aligned.
 */
export function preprocessToolMarkdown(raw: string): string {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    const nextLine = lines[i + 1] ?? '';
    const startsTreeBlock = LIKELY_TREE_ROOT.test(line.trim()) && isToolLikeLine(nextLine);
    const embeddedDiffHeader = line.match(/^(-\s+.+?:)\s+(diff --git .+)$/);

    if (embeddedDiffHeader) {
      out.push(embeddedDiffHeader[1]!);
      const { block, nextIndex } = collectDiffFileBlock([embeddedDiffHeader[2]!, ...lines.slice(i + 1)], 0);
      emitDiffFileBlock(block, out);
      i += nextIndex;
      continue;
    }

    if (isDiffFileStart(line)) {
      const { block, nextIndex } = collectDiffFileBlock(lines, i);
      emitDiffFileBlock(block, out);
      i = nextIndex;
      continue;
    }

    if (isDiffTableRow(line) && isPlainMarkdownTableSeparator(nextLine)) {
      while (i < lines.length && isDiffTableRow(lines[i]!)) {
        out.push(lines[i]!.trimEnd());
        i += 1;
      }
      continue;
    }

    if (isToolLikeLine(line) || startsTreeBlock) {
      const block: string[] = [];
      while (i < lines.length) {
        const current = lines[i]!;
        const previous = block[block.length - 1] ?? '';
        const next = lines[i + 1] ?? '';
        const currentStartsTreeBlock = block.length === 0 && LIKELY_TREE_ROOT.test(current.trim()) && isToolLikeLine(next);
        const startsMarkdownTable =
          isDiffTableRow(current) &&
          isPlainMarkdownTableSeparator(lines[i + 1] ?? '');

        if (startsMarkdownTable) break;

        const isBlank = !current.trim();
        const keepBlank =
          isBlank &&
          block.length > 0 &&
          i + 1 < lines.length &&
          isToolLikeLine(lines[i + 1]!);

        if (!isToolLikeLine(current) && !currentStartsTreeBlock && !keepBlank) break;

        block.push(current);
        i += 1;

        if (isBlank && !isToolLikeLine(previous)) break;
      }
      out.push(...fenceBlock(block));
      continue;
    }

    out.push(line);
    i += 1;
  }

  return out.join('\n');
}
