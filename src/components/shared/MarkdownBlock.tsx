import React from 'react';
import { Light as SyntaxHighlighter } from 'react-syntax-highlighter';
import { atomOneDark } from 'react-syntax-highlighter/dist/esm/styles/hljs';
import js from 'react-syntax-highlighter/dist/esm/languages/hljs/javascript';
import ts from 'react-syntax-highlighter/dist/esm/languages/hljs/typescript';
import py from 'react-syntax-highlighter/dist/esm/languages/hljs/python';
import bash from 'react-syntax-highlighter/dist/esm/languages/hljs/bash';
import json from 'react-syntax-highlighter/dist/esm/languages/hljs/json';
import css from 'react-syntax-highlighter/dist/esm/languages/hljs/css';
import xml from 'react-syntax-highlighter/dist/esm/languages/hljs/xml';
import sql from 'react-syntax-highlighter/dist/esm/languages/hljs/sql';
import yaml from 'react-syntax-highlighter/dist/esm/languages/hljs/yaml';
import md from 'react-syntax-highlighter/dist/esm/languages/hljs/markdown';
import sh from 'react-syntax-highlighter/dist/esm/languages/hljs/shell';
import diff from 'react-syntax-highlighter/dist/esm/languages/hljs/diff';
import { SEMANTIC } from '../../styles/theme';
import { DIFF_FILE_END, DIFF_FILE_START, preprocessToolMarkdown } from './markdownToolOutput';
import { isMarkdownTableRow, isMarkdownTableSeparator, parseTableLine, tableCells, type DiffTableMarker } from './markdownDiffTable';
import { parseUnifiedDiffFile, type SideBySideCell } from './unifiedDiff';

SyntaxHighlighter.registerLanguage('javascript', js);
SyntaxHighlighter.registerLanguage('js', js);
SyntaxHighlighter.registerLanguage('typescript', ts);
SyntaxHighlighter.registerLanguage('ts', ts);
SyntaxHighlighter.registerLanguage('python', py);
SyntaxHighlighter.registerLanguage('py', py);
SyntaxHighlighter.registerLanguage('bash', bash);
SyntaxHighlighter.registerLanguage('sh', sh);
SyntaxHighlighter.registerLanguage('shell', sh);
SyntaxHighlighter.registerLanguage('json', json);
SyntaxHighlighter.registerLanguage('css', css);
SyntaxHighlighter.registerLanguage('html', xml);
SyntaxHighlighter.registerLanguage('xml', xml);
SyntaxHighlighter.registerLanguage('sql', sql);
SyntaxHighlighter.registerLanguage('yaml', yaml);
SyntaxHighlighter.registerLanguage('yml', yaml);
SyntaxHighlighter.registerLanguage('markdown', md);
SyntaxHighlighter.registerLanguage('md', md);
SyntaxHighlighter.registerLanguage('diff', diff);

// ---------------------------------------------------------------------------
// Inline Markdown Renderer
// Handles: **bold**, `code`, [links](url)
// ---------------------------------------------------------------------------

function renderInlineMarkdown(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${match.index}`;

    if (token.startsWith('**')) {
      nodes.push(
        <strong key={key} style={{ color: 'oklch(0.90 0.01 265)', fontWeight: 650 }}>
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith('`')) {
      nodes.push(
        <code
          key={key}
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: '0.92em',
            color: 'oklch(0.84 0.10 165)',
            background: 'oklch(0.24 0.012 265)',
            borderRadius: 4,
            padding: '1px 4px',
          }}
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      const linkMatch = token.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
      if (linkMatch) {
        nodes.push(
          <a
            key={key}
            href={linkMatch[2]}
            target="_blank"
            rel="noreferrer"
            style={{ color: 'oklch(0.78 0.12 165)', textDecoration: 'none' }}
          >
            {linkMatch[1]}
          </a>,
        );
      }
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

// ---------------------------------------------------------------------------
// Markdown Table
// ---------------------------------------------------------------------------

/** Check if a trimmed line is a markdown table row (starts and ends with |). */
function isTableRow(line: string): boolean {
  return isMarkdownTableRow(line);
}

/** Check if a trimmed line is a table separator row: |---|:---:|---| etc. */
function isTableSeparator(line: string): boolean {
  return isMarkdownTableSeparator(line);
}

/** Parse alignment from a separator row. Returns 'left' | 'center' | 'right' for each column. */
function parseAlignments(separator: string): Array<'left' | 'center' | 'right'> {
  return parseTableLine(separator).row
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => {
      const trimmed = cell.trim();
      if (trimmed.startsWith(':') && trimmed.endsWith(':')) return 'center';
      if (trimmed.endsWith(':')) return 'right';
      return 'left';
    });
}

/** Split a table row into cell values (trimmed, without leading/trailing |). */
function parseTableCells(row: string): string[] {
  return tableCells(row);
}

const TABLE_STYLE: React.CSSProperties = {
  width: '100%',
  margin: '0 0 12px',
  borderCollapse: 'collapse' as const,
  fontSize: 12,
  lineHeight: 1.55,
};

const TH_STYLE: React.CSSProperties = {
  padding: '7px 10px',
  borderBottom: '2px solid oklch(0.38 0.014 265)',
  textAlign: 'left' as const,
  fontWeight: 650,
  color: 'oklch(0.88 0.01 265)',
  background: 'oklch(0.19 0.01 265 / 0.6)',
  whiteSpace: 'nowrap' as const,
};

const TD_STYLE: React.CSSProperties = {
  padding: '6px 10px',
  borderBottom: '1px solid oklch(0.24 0.012 265)',
  verticalAlign: 'top' as const,
};

const DIFF_FILE_STYLE: React.CSSProperties = {
  margin: '0 0 12px',
  border: '1px solid oklch(0.28 0.012 265)',
  borderRadius: 8,
  overflow: 'hidden',
  background: 'oklch(0.15 0.008 265)',
};

const DIFF_FILE_INNER_STYLE: React.CSSProperties = {
  overflowX: 'auto',
};

const SIDE_BY_SIDE_GRID_STYLE: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(420px, 1fr) minmax(420px, 1fr)',
  minWidth: 900,
};

const SIDE_HEADER_STYLE: React.CSSProperties = {
  padding: '7px 10px',
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: 10.5,
  color: 'oklch(0.62 0.012 265)',
  background: 'oklch(0.17 0.008 265)',
  borderBottom: '1px solid oklch(0.25 0.012 265)',
};

const SIDE_META_STYLE: React.CSSProperties = {
  gridColumn: '1 / -1',
  padding: '4px 10px',
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: 11,
  color: 'oklch(0.55 0.012 265)',
  background: 'oklch(0.145 0.006 265)',
  borderBottom: '1px solid oklch(0.22 0.012 265)',
  whiteSpace: 'pre-wrap',
};

const SIDE_HUNK_STYLE: React.CSSProperties = {
  gridColumn: '1 / -1',
  padding: '5px 10px',
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: 11,
  color: 'oklch(0.70 0.07 250)',
  background: 'oklch(0.19 0.02 265)',
  borderTop: '1px solid oklch(0.28 0.012 265)',
  borderBottom: '1px solid oklch(0.28 0.012 265)',
  whiteSpace: 'pre-wrap',
};

const SIDE_CELL_BASE_STYLE: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '48px 22px minmax(0, 1fr)',
  minHeight: 22,
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: 11,
  lineHeight: 1.55,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  borderBottom: '1px solid oklch(0.22 0.012 265 / 0.55)',
};

const DIFF_MARKER_STYLE: React.CSSProperties = {
  width: 28,
  padding: '6px 8px',
  borderBottom: '1px solid oklch(0.24 0.012 265)',
  fontFamily: "'IBM Plex Mono', monospace",
  fontWeight: 700,
  textAlign: 'center',
  verticalAlign: 'top',
};

function markerSymbol(marker: DiffTableMarker): string {
  if (marker === 'add') return '+';
  if (marker === 'delete') return '-';
  return '';
}

function markerColor(marker: DiffTableMarker): string {
  if (marker === 'add') return 'oklch(0.76 0.12 150)';
  if (marker === 'delete') return 'oklch(0.70 0.16 25)';
  return 'oklch(0.48 0.012 265)';
}

function rowBackground(marker: DiffTableMarker): string | undefined {
  if (marker === 'add') return 'oklch(0.55 0.10 150 / 0.10)';
  if (marker === 'delete') return 'oklch(0.58 0.16 25 / 0.10)';
  return undefined;
}

// ---------------------------------------------------------------------------
// Code Block (with syntax highlighting when language is specified)
// ---------------------------------------------------------------------------

const CODE_BLOCK_STYLE: React.CSSProperties = {
  margin: '0 0 10px',
  borderRadius: 8,
  overflowX: 'auto' as const,
  border: '1px solid oklch(0.28 0.012 265)',
  fontSize: 11.5,
  lineHeight: 1.55,
};

export function CodeBlock({ code, lang }: { code: string; lang: string }) {
  // If a language is specified, use syntax highlighting.
  if (lang && lang.length > 0) {
    try {
      return (
        <SyntaxHighlighter
          className="thin-scrollbar"
          language={lang}
          style={atomOneDark}
          customStyle={{
            margin: '0 0 10px',
            borderRadius: 8,
            border: '1px solid oklch(0.28 0.012 265)',
            fontSize: 11.5,
            lineHeight: 1.55,
            background: 'oklch(0.15 0.008 265)',
          }}
        >
          {code}
        </SyntaxHighlighter>
      );
    } catch {
      // Fallback to plain code block
    }
  }

  // Plain code block — no syntax highlighting.
  return (
    <pre className="thin-scrollbar" style={{ ...CODE_BLOCK_STYLE, padding: '9px 10px', background: 'oklch(0.15 0.008 265)', color: 'oklch(0.82 0.01 265)', fontFamily: "'IBM Plex Mono', monospace" }}>
      <code>{code}</code>
    </pre>
  );
}

function sideCellStyle(cell: SideBySideCell, side: 'left' | 'right'): React.CSSProperties {
  const bg = cell.kind === 'delete'
    ? 'oklch(0.58 0.16 25 / 0.13)'
    : cell.kind === 'add'
    ? 'oklch(0.55 0.10 150 / 0.13)'
    : cell.kind === 'blank'
    ? 'oklch(0.12 0.005 265 / 0.35)'
    : undefined;
  return {
    ...SIDE_CELL_BASE_STYLE,
    background: bg,
    borderRight: side === 'left' ? '1px solid oklch(0.25 0.012 265)' : undefined,
  };
}

function sideTextColor(cell: SideBySideCell): string {
  if (cell.kind === 'delete') return 'oklch(0.76 0.11 25)';
  if (cell.kind === 'add') return 'oklch(0.76 0.10 150)';
  return 'oklch(0.78 0.01 265)';
}

function SideCell({ cell, side }: { cell: SideBySideCell; side: 'left' | 'right' }) {
  return (
    <div style={sideCellStyle(cell, side)}>
      <span style={{ padding: '2px 8px 2px 4px', color: 'oklch(0.48 0.012 265)', textAlign: 'right', userSelect: 'none', background: 'oklch(0.13 0.006 265 / 0.5)' }}>
        {cell.line ?? ''}
      </span>
      <span style={{ padding: '2px 0', textAlign: 'center', fontWeight: 700, color: sideTextColor(cell), userSelect: 'none' }}>
        {cell.marker}
      </span>
      <span style={{ padding: '2px 10px 2px 0', color: sideTextColor(cell) }}>
        {cell.text}
      </span>
    </div>
  );
}

function DiffFileBlock({ text }: { text: string }) {
  const parsed = parseUnifiedDiffFile(text);
  if (!parsed) {
    return (
      <div style={DIFF_FILE_STYLE}>
        <div className="thin-scrollbar" style={DIFF_FILE_INNER_STYLE}>
          <MarkdownBlock text={text} variant="markdown" />
        </div>
      </div>
    );
  }

  return (
    <div style={DIFF_FILE_STYLE}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid oklch(0.28 0.012 265)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11.5, color: 'oklch(0.72 0.04 220)', background: 'oklch(0.19 0.01 265)' }}>
        {parsed.title}
      </div>
      <div className="thin-scrollbar" style={DIFF_FILE_INNER_STYLE}>
        <div style={SIDE_BY_SIDE_GRID_STYLE}>
          <div style={{ ...SIDE_HEADER_STYLE, borderRight: '1px solid oklch(0.25 0.012 265)' }}>{parsed.oldPath}</div>
          <div style={SIDE_HEADER_STYLE}>{parsed.newPath}</div>
          {parsed.rows.map((row, idx) => {
            if (row.type === 'meta') {
              return <div key={idx} style={SIDE_META_STYLE}>{row.text}</div>;
            }
            if (row.type === 'hunk') {
              return <div key={idx} style={SIDE_HUNK_STYLE}>{row.text}</div>;
            }
            return (
              <React.Fragment key={idx}>
                <SideCell cell={row.left} side="left" />
                <SideCell cell={row.right} side="right" />
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MarkdownBlock — block-level Markdown renderer
//
// Supported syntax:
//   - # / ## / ### headings
//   - Blank-line-separated paragraphs
//   - ``` fenced code blocks (with optional language for highlighting)
//   - > blockquotes
//   - Unordered lists (- / *)
//   - Ordered lists (1. / 2.)
//   - Inline: **bold**, `code`, [links](url)
// ---------------------------------------------------------------------------

interface MarkdownBlockProps {
  text: string;
  /** Font size override. Defaults to 12.5px. */
  fontSize?: number;
  /**
   * `tool-output` preserves raw CLI/log-ish structures such as git diffs,
   * file trees, and diff-prefixed markdown tables.
   */
  variant?: 'markdown' | 'tool-output';
  /**
   * When true, consecutive non-empty lines are treated as separate lines
   * (joined with \n + whiteSpace: pre-wrap) rather than merged into a
   * markdown paragraph.  Useful for tool results / log output where each
   * line carries independent meaning.
   */
  preserveNewlines?: boolean;
}

export function MarkdownBlock({ text, fontSize = 12.5, preserveNewlines = false, variant = 'markdown' }: MarkdownBlockProps) {
  const sourceText = variant === 'tool-output' ? preprocessToolMarkdown(text) : text;
  const lines = sourceText.replace(/\r\n/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let paragraph: string[] = [];
  let list: Array<{ ordered: boolean; text: string }> = [];
  let tableRows: string[] = [];
  let code: string[] | null = null;
  let diffFile: string[] | null = null;
  let codeLang = '';
  let codeFence = '';

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const sep = preserveNewlines ? '\n' : ' ';
    const content = paragraph.join(sep).trim();
    if (content) {
      blocks.push(
        <p
          key={`p-${blocks.length}`}
          style={{
            margin: '0 0 10px',
            lineHeight: 1.68,
            ...(preserveNewlines ? { whiteSpace: 'pre-wrap' } : {}),
          }}
        >
          {renderInlineMarkdown(content, `p-${blocks.length}`)}
        </p>,
      );
    }
    paragraph = [];
  };

  const flushList = () => {
    if (list.length === 0) return;
    const ordered = list[0]!.ordered;
    const Tag = ordered ? 'ol' : 'ul';
    blocks.push(
      <Tag key={`list-${blocks.length}`} style={{ margin: '0 0 10px', paddingLeft: 18, lineHeight: 1.6 }}>
        {list.map((item, idx) => (
          <li key={idx} style={{ marginBottom: 5 }}>
            {renderInlineMarkdown(item.text, `li-${blocks.length}-${idx}`)}
          </li>
        ))}
      </Tag>,
    );
    list = [];
  };

  const flushTable = () => {
    if (tableRows.length < 1) return;
    // Need at least 2 rows (header + separator)
    if (tableRows.length < 2 || !isTableRow(tableRows[0]!) || !isTableSeparator(tableRows[1]!)) {
      // Not a valid table — put rows back as paragraph text
      paragraph.push(...tableRows);
      tableRows = [];
      return;
    }
    const headerCells = parseTableCells(tableRows[0]!);
    const alignments = parseAlignments(tableRows[1]!);
    const dataRows = tableRows.slice(2).filter((r) => isTableRow(r));
    const hasDiffMarkers = dataRows.some((r) => {
      const marker = parseTableLine(r).marker;
      return marker === 'add' || marker === 'delete' || marker === 'context';
    });

    // Pad alignments to match header column count
    while (alignments.length < headerCells.length) alignments.push('left');

    blocks.push(
      <div key={`table-wrap-${blocks.length}`} className="thin-scrollbar" style={{ overflowX: 'auto', marginBottom: 12 }}>
        <table style={TABLE_STYLE}>
          <thead>
            <tr>
              {hasDiffMarkers && (
                <th aria-label="diff marker" style={{ ...TH_STYLE, width: 28, paddingLeft: 8, paddingRight: 8 }} />
              )}
              {headerCells.map((cell, ci) => (
                <th key={ci} style={{ ...TH_STYLE, textAlign: alignments[ci] ?? 'left' }}>
                  {renderInlineMarkdown(cell, `th-${blocks.length}-${ci}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dataRows.map((row, ri) => {
              const cells = parseTableCells(row);
              const marker = parseTableLine(row).marker;
              return (
                <tr key={ri} style={{ background: rowBackground(marker) }}>
                  {hasDiffMarkers && (
                    <td style={{ ...DIFF_MARKER_STYLE, color: markerColor(marker) }}>
                      {markerSymbol(marker)}
                    </td>
                  )}
                  {headerCells.map((_, ci) => (
                    <td key={ci} style={{ ...TD_STYLE, textAlign: alignments[ci] ?? 'left' }}>
                      {renderInlineMarkdown(cells[ci] ?? '', `td-${blocks.length}-${ri}-${ci}`)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>,
    );
    tableRows = [];
  };

  lines.forEach((rawLine) => {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (trimmed === DIFF_FILE_START) {
      flushParagraph();
      flushList();
      flushTable();
      diffFile = [];
      return;
    }

    if (trimmed === DIFF_FILE_END && diffFile) {
      blocks.push(<DiffFileBlock key={`diff-file-${blocks.length}`} text={diffFile.join('\n')} />);
      diffFile = null;
      return;
    }

    if (diffFile) {
      diffFile.push(rawLine);
      return;
    }

    // Fenced code block (supports 3+ backticks: ```, ````, etc.)
    const fenceMatch = trimmed.match(/^(`{3,})/);
    if (fenceMatch) {
      flushParagraph();
      flushList();
      const fence = fenceMatch[1]!;
      if (code) {
        // Closing fence — must use at least as many backticks as the opening fence
        if (fence.length >= codeFence.length) {
          blocks.push(<CodeBlock key={`code-${blocks.length}`} code={code.join('\n')} lang={codeLang} />);
          code = null;
          codeLang = '';
          codeFence = '';
        } else {
          // Shorter fence inside a code block — include as content
          code.push(rawLine);
        }
      } else {
        // Opening fence — extract language tag
        codeLang = trimmed.slice(fence.length).trim();
        codeFence = fence;
        code = [];
      }
      return;
    }

    if (code) {
      code.push(rawLine);
      return;
    }

    if (!trimmed) {
      flushParagraph();
      flushList();
      flushTable();
      return;
    }

    // Table rows
    if (isTableRow(trimmed) || (tableRows.length > 0 && isTableSeparator(trimmed))) {
      if (tableRows.length === 0) {
        flushParagraph();
        flushList();
      }
      tableRows.push(trimmed);
      return;
    }
    if (tableRows.length > 0) flushTable();

    // Headings
    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1]!.length;
      const headingSizes = { 1: 14.5, 2: 13.5, 3: 12.5 };
      const size = headingSizes[level as keyof typeof headingSizes] ?? 12.5;
      blocks.push(
        <div
          key={`h-${blocks.length}`}
          style={{
            margin: blocks.length === 0 ? '0 0 8px' : '13px 0 8px',
            fontSize: size,
            fontWeight: 700,
            color: 'oklch(0.88 0.01 265)',
          }}
        >
          {renderInlineMarkdown(heading[2]!, `h-${blocks.length}`)}
        </div>,
      );
      return;
    }

    // Blockquote
    const quote = trimmed.match(/^>\s?(.+)$/);
    if (quote) {
      flushParagraph();
      flushList();
      blocks.push(
        <blockquote
          key={`q-${blocks.length}`}
          style={{
            margin: '0 0 10px',
            padding: '5px 0 5px 10px',
            borderLeft: '2px solid oklch(0.45 0.09 165)',
            color: SEMANTIC.textMuted,
            lineHeight: 1.6,
          }}
        >
          {renderInlineMarkdown(quote[1]!, `q-${blocks.length}`)}
        </blockquote>,
      );
      return;
    }

    // Lists
    const unordered = trimmed.match(/^[-*]\s+(.+)$/);
    const ordered = trimmed.match(/^\d+\.\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      const isOrdered = Boolean(ordered);
      if (list.length > 0 && list[0]!.ordered !== isOrdered) flushList();
      list.push({ ordered: isOrdered, text: (unordered?.[1] || ordered?.[1] || '').trim() });
      return;
    }

    flushList();
    paragraph.push(trimmed);
  });

  flushParagraph();
  flushList();
  flushTable();

  const openDiffFile = diffFile as string[] | null;
  if (openDiffFile) {
    blocks.push(<DiffFileBlock key={`diff-file-${blocks.length}`} text={openDiffFile.join('\n')} />);
    diffFile = null;
  }

  // Unclosed code block
  const openCode = code as string[] | null;
  if (openCode) {
    blocks.push(<CodeBlock key={`code-${blocks.length}`} code={openCode.join('\n')} lang={codeLang} />);
    codeLang = '';
    codeFence = '';
  }

  return <div style={{ fontSize, color: 'oklch(0.82 0.01 265)' }}>{blocks}</div>;
}

export { renderInlineMarkdown };
