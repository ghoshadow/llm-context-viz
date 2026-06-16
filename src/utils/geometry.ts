/**
 * Squarified Treemap Algorithm (Bruls-Huizing-van Wijk)
 *
 * Given a set of items with numeric values, this algorithm partitions a
 * rectangular area into cells whose areas are proportional to each item's value,
 * while keeping the aspect ratio of each cell as close to square as possible.
 *
 * Ported from the prototype's Context Assembly.dc.html (lines 296–335).
 */

// ---- Public types ----

/** An item that can be laid out by the treemap algorithm. */
export interface CellInput {
  value: number;
  [key: string]: unknown;
}

/** A positioned cell in the output. Coordinates span [0, containerSize). */
export interface CellResult {
  left: number;
  top: number;
  w: number;
  h: number;
  value: number;
  /** The original input item, preserved for reference. */
  item: CellInput;
}

// ---- Internal helpers ----

/** Internal representation: an item with its pre-computed target area. */
interface LayoutItem {
  area: number;
  value: number;
  item: CellInput;
}

/**
 * The "worst" aspect ratio for a candidate row.
 *
 *  ratio = max(
 *    (side² * maxArea) / sumArea²,
 *    sumArea² / (side² * minArea)
 *  )
 *
 * 1.0 is perfect (square); larger numbers mean worse aspect ratios.
 */
function worstRatio(row: LayoutItem[], side: number): number {
  const s = row.reduce((a, b) => a + b.area, 0);
  if (s === 0) return Infinity;
  const mx = Math.max(...row.map((r) => r.area));
  const mn = Math.min(...row.map((r) => r.area));
  if (mn === 0) return Infinity;
  return Math.max(
    (side * side * mx) / (s * s),
    (s * s) / (side * side * mn),
  );
}

/**
 * Place a row of items into the remaining rectangle.
 *
 * Returns the **remaining** rectangle after this row has been consumed.
 */
function layoutRow(
  row: LayoutItem[],
  rect: { x: number; y: number; w: number; h: number },
  horiz: boolean,
  out: CellResult[],
): { x: number; y: number; w: number; h: number } {
  const sum = row.reduce((a, b) => a + b.area, 0);

  if (horiz) {
    // Row spans the full width; height is derived from area.
    const rh = sum / rect.w;
    let cx = rect.x;
    for (const it of row) {
      const cw = it.area / rh;
      out.push({ left: cx, top: rect.y, w: cw, h: rh, value: it.value, item: it.item });
      cx += cw;
    }
    return { x: rect.x, y: rect.y + rh, w: rect.w, h: rect.h - rh };
  } else {
    // Row spans the full height; width is derived from area.
    const rw = sum / rect.h;
    let cy = rect.y;
    for (const it of row) {
      const ch = it.area / rw;
      out.push({ left: rect.x, top: cy, w: rw, h: ch, value: it.value, item: it.item });
      cy += ch;
    }
    return { x: rect.x + rw, y: rect.y, w: rect.w - rw, h: rect.h };
  }
}

// ---- Public API ----

/**
 * Compute a squarified treemap layout.
 *
 * @param cells - Items, each must have a numeric `value` field.
 * @param w     - Container width (default 100).
 * @param h     - Container height (default 100).
 * @returns      Positioned cells with geometry plus the original value.
 *
 * Cells are sorted descending by value (largest first) then laid out.
 * The output preserves this order. Coordinates are in the [0, w) x [0, h)
 * coordinate space of the container.
 */
export function squarify<T extends CellInput>(
  cells: T[],
  w = 100,
  h = 100,
): CellResult[] {
  // Filter out zero-value items — they produce NaN coordinates
  const valid = cells.filter((d) => d.value > 0);
  if (valid.length === 0) return [];

  // Sort descending by value (largest items get the best aspect ratios).
  const sorted = valid.map((d) => ({ item: d, v: d.value })).sort((a, b) => b.v - a.v);

  const total = sorted.reduce((a, b) => a + b.v, 0);
  if (total === 0) return [];

  // Scale values so the total area fills the container exactly.
  const scale = (w * h) / total;

  const items: LayoutItem[] = sorted.map((s) => ({
    area: s.v * scale,
    value: s.v,
    item: s.item,
  }));

  const out: CellResult[] = [];
  let rect = { x: 0, y: 0, w, h };

  let i = 0;
  while (i < items.length) {
    const horiz = rect.w <= rect.h;
    const side = horiz ? rect.w : rect.h;

    // Grow the row while adding the next item improves (or keeps) the
    // worst-case aspect ratio.
    let row: LayoutItem[] = [];
    let j = i;
    while (j < items.length) {
      const test = row.concat([items[j]!]);
      if (row.length === 0 || worstRatio(test, side) <= worstRatio(row, side)) {
        row = test;
        j++;
      } else {
        break;
      }
    }

    rect = layoutRow(row, rect, horiz, out);
    i = j;
  }

  return out;
}
