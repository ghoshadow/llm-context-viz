import React from 'react';
import {
  isMarkdownTableRow,
  isMarkdownTableSeparator,
  parseTableLine as parseDiffTableLine,
  tableCells,
} from './markdownDiffTable';
import type { ParsedTableLine } from './markdownDiffTable';

// ---------------------------------------------------------------------------
// Markdown Table
// ---------------------------------------------------------------------------

/** Check if a trimmed line is a markdown table row (starts and ends with |). */
export function isTableRow(line: string): boolean {
  return isMarkdownTableRow(line);
}

/** Check if a trimmed line is a table separator row: |---|:---:|---| etc. */
export function isTableSeparator(line: string): boolean {
  return isMarkdownTableSeparator(line);
}

export function parseTableLine(line: string): ParsedTableLine {
  return parseDiffTableLine(line);
}

/** Parse alignment from a separator row. Returns 'left' | 'center' | 'right' for each column. */
export function parseAlignments(separator: string): Array<'left' | 'center' | 'right'> {
  return parseDiffTableLine(separator).row
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
export function parseTableCells(row: string): string[] {
  return tableCells(row);
}

export const TABLE_STYLE: React.CSSProperties = {
  width: '100%',
  margin: '0 0 12px',
  borderCollapse: 'collapse' as const,
  fontSize: 12,
  lineHeight: 1.55,
};

export const TH_STYLE: React.CSSProperties = {
  padding: '7px 10px',
  borderBottom: '2px solid oklch(0.38 0.014 265)',
  textAlign: 'left' as const,
  fontWeight: 650,
  color: 'oklch(0.88 0.01 265)',
  background: 'oklch(0.19 0.01 265 / 0.6)',
  whiteSpace: 'nowrap' as const,
};

export const TD_STYLE: React.CSSProperties = {
  padding: '6px 10px',
  borderBottom: '1px solid oklch(0.24 0.012 265)',
  verticalAlign: 'top' as const,
};
