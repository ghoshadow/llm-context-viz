import { useMemo } from 'react';
import type { TurnSummary } from '../../types/session';
import { SEMANTIC, SELECTED_ITEM, UNSELECTED_ITEM, SCROLLBAR, WINDOW } from '../../styles/theme';
import { fmtK } from '../../utils/format';

// ============================================================================
// Types
// ============================================================================

export interface TurnListProps {
  turns: TurnSummary[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
}

// ============================================================================
// TurnListItem — individual button inside the scrollable list
// ============================================================================

function TurnListItem({
  turn,
  isSelected,
  onClick,
}: {
  turn: TurnSummary;
  isSelected: boolean;
  onClick: () => void;
}) {
  const numFmt = String(turn.turn_index).padStart(2, '0');
  const peakFmt = fmtK(turn.max_input);
  const contextLimit = WINDOW;
  const loadPct = Math.min(100, (turn.max_input / contextLimit) * 100);

  // ── Selected vs unselected dynamic values (ported from prototype lines 52-66) ──
  const borderColor = isSelected
    ? SELECTED_ITEM.border
    : UNSELECTED_ITEM.border;

  const bg = isSelected
    ? SELECTED_ITEM.bg
    : UNSELECTED_ITEM.bg;

  const numColor = isSelected
    ? SEMANTIC.textAccent3
    : SEMANTIC.textSecondary;

  const textColor = isSelected
    ? SEMANTIC.textPrimary
    : SEMANTIC.textDesc4;

  const peakColor = isSelected
    ? SEMANTIC.textAccent
    : SEMANTIC.textSecondary;

  const loadColor = isSelected
    ? SELECTED_ITEM.loadColor
    : UNSELECTED_ITEM.loadColor;

  return (
    <button
      onClick={onClick}
      style={{
        textAlign: 'left',
        border: `1px solid ${borderColor}`,
        borderRadius: 11,
        padding: '11px 13px',
        background: bg,
        cursor: 'pointer',
        fontFamily: 'inherit',
        color: 'inherit',
        transition: 'background .14s ease, border-color .14s ease',
        display: 'block',
        width: '100%',
      }}
    >
      {/* Row 1: turn number + request badge + peak tokens */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 6,
        }}
      >
        <span
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11,
            fontWeight: 600,
            color: numColor,
            width: 26,
            flexShrink: 0,
          }}
        >
          {numFmt}
        </span>

        <span
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 10,
            color: SEMANTIC.textMiniLabel,
            border: `1px solid ${SEMANTIC.borderColor}`,
            borderRadius: 5,
            padding: '1px 5px',
          }}
        >
          {turn.asst_reqs} 请求
        </span>

        <span style={{ flex: 1 }} />

        <span
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 10.5,
            color: peakColor,
          }}
        >
          {peakFmt}
        </span>
      </div>

      {/* Row 2: prompt preview (2-line clamp) */}
      <div
        style={{
          fontSize: 12.5,
          lineHeight: 1.45,
          color: textColor,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {turn.prompt || '(无提示词)'}
      </div>

      {/* Row 3: mini load bar (context usage %) */}
      <div
        style={{
          height: 3,
          borderRadius: 2,
          marginTop: 9,
          background: SEMANTIC.barBg,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${loadPct}%`,
            borderRadius: 2,
            background: loadColor,
          }}
        />
      </div>
    </button>
  );
}

// ============================================================================
// TurnList — scrollable turn list panel
// ============================================================================

export default function TurnList({ turns, selectedIndex, onSelect }: TurnListProps) {
  const turnCount = turns.length;

  // Zero-prefix for the first selected turn when showing details on the right
  const items = useMemo(
    () =>
      turns.map((turn) => ({
        turn,
        isSelected: selectedIndex === turn.turn_index,
      })),
    [turns, selectedIndex],
  );

  return (
    <div
      style={{
        border: `1px solid ${SEMANTIC.borderColor}`,
        borderRadius: 16,
        background: SEMANTIC.cardBg,
        overflow: 'hidden',
      }}
    >
      {/* ── Panel header ── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          padding: '16px 18px 12px',
          borderBottom: `1px solid ${SEMANTIC.borderSubtle2}`,
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: 14,
            fontWeight: 600,
            color: SEMANTIC.textPrimary,
          }}
        >
          对话轮次
        </h2>
        <span
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11,
            color: SEMANTIC.textMuted,
          }}
        >
          共 {turnCount} 轮
        </span>
      </div>

      {/* ── Scrollable list ── */}
      <div
        className="turn-list-scroll"
        style={{
          maxHeight: 760,
          overflowY: 'auto',
          padding: 8,
          display: 'flex',
          flexDirection: 'column',
          gap: 5,
        }}
      >
        {items.map(({ turn, isSelected }) => (
          <TurnListItem
            key={turn.id}
            turn={turn}
            isSelected={isSelected}
            onClick={() => onSelect(turn.turn_index)}
          />
        ))}
      </div>

      {/* Scrollbar styling via global CSS override */}
      <style>{`
        .turn-list-scroll::-webkit-scrollbar {
          width: 6px;
        }
        .turn-list-scroll::-webkit-scrollbar-track {
          background: ${SCROLLBAR.track};
        }
        .turn-list-scroll::-webkit-scrollbar-thumb {
          background: ${SCROLLBAR.thumb};
          border-radius: 3px;
        }
      `}</style>
    </div>
  );
}
