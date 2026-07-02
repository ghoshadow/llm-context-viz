import React from 'react';
import { SEMANTIC } from '../../styles/theme';
import { CodeBlock } from './MarkdownCodeBlock';
import { DIFF_MARKER_STYLE, DiffFileBlock, markerColor, markerSymbol, rowBackground } from './MarkdownDiffFileBlock';
import { renderInlineMarkdown } from './markdownInline';
import { isTableRow, isTableSeparator, parseAlignments, parseTableCells, parseTableLine, TABLE_STYLE, TD_STYLE, TH_STYLE } from './markdownTable';
import { DIFF_FILE_END, DIFF_FILE_START, preprocessToolMarkdown } from './markdownToolOutput';

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
  const renderDiffFallback = (fallbackText: string) => <MarkdownBlock text={fallbackText} variant="markdown" />;

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
      blocks.push(<DiffFileBlock key={`diff-file-${blocks.length}`} text={diffFile.join('\n')} renderFallback={renderDiffFallback} />);
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
    blocks.push(<DiffFileBlock key={`diff-file-${blocks.length}`} text={openDiffFile.join('\n')} renderFallback={renderDiffFallback} />);
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

export { CodeBlock, renderInlineMarkdown };
