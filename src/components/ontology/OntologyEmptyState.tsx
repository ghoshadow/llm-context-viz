import { SEMANTIC } from '../../styles/theme';
import type { OntologyData } from '../../types/ontology';
import { sortOntologyTypes } from './typeOrder';

// ─── Empty State ────────────────────────────────────────────────────────────

export function OntologyEmptyState({
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
