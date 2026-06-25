// ============================================================================
// Formatting utilities — ported from prototype DCLogic classes
// ============================================================================

/**
 * Locale-formatted integer (en-US, no decimals).
 *
 * @example fmt(1234567) => "1,234,567"
 */
export function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/**
 * Compact "12.5K" / "200K" format.
 *
 * - n >= 100000: rounds to nearest thousand (no decimal), e.g. 123456 => "123K"
 * - n >= 1000:  one decimal place, e.g. 1234 => "1.2K"
 * - n < 1000:  plain integer string
 *
 * @example fmtK(200) => "200"
 * @example fmtK(1234) => "1.2K"
 * @example fmtK(123456) => "123K"
 */
export function fmtK(n: number): string {
  if (n >= 100000) return Math.round(n / 1000) + 'K';
  if (n >= 1000) return (n / 1000).toFixed(2) + 'K';
  return String(Math.round(n));
}

/**
 * Human-readable duration from milliseconds.
 *
 * - < 1000ms:   "412ms"
 * - < 60000ms:  "4.1s" (one decimal)
 * - >= 60000ms: "4分12秒" (minutes; seconds omitted when zero)
 *
 * @example fmtDur(412) => "412ms"
 * @example fmtDur(4123) => "4.1s"
 * @example fmtDur(252000) => "4分12秒"
 * @example fmtDur(240000) => "4分"
 */
export function fmtDur(ms: number): string {
  if (ms >= 60000) {
    const m = Math.floor(ms / 60000);
    const s = Math.round((ms % 60000) / 1000);
    return s > 0 ? `${m}分${s}秒` : `${m}分`;
  }
  if (ms >= 1000) return (ms / 1000).toFixed(2) + 's';
  return Math.round(ms) + 'ms';
}

/**
 * Percentage string to one decimal place.
 *
 * @example fmtPct(3, 7) => "42.9%"
 */
export function fmtPct(n: number, total: number): string {
  return ((n / total) * 100).toFixed(2) + '%';
}

/**
 * Format an ISO timestamp as "MM-DD HH:MM".
 *
 * @example fmtDate("2026-06-15T14:30:00Z") => "06-15 14:30"
 */
export function fmtDate(iso: string): string {
  const d = new Date(iso);
  const MM = String(d.getMonth() + 1).padStart(2, '0');
  const DD = String(d.getDate()).padStart(2, '0');
  const HH = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${MM}-${DD} ${HH}:${mm}`;
}

/**
 * Format an ISO timestamp as date only (zh-CN locale).
 *
 * @example fmtDateOnly("2026-06-15T14:30:00Z") => "2026/06/15"
 */
export function fmtDateOnly(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    return iso.slice(0, 10);
  }
}

/**
 * Compact "M/D HH:MM" format — used where space is tight.
 *
 * @example fmtDateShort("2026-06-15T14:30:00Z") => "6/15 14:30"
 */
export function fmtDateShort(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
