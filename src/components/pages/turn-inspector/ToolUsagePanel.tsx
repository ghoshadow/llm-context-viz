import { useMemo } from 'react';
import { SEMANTIC, STEP_COLORS } from '../../../styles/theme';
import { isTaskName } from '../turnInspectorLogic';

interface ToolUsagePanelProps {
  tools: Record<string, number>;
}

export function ToolUsagePanel({ tools }: ToolUsagePanelProps) {
  const rows = useMemo(() => {
    const tk = Object.keys(tools).sort((a, b) => tools[b]! - tools[a]!);
    const tmax = Math.max(1, ...tk.map((k) => tools[k]!));
    return tk.map((k) => ({
      name: k,
      calls: tools[k]!,
      barPct: Math.max(4, (tools[k]! / tmax) * 100),
      color: isTaskName(k) ? STEP_COLORS.subagent : STEP_COLORS.tool,
      tag: isTaskName(k) ? ' · 子Agent' : '',
    }));
  }, [tools]);

  const total = rows.reduce((a, r) => a + r.calls, 0);

  return (
    <div className="panel" style={{ padding: '18px 20px' }}>
      <h2 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 600 }}>本轮调用的工具</h2>
      <p style={{ margin: '0 0 14px', fontSize: 11.5, color: SEMANTIC.textDesc4, lineHeight: 1.5 }}>
        共 {total} 次调用
      </p>
      {rows.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {rows.map((r) => (
            <div key={r.name} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: r.color, flexShrink: 0 }} />
              <span
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 12.5,
                  fontWeight: 500,
                  color: SEMANTIC.textPrimary5,
                  flex: 1,
                }}
              >
                {r.name}{r.tag}
              </span>
              <div style={{ width: 90, height: 7, borderRadius: 4, background: 'oklch(0.24 0.01 265)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${r.barPct}%`, borderRadius: 4, background: r.color }} />
              </div>
              <span
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 12,
                  fontWeight: 600,
                  color: SEMANTIC.textPrimary6,
                  width: 26,
                  textAlign: 'right',
                }}
              >
                {r.calls}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ marginTop: 14, fontSize: 12, color: SEMANTIC.textDesc3 }}>
          本轮为纯对话，未调用任何工具。
        </div>
      )}
    </div>
  );
}
