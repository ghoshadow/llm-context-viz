import React from 'react';
import type { OntologyType, OntologyNode } from '../../types/ontology';

interface OntologyToolbarProps {
  types: OntologyType[];
  nodes: OntologyNode[];
  activeTypes: Record<string, boolean>;
  turn: number;
  maxTurn: number;
  playing: boolean;
  onToggleType: (key: string) => void;
  onSetTurn: (turn: number) => void;
  onTogglePlay: () => void;
  onRecenter: () => void;
  onUpdate?: () => void;
  onRebuild?: () => void;
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const s = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    border: '1px solid oklch(0.28 0.012 265)',
    borderRadius: 13,
    padding: '11px 14px',
    background: 'oklch(0.185 0.009 265 / 0.7)',
    flexWrap: 'wrap' as const,
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
    flexShrink: 0,
    marginTop: 16,
  },
  typeGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    flexWrap: 'wrap' as const,
  },
  typeLabel: {
    fontSize: 11,
    color: 'oklch(0.55 0.012 265)',
    marginRight: 2,
  },
  spacer: { flex: 1, minWidth: 20 },
  rightGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: 11,
  },
  playBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    border: '1px solid oklch(0.45 0.09 165)',
    borderRadius: 8,
    padding: '6px 12px',
    background: 'oklch(0.74 0.12 165 / 0.14)',
    color: 'oklch(0.84 0.10 165)',
    cursor: 'pointer',
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11.5,
    whiteSpace: 'nowrap' as const,
  },
  timelineLabel: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: 'oklch(0.58 0.012 265)',
    whiteSpace: 'nowrap' as const,
  },
  turnLabel: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    fontWeight: 600,
    color: 'oklch(0.82 0.10 165)',
    whiteSpace: 'nowrap' as const,
    width: 88,
  },
  recenterBtn: {
    border: '1px solid oklch(0.30 0.014 265)',
    borderRadius: 8,
    padding: '6px 10px',
    background: 'oklch(0.20 0.01 265 / 0.6)',
    color: 'oklch(0.70 0.012 265)',
    cursor: 'pointer',
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    whiteSpace: 'nowrap' as const,
  },
};

// ─── Component ──────────────────────────────────────────────────────────────

const OntologyToolbar: React.FC<OntologyToolbarProps> = ({
  types,
  nodes,
  activeTypes,
  turn,
  maxTurn,
  playing,
  onToggleType,
  onSetTurn,
  onTogglePlay,
  onRecenter,
  onUpdate,
  onRebuild,
}) => {
  return (
    <div style={s.bar}>
      {/* Type filter chips */}
      <div style={s.typeGroup}>
        <span style={s.typeLabel}>类型</span>
        {types.map((t) => {
          const active = activeTypes[t.key] !== false;
          const count = nodes.filter((n) => n.type === t.key).length;
          return (
            <button
              key={t.key}
              onClick={() => onToggleType(t.key)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                border: active
                  ? '1px solid oklch(0.40 0.03 265)'
                  : '1px solid oklch(0.26 0.012 265)',
                borderRadius: 20,
                padding: '4px 11px 4px 8px',
                background: active
                  ? 'oklch(0.24 0.012 265 / 0.7)'
                  : 'oklch(0.19 0.008 265 / 0.5)',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: 11.5,
                color: active ? 'oklch(0.88 0.01 265)' : 'oklch(0.55 0.012 265)',
                opacity: active ? 1 : 0.4,
                transition: 'opacity .12s ease',
              }}
            >
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: '50%',
                  background: t.color,
                  flexShrink: 0,
                }}
              />
              {t.label}
              <span
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 10,
                  color: 'oklch(0.58 0.012 265)',
                }}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Update / Rebuild buttons */}
      <div style={{ display: 'flex', gap: 6 }}>
        {onUpdate && (
          <button onClick={onUpdate} title="增量更新：仅提取新增轮次的实体"
            style={{ border: '1px solid oklch(0.45 0.09 165 / 0.5)', borderRadius: 8, padding: '6px 12px', background: 'oklch(0.74 0.12 165 / 0.10)', color: 'oklch(0.84 0.10 165)', cursor: 'pointer', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11.5, whiteSpace: 'nowrap' as const }}>
            + 更新
          </button>
        )}
        {onRebuild && (
          <button onClick={onRebuild} title="重建：从零重新提取全部实体"
            style={{ border: '1px solid oklch(0.45 0.09 165 / 0.35)', borderRadius: 8, padding: '6px 12px', background: 'transparent', color: 'oklch(0.74 0.10 165)', cursor: 'pointer', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11.5, whiteSpace: 'nowrap' as const }}>
            ↻ 重建
          </button>
        )}
      </div>

      {/* Spacer */}
      <div style={s.spacer} />

      {/* Timeline controls */}
      <div style={s.rightGroup}>
        <button onClick={onTogglePlay} style={s.playBtn}>
          {playing ? '⏸ 暂停' : '▶ 播放'}
        </button>
        <span style={s.timelineLabel}>演化时间轴</span>
        <input
          type="range"
          className="og"
          min={1}
          max={maxTurn}
          value={turn}
          onChange={(e) => onSetTurn(Number(e.target.value))}
          style={{ width: 230 }}
        />
        <span style={s.turnLabel}>
          {turn >= maxTurn ? `全部 ${maxTurn} 轮` : `至第 ${turn} 轮`}
        </span>
        <button onClick={onRecenter} style={s.recenterBtn}>
          ⊙ 居中
        </button>
      </div>

      {/* Slider CSS */}
      <style>{`
        input[type=range].og {
          -webkit-appearance: none; appearance: none;
          height: 4px; border-radius: 3px;
          background: oklch(0.32 0.012 265); outline: none;
        }
        input[type=range].og::-webkit-slider-thumb {
          -webkit-appearance: none; appearance: none;
          width: 15px; height: 15px; border-radius: 50%;
          background: oklch(0.80 0.12 165);
          border: 2px solid oklch(0.18 0.01 265);
          cursor: pointer;
          box-shadow: 0 0 8px oklch(0.74 0.12 165 / 0.6);
        }
      `}</style>
    </div>
  );
};

export default OntologyToolbar;
