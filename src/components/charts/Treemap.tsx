import { useMemo } from 'react';
import type { CSSProperties, FC } from 'react';
import { squarify } from '../../utils/geometry';
import type { CellInput } from '../../utils/geometry';

// ─── Types ────────────────────────────────────────────────────────────────

export interface TreemapCell {
  key: string;
  value: number;
  color: string;
  label: string;
  pctFmt: string;
}

interface TreemapProps {
  cells: TreemapCell[];
  hoveredKey: string | null;
  onHover: (key: string | null) => void;
}

// ─── Styles ───────────────────────────────────────────────────────────────

const STYLE: Record<string, CSSProperties> = {
  container: {
    position: 'relative',
    width: '100%',
    paddingBottom: '66.67%',
    borderRadius: 12,
    overflow: 'hidden',
    border: '1px solid oklch(0.30 0.014 265)',
    background: 'oklch(0.185 0.009 265 / 0.7)',
    userSelect: 'none',
    cursor: 'default',
  },
  inner: {
    position: 'absolute',
    inset: 0,
  },
  cell: {
    position: 'absolute',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    padding: '6px 8px',
    overflow: 'hidden',
    transition: 'opacity 0.18s ease',
    cursor: 'pointer',
    boxSizing: 'border-box',
  },
  cellBorder: {
    outline: '1px solid oklch(0.16 0.008 265 / 0.5)',
    outlineOffset: -1,
  },
  label: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    lineHeight: 1.2,
    color: 'oklch(0.93 0.006 265)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  pct: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    lineHeight: 1.2,
    color: 'oklch(0.93 0.006 265)',
    textAlign: 'right',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
};

// ─── Component ────────────────────────────────────────────────────────────

const Treemap: FC<TreemapProps> = ({ cells, hoveredKey, onHover }) => {
  // Compute squarified layout from cell values.
  // We use percentage-based coordinates (100x100) and scale cells to the
  // inner container via percentage positioning.
  const layoutCells = useMemo(() => {
    if (cells.length === 0) return [];

    const results = squarify(cells as unknown as CellInput[], 100, 100);

    return results.map((r) => {
      const cell = r.item as unknown as TreemapCell;
      return { ...cell, left: r.left, top: r.top, w: r.w, h: r.h };
    });
  }, [cells]);

  const hasHover = hoveredKey !== null;

  return (
    <div style={STYLE.container}>
      <div style={STYLE.inner}>
        {layoutCells.map((c) => {
          const isHovered = c.key === hoveredKey;
          const isOther = hasHover && !isHovered;

          const cellStyle: CSSProperties = {
            ...STYLE.cell,
            ...STYLE.cellBorder,
            left: `${c.left}%`,
            top: `${c.top}%`,
            width: `${c.w}%`,
            height: `${c.h}%`,
            background: c.color,
            opacity: isOther ? 0.28 : 1,
          };

          return (
            <div
              key={c.key}
              style={cellStyle}
              onMouseEnter={() => onHover(c.key)}
              onMouseLeave={() => onHover(null)}
            >
              <div style={STYLE.label} title={c.label}>
                {c.label}
              </div>
              <div style={STYLE.pct}>{c.pctFmt}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default Treemap;
