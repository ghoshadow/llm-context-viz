import React from 'react';
import { SEMANTIC } from '../../styles/theme';
import type { OntologyData, OntologyNode, OntologyEdge } from '../../types/ontology';
import { sortOntologyTypes } from './typeOrder';

interface OntologyDetailPanelProps {
  data: OntologyData;
  selectedNodeId: string | null;
  turn: number;
  activeTypes: Record<string, boolean>;
  degree: Record<string, number>;
  onSelectNode: (id: string | null) => void;
  onClearSelection: () => void;
  onJumpToTurn: (turn: number) => void;
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

function confColor(c: number): string {
  if (c >= 0.85) return 'oklch(0.78 0.12 150)';
  if (c >= 0.7) return 'oklch(0.80 0.11 95)';
  return 'oklch(0.76 0.13 45)';
}

// ─── Empty State ────────────────────────────────────────────────────────────

function EmptyState({
  data,
  degree,
  onSelectNode,
}: {
  data: OntologyData;
  degree: Record<string, number>;
  onSelectNode: (id: string | null) => void;
}) {
  // Count per type
  const counts: Record<string, number> = {};
  data.types.forEach((t) => (counts[t.key] = 0));
  data.nodes.forEach((n) => (counts[n.type] = (counts[n.type] || 0) + 1));

  // Hub entities by degree
  const hubs = [...data.nodes]
    .sort((a, b) => (degree[b.id] || 0) - (degree[a.id] || 0))
    .slice(0, 7);

  return (
    <div>
      {/* Legend */}
      <h2 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 600, color: SEMANTIC.textPrimary }}>
        图例 · 实体类型
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
        {sortOntologyTypes(data.types).map((t) => (
          <div key={t.key} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 12.5 }}>
            <span
              style={{ width: 11, height: 11, borderRadius: '50%', background: t.color, flexShrink: 0 }}
            />
            <span style={{ flex: 1, color: 'oklch(0.82 0.01 265)' }}>{t.label}</span>
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: SEMANTIC.textMuted }}>
              {counts[t.key] || 0}
            </span>
          </div>
        ))}
      </div>

      {/* Hub entities */}
      <h2 style={{ margin: '0 0 9px', fontSize: 14, fontWeight: 600, color: SEMANTIC.textPrimary }}>
        核心枢纽实体
      </h2>
      <p style={{ margin: '0 0 11px', fontSize: 11.5, color: SEMANTIC.textDesc4, lineHeight: 1.5 }}>
        关联最多的实体 —— 点击在图中聚焦。
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {hubs.map((n) => (
          <button
            key={n.id}
            onClick={() => onSelectNode(n.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              border: '1px solid oklch(0.26 0.012 265)',
              borderRadius: 9,
              padding: '8px 10px',
              background: SEMANTIC.innerCardBg,
              cursor: 'pointer',
              fontFamily: 'inherit',
              textAlign: 'left' as const,
              width: '100%',
              color: 'inherit',
            }}
          >
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: '50%',
                background: data.types.find((t) => t.key === n.type)?.color || 'oklch(0.6 0 0)',
                flexShrink: 0,
              }}
            />
            <span style={{ flex: 1, fontSize: 12.5, color: SEMANTIC.textPrimary6 }}>{n.label}</span>
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: SEMANTIC.textMuted }}>
              {degree[n.id] || 0} 连
            </span>
          </button>
        ))}
      </div>

      {/* Disambiguation footnote */}
      <div style={{ marginTop: 18, borderTop: `1px solid ${SEMANTIC.borderSubtle2}`, paddingTop: 13, fontSize: 11.5, color: SEMANTIC.textMuted, lineHeight: 1.6 }}>
        <span style={{ color: 'oklch(0.78 0.10 60)' }}>◆</span> 标「消歧」的实体表示对话中出现过同义混淆或假设修正，已合并/澄清。
      </div>
    </div>
  );
}

// ─── Selected Entity State ──────────────────────────────────────────────────

function SelectedEntity({
  node,
  typeColor,
  typeLabel,
  data,
  turn,
  activeTypes,
  degree,
  onSelectNode,
  onClearSelection,
  onJumpToTurn,
}: {
  node: OntologyNode;
  typeColor: string;
  typeLabel: string;
  data: OntologyData;
  turn: number;
  activeTypes: Record<string, boolean>;
  degree: Record<string, number>;
  onSelectNode: (id: string | null) => void;
  onClearSelection: () => void;
  onJumpToTurn: (turn: number) => void;
}) {
  const c = node.conf;
  const cfColor = confColor(c);

  // Related edges
  const visibleIds = new Set(
    data.nodes.filter((n) => activeTypes[n.type] !== false && n.firstTurn <= turn).map((n) => n.id),
  );
  const related: {
    id: string;
    label: string;
    color: string;
    rel: string;
    dir: string;
  }[] = [];
  data.edges.forEach((e) => {
    if (e.firstTurn > turn) return;
    if (e.s === node.id && visibleIds.has(e.t)) {
      const o = data.nodes.find((n) => n.id === e.t);
      if (o)
        related.push({
          id: e.t,
          label: o.label,
          color: data.types.find((t) => t.key === o.type)?.color || 'oklch(0.6 0 0)',
          rel: e.label,
          dir: '→',
        });
    } else if (e.t === node.id && visibleIds.has(e.s)) {
      const o = data.nodes.find((n) => n.id === e.s);
      if (o)
        related.push({
          id: e.s,
          label: o.label,
          color: data.types.find((t) => t.key === o.type)?.color || 'oklch(0.6 0 0)',
          rel: e.label,
          dir: '←',
        });
    }
  });

  return (
    <div>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            border: `1px solid ${typeColor}`,
            borderRadius: 20,
            padding: '3px 10px',
            fontSize: 11,
            color: typeColor,
            background: 'oklch(0.22 0.01 265 / 0.6)',
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: typeColor }} />
          {typeLabel}
        </span>
        <span style={{ flex: 1 }} />
        <button
          onClick={onClearSelection}
          style={{
            border: '1px solid oklch(0.30 0.014 265)',
            borderRadius: 7,
            width: 26,
            height: 26,
            background: 'oklch(0.22 0.01 265)',
            color: 'oklch(0.78 0.01 265)',
            cursor: 'pointer',
            fontSize: 13,
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>

      {/* Name */}
      <h2 style={{ margin: '6px 0 2px', fontSize: 19, fontWeight: 600, lineHeight: 1.2, color: SEMANTIC.textPrimary }}>
        {node.label}
      </h2>

      {/* Aliases */}
      {node.aliases.length > 0 && (
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: SEMANTIC.textMuted, marginTop: 2 }}>
          别名 · {node.aliases.join(' · ')}
        </div>
      )}

      {/* Confidence */}
      <div style={{ marginTop: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
          <span style={{ fontSize: 11.5, color: SEMANTIC.textDesc3 }}>抽取置信度</span>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, fontWeight: 600, color: cfColor }}>
            {Math.round(c * 100)}%
          </span>
        </div>
        <div style={{ height: 6, borderRadius: 4, background: 'oklch(0.24 0.01 265)', overflow: 'hidden' }}>
          <div
            style={{
              height: '100%',
              width: `${Math.round(c * 100)}%`,
              borderRadius: 4,
              background: cfColor,
            }}
          />
        </div>
      </div>

      {/* Disambiguation note */}
      {node.note && (
        <div
          style={{
            marginTop: 14,
            border: '1px solid oklch(0.42 0.09 60 / 0.5)',
            borderRadius: 10,
            padding: '10px 12px',
            background: 'oklch(0.74 0.12 60 / 0.08)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, color: 'oklch(0.82 0.10 60)', marginBottom: 5 }}>
            ◆ 消歧 / 冲突消解
          </div>
          <div style={{ fontSize: 12, color: 'oklch(0.80 0.02 60)', lineHeight: 1.55 }}>{node.note}</div>
        </div>
      )}

      {/* Source snippet */}
      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 11.5, color: SEMANTIC.textDesc3, marginBottom: 6 }}>
          原文片段
          {node.snippetQuality === 'low' && (
            <span style={{ marginLeft: 8, fontSize: 10, color: 'oklch(0.76 0.13 45)' }}>⚠ 可能与实体无关</span>
          )}
        </div>
        <div
          style={{
            fontSize: 12.5,
            color: 'oklch(0.82 0.01 265)',
            lineHeight: 1.6,
            borderLeft: `2px solid ${typeColor}`,
            padding: '2px 0 2px 11px',
            fontStyle: 'italic',
            opacity: node.snippetQuality === 'low' ? 0.6 : 1,
          }}
        >
          「{node.snippet}」
        </div>
      </div>

      {/* Turn chips */}
      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 11.5, color: SEMANTIC.textDesc3, marginBottom: 7 }}>
          出现于 {node.turns.length} 轮 · 首现第 {node.firstTurn} 轮（点击跳转）
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {node.turns.map((t) => (
            <button
              key={t}
              onClick={() => onJumpToTurn(t)}
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 11,
                border: '1px solid oklch(0.30 0.014 265)',
                borderRadius: 6,
                padding: '2px 8px',
                background: SEMANTIC.innerCardBg,
                color: 'oklch(0.78 0.01 265)',
                cursor: 'pointer',
              }}
            >
              第{t}轮
            </button>
          ))}
        </div>
      </div>

      {/* Related entities */}
      <div style={{ marginTop: 18 }}>
        <div style={{ fontSize: 11.5, color: SEMANTIC.textDesc3, marginBottom: 8 }}>
          关联实体 · {related.length}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {related.map((r) => (
            <button
              key={r.id + r.dir + r.rel}
              onClick={() => onSelectNode(r.id)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 3,
                border: '1px solid oklch(0.26 0.012 265)',
                borderRadius: 9,
                padding: '8px 10px',
                background: SEMANTIC.innerCardBg,
                cursor: 'pointer',
                fontFamily: 'inherit',
                textAlign: 'left' as const,
                width: '100%',
                color: 'inherit',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: r.color, flexShrink: 0 }} />
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: SEMANTIC.textMuted2, flexShrink: 0 }}>
                  {r.dir}
                </span>
                <span style={{ fontSize: 11, color: SEMANTIC.textDesc }}>{r.rel}</span>
              </div>
              <span style={{ fontSize: 12, color: SEMANTIC.textPrimary6, paddingLeft: 14, lineHeight: 1.35 }}>
                {r.label}
              </span>
            </button>
          ))}
          {related.length === 0 && (
            <div style={{ fontSize: 12, color: SEMANTIC.textDesc3, padding: '8px 0' }}>无关联实体</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

const OntologyDetailPanel: React.FC<OntologyDetailPanelProps> = ({
  data,
  selectedNodeId,
  turn,
  activeTypes,
  degree,
  onSelectNode,
  onClearSelection,
  onJumpToTurn,
}) => {
  const node = selectedNodeId ? data.nodes.find((n) => n.id === selectedNodeId) : null;
  const typeInfo = node ? data.types.find((t) => t.key === node.type) : null;

  return (
    <div
      className="tl"
      style={{
        border: `1px solid ${SEMANTIC.borderColor}`,
        borderRadius: 16,
        background: SEMANTIC.cardBg,
        overflowY: 'auto',
        padding: '18px 18px 22px',
        fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
      }}
    >
      {node && typeInfo ? (
        <SelectedEntity
          node={node}
          typeColor={typeInfo.color}
          typeLabel={typeInfo.label}
          data={data}
          turn={turn}
          activeTypes={activeTypes}
          degree={degree}
          onSelectNode={onSelectNode}
          onClearSelection={onClearSelection}
          onJumpToTurn={onJumpToTurn}
        />
      ) : (
        <EmptyState data={data} degree={degree} onSelectNode={onSelectNode} />
      )}
    </div>
  );
};

export default OntologyDetailPanel;
