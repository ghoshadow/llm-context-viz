import { SEMANTIC } from '../../styles/theme';

export interface RelatedEntity {
  id: string;
  label: string;
  color: string;
  rel: string;
  dir: string;
}

export function EntityRelationsSection({
  related,
  onSelectNode,
}: {
  related: RelatedEntity[];
  onSelectNode: (id: string | null) => void;
}) {
  return (
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
  );
}
