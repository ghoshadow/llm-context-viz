import React from 'react';
import type { DiffTableMarker } from './markdownDiffTable';
import { parseUnifiedDiffFile, type SideBySideCell } from './unifiedDiff';

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

export const DIFF_MARKER_STYLE: React.CSSProperties = {
  width: 28,
  padding: '6px 8px',
  borderBottom: '1px solid oklch(0.24 0.012 265)',
  fontFamily: "'IBM Plex Mono', monospace",
  fontWeight: 700,
  textAlign: 'center',
  verticalAlign: 'top',
};

export function markerSymbol(marker: DiffTableMarker): string {
  if (marker === 'add') return '+';
  if (marker === 'delete') return '-';
  return '';
}

export function markerColor(marker: DiffTableMarker): string {
  if (marker === 'add') return 'oklch(0.76 0.12 150)';
  if (marker === 'delete') return 'oklch(0.70 0.16 25)';
  return 'oklch(0.48 0.012 265)';
}

export function rowBackground(marker: DiffTableMarker): string | undefined {
  if (marker === 'add') return 'oklch(0.55 0.10 150 / 0.10)';
  if (marker === 'delete') return 'oklch(0.58 0.16 25 / 0.10)';
  return undefined;
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

export function DiffFileBlock({ text, renderFallback }: { text: string; renderFallback?: (text: string) => React.ReactNode }) {
  const parsed = parseUnifiedDiffFile(text);
  if (!parsed) {
    return (
      <div style={DIFF_FILE_STYLE}>
        <div className="thin-scrollbar" style={DIFF_FILE_INNER_STYLE}>
          {renderFallback ? renderFallback(text) : text}
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
