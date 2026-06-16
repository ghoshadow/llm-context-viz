import { useMemo } from 'react';
import { SEMANTIC } from '../../styles/theme';

// ============================================================================
// Types
// ============================================================================

export interface ToolUsagePanelProps {
  /** Tool name → call count. Null means no data loaded yet. */
  tools: Record<string, number> | null;
}

interface ToolRow {
  name: string;
  calls: number;
  barPct: number;
  color: string;
  tag: string;
}

// ============================================================================
// Constants
// ============================================================================

const AMBER = 'oklch(0.76 0.13 62)';
const ORANGE = 'oklch(0.67 0.15 25)';

/** Tools that spawn sub-agents (Task tools). */
const TASK_PATTERNS = [
  'TaskCreate',
  'TaskUpdate',
  'TaskList',
  'TaskGet',
  'TaskStop',
  'Task',
];

function isTaskTool(name: string): boolean {
  return TASK_PATTERNS.some((p) => name === p || name.startsWith(p + '_'));
}

// ============================================================================
// Component
// ============================================================================

export default function ToolUsagePanel({ tools }: ToolUsagePanelProps) {
  const { totalCalls, toolRows } = useMemo(() => {
    if (!tools) return { totalCalls: 0, toolRows: [] };

    const entries = Object.entries(tools)
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1]);

    const total = entries.reduce((sum, [, c]) => sum + c, 0);
    const maxCalls = entries[0]?.[1] ?? 1;

    const rows: ToolRow[] = entries.map(([name, calls]) => ({
      name,
      calls,
      barPct: (calls / maxCalls) * 100,
      color: isTaskTool(name) ? ORANGE : AMBER,
      tag: isTaskTool(name) ? ' · 子Agent' : '',
    }));

    return { totalCalls: total, toolRows: rows };
  }, [tools]);

  // ── No tools ──────────────────────────────────────────────────────────

  if (!tools || toolRows.length === 0) {
    return (
      <div
        style={{
          border: `1px solid ${SEMANTIC.borderColor}`,
          borderRadius: 16,
          padding: '18px 20px',
          background: SEMANTIC.cardBg,
        }}
      >
        <h2
          style={{
            margin: '0 0 4px',
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          本轮调用的工具
        </h2>
        <div
          style={{
            marginTop: 14,
            fontSize: 12,
            color: SEMANTIC.textDesc3,
            opacity: 0.5,
          }}
        >
          本轮为纯对话，未调用任何工具
        </div>
      </div>
    );
  }

  // ── Has tools ─────────────────────────────────────────────────────────

  return (
    <div
      style={{
        border: `1px solid ${SEMANTIC.borderColor}`,
        borderRadius: 16,
        padding: '18px 20px',
        background: SEMANTIC.cardBg,
      }}
    >
      <h2 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 600 }}>
        本轮调用的工具
      </h2>
      <p
        style={{
          margin: '0 0 14px',
          fontSize: 11.5,
          color: SEMANTIC.textDesc4,
          lineHeight: 1.5,
        }}
      >
        共 {totalCalls} 次调用
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {toolRows.map((t) => (
          <div
            key={t.name}
            style={{ display: 'flex', alignItems: 'center', gap: 9 }}
          >
            {/* Color swatch */}
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                background: t.color,
                flexShrink: 0,
              }}
            />

            {/* Tool name */}
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 12.5,
                fontWeight: 500,
                color: SEMANTIC.textPrimary6,
                flex: 1,
              }}
            >
              {t.name}
              {t.tag}
            </span>

            {/* Proportional bar */}
            <div
              style={{
                width: 90,
                height: 7,
                borderRadius: 4,
                background: SEMANTIC.barBg,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${t.barPct}%`,
                  borderRadius: 4,
                  background: t.color,
                }}
              />
            </div>

            {/* Call count */}
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 12,
                fontWeight: 600,
                color: SEMANTIC.textPrimary5,
                width: 26,
                textAlign: 'right',
              }}
            >
              {t.calls}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
