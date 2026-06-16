import { SEMANTIC } from '../../styles/theme';

// ============================================================================
// Types
// ============================================================================

export interface GroupMember {
  key: string;
  color: string;
  label: string;
  pctFmt: string;
}

export interface CategoryGroup {
  key: 'io' | 'convo' | 'core';
  accent: string;
  label: string;
  desc: string;
  pctFmt: string;
  tokensFmt: string;
  members: GroupMember[];
}

export interface CategoryGroupsProps {
  groups: CategoryGroup[];
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Build a CSS conic-gradient string from a list of member percentages.
 *
 * Each member contributes a segment proportional to its numeric percentage.
 * Segments are ordered as given. The gradient starts at 12 o'clock (90deg offset).
 *
 * @example
 *   buildConicGradient([
 *     { color: '#ff0', pctFmt: '30.0%' },
 *     { color: '#0ff', pctFmt: '20.0%' },
 *   ])
 *   // => "conic-gradient(from -90deg, #ff0 0% 30%, #0ff 30% 50%)
 */
function buildConicGradient(members: GroupMember[]): string {
  if (members.length === 0) return 'none';

  let cumPct = 0;
  const stops: string[] = [];

  for (const m of members) {
    const pct = parseFloat(m.pctFmt);
    if (pct <= 0) continue;

    const start = cumPct;
    cumPct += pct;
    const end = cumPct;

    stops.push(`${m.color} ${start}% ${end}%`);
  }

  if (stops.length === 0) return 'none';
  return `conic-gradient(from -90deg, ${stops.join(', ')})`;
}

// ============================================================================
// Styles
// ============================================================================

const DONUT_SIZE = 88;
const DONUT_HOLE = 13; // inset for hole (diameter = DONUT_SIZE - 2 * DONUT_HOLE)

const s = {
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 18,
  } as React.CSSProperties,

  card: {
    border: `1px solid ${SEMANTIC.borderColor}`,
    borderRadius: 16,
    padding: 20,
    background: SEMANTIC.cardBg,
  } as React.CSSProperties,

  donutRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
  } as React.CSSProperties,

  donutOuter: (conic: string): React.CSSProperties => ({
    position: 'relative',
    width: DONUT_SIZE,
    height: DONUT_SIZE,
    flexShrink: 0,
    borderRadius: '50%',
    background: conic,
  }),

  donutHole: {
    position: 'absolute',
    inset: DONUT_HOLE,
    borderRadius: '50%',
    background: SEMANTIC.donutCenter,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
  } as React.CSSProperties,

  donutPct: (accent: string): React.CSSProperties => ({
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 15,
    fontWeight: 600,
    color: accent,
    lineHeight: 1,
  }),

  donutSub: {
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
    fontSize: 9,
    color: SEMANTIC.textMuted3,
    marginTop: 2,
    textAlign: 'center' as const,
    lineHeight: 1.2,
    maxWidth: DONUT_SIZE - 2 * DONUT_HOLE - 4,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  } as React.CSSProperties,

  infoCol: {
    flex: 1,
    minWidth: 0,
  } as React.CSSProperties,

  groupTitle: {
    fontSize: 16,
    fontWeight: 600,
    color: SEMANTIC.textPrimary,
    lineHeight: 1,
  } as React.CSSProperties,

  groupTokens: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    color: SEMANTIC.textSecondary,
    marginTop: 3,
  } as React.CSSProperties,

  groupDesc: {
    fontSize: 11.5,
    color: SEMANTIC.textDesc4,
    marginTop: 5,
    lineHeight: 1.35,
  } as React.CSSProperties,

  memberList: {
    marginTop: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 7,
  } as React.CSSProperties,

  memberRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
  } as React.CSSProperties,

  memberDot: (color: string): React.CSSProperties => ({
    width: 8,
    height: 8,
    borderRadius: 2,
    background: color,
    flexShrink: 0,
  }),

  memberLabel: {
    flex: 1,
    color: SEMANTIC.textPrimary4,
  } as React.CSSProperties,

  memberPct: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: SEMANTIC.textMiniLabel,
  } as React.CSSProperties,
};

// ============================================================================
// Component
// ============================================================================

export default function CategoryGroups({ groups }: CategoryGroupsProps) {
  return (
    <div style={s.grid}>
      {groups.map((g) => {
        const conic = buildConicGradient(g.members);
        const hasDonut = conic !== 'none';

        return (
          <div key={g.key} style={s.card}>
            {/* Donut + Title Row */}
            <div style={s.donutRow}>
              {/* Donut ring */}
              {hasDonut ? (
                <div style={s.donutOuter(conic)}>
                  <div style={s.donutHole}>
                    <div style={s.donutPct(g.accent)}>{g.pctFmt}</div>
                    <div style={s.donutSub}>占峰值输入</div>
                  </div>
                </div>
              ) : (
                <div style={{ ...s.donutOuter('none'), background: 'transparent', border: `2px dashed ${SEMANTIC.borderSubtle}` }}>
                  <div style={s.donutHole}>
                    <div style={s.donutPct(g.accent)}>{g.pctFmt}</div>
                    <div style={s.donutSub}>占峰值输入</div>
                  </div>
                </div>
              )}

              {/* Info column */}
              <div style={s.infoCol}>
                <div style={s.groupTitle}>{g.label}</div>
                <div style={s.groupTokens}>{g.tokensFmt} tok</div>
                <div style={s.groupDesc}>{g.desc}</div>
              </div>
            </div>

            {/* Member list */}
            {g.members.length > 0 && (
              <div style={s.memberList}>
                {g.members.map((m) => (
                  <div key={m.key} style={s.memberRow}>
                    <span style={s.memberDot(m.color)} />
                    <span style={s.memberLabel}>{m.label}</span>
                    <span style={s.memberPct}>{m.pctFmt}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
