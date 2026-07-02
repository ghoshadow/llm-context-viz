import { useMemo } from 'react';
import { COLORS, DELTA_LABELS, SEMANTIC } from '../../../styles/theme';
import { fmt } from '../../../utils/format';
import { CHARS_PER_TOKEN } from '../../../pipeline/utils';

interface DeltaPanelProps {
  delta: Record<string, number>;
}

const DELTA_KEYS_ORDER = ['toolResults', 'thinking', 'toolCalls', 'userMsgs', 'asstText', 'subagent'];

export function DeltaPanel({ delta }: DeltaPanelProps) {
  const rows = useMemo(() => {
    const dk = DELTA_KEYS_ORDER.filter((k) => (delta[k] ?? 0) > 0);
    const dmax = Math.max(1, ...dk.map((k) => delta[k]!));
    return dk.map((k) => ({
      key: k,
      label: DELTA_LABELS[k] ?? k,
      color: COLORS[k] ?? 'oklch(0.5 0 0)',
      tokensFmt: fmt(Math.round(delta[k]! * CHARS_PER_TOKEN)) + ' chars',
      barPct: Math.max(3, (delta[k]! / dmax) * 100),
    }));
  }, [delta]);

  return (
    <div className="panel" style={{ padding: '18px 20px' }}>
      <h2 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 600 }}>本轮新增内容</h2>
      <p style={{ margin: '0 0 14px', fontSize: 11.5, color: SEMANTIC.textDesc4, lineHeight: 1.5 }}>
        这一轮向上下文追加了什么
      </p>
      {rows.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          {rows.map((r) => (
            <div key={r.key}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                <span style={{ width: 9, height: 9, borderRadius: 2, background: r.color, flexShrink: 0 }} />
                <span style={{ fontSize: 12.5, flex: 1, color: SEMANTIC.textPrimary4 }}>{r.label}</span>
                <span
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 12,
                    fontWeight: 600,
                    color: SEMANTIC.textPrimary6,
                  }}
                >
                  +{r.tokensFmt}
                </span>
              </div>
              <div style={{ height: 6, borderRadius: 4, background: 'oklch(0.24 0.01 265)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${r.barPct}%`, borderRadius: 4, background: r.color }} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ marginTop: 14, fontSize: 12, color: SEMANTIC.textDesc3 }}>
          本轮未产生明显增量。
        </div>
      )}
    </div>
  );
}
