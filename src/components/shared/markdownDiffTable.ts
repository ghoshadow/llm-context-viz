export type DiffTableMarker = 'add' | 'delete' | 'context' | 'none';

export interface ParsedTableLine {
  marker: DiffTableMarker;
  row: string;
}

const DIFF_TABLE_PREFIX = /^([+\- ])(\|.*\|)$/;

export function parseTableLine(line: string): ParsedTableLine {
  const trimmedRight = line.trimEnd();
  const diffMatch = trimmedRight.match(DIFF_TABLE_PREFIX);
  if (diffMatch) {
    const marker = diffMatch[1] === '+'
      ? 'add'
      : diffMatch[1] === '-'
      ? 'delete'
      : 'context';
    return { marker, row: diffMatch[2]! };
  }
  return { marker: 'none', row: trimmedRight.trim() };
}

export function isMarkdownTableRow(line: string): boolean {
  return /^\|.+\|$/.test(parseTableLine(line).row);
}

export function isMarkdownTableSeparator(line: string): boolean {
  const row = parseTableLine(line).row;
  return /^\|[\s\-:|]+\|$/.test(row) && row.includes('-');
}

export function tableCells(line: string): string[] {
  return parseTableLine(line).row
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim());
}

export function tableMarkers(lines: string[]): DiffTableMarker[] {
  return lines.map((line) => parseTableLine(line).marker);
}
