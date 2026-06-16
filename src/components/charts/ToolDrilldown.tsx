import { SEMANTIC } from '../../styles/theme';

// ============================================================================
// ToolDrilldown — Tool I/O drilldown with horizontal bar chart
// Ported from prototype Context Assembly.dc.html lines 155–198
// ============================================================================

export interface ToolDrilldownTool {
  name: string;
  calls: number;
  resultTokens: number;
  task: boolean;
  barPct: number;
  color: string;
}

export interface ToolDrilldownProps {
  tools: ToolDrilldownTool[];
  subAgentPctFmt: string;
  subAgentTokFmt: string;
}

// ─── Amber (task) vs orange (non-task) ─────────────────────────────────

const TASK_COLOR = 'oklch(0.76 0.13 62)';   // amber — matches toolResults
const OTHER_COLOR = 'oklch(0.67 0.15 25)';  // orange — matches subagent

// ─── Styles ────────────────────────────────────────────────────────────

const s = {
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 22,
    alignItems: 'start',
    marginTop: 30,
  } as React.CSSProperties,

  panel: {
    border: `1px solid ${SEMANTIC.borderColor}`,
    borderRadius: 16,
    padding: '20px 22px',
    background: SEMANTIC.cardBg,
  } as React.CSSProperties,

  title: {
    margin: 0,
    fontSize: 15,
    fontWeight: 600,
    whiteSpace: 'nowrap',
    color: SEMANTIC.textPrimary,
  } as React.CSSProperties,

  titleBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 4,
  } as React.CSSProperties,

  subtitle: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10.5,
    color: SEMANTIC.textMuted3,
    flexShrink: 0,
    textAlign: 'right',
    paddingTop: 3,
  } as React.CSSProperties,

  desc: {
    margin: '4px 0 16px',
    fontSize: 12.5,
    color: SEMANTIC.textMuted3,
    lineHeight: 1.6,
  } as React.CSSProperties,

  toolList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 13,
  } as React.CSSProperties,

  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 9,
    marginBottom: 5,
  } as React.CSSProperties,

  toolName: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12.5,
    fontWeight: 600,
    color: SEMANTIC.textPrimary3,
    width: 96,
  } as React.CSSProperties,

  callCount: {
    fontSize: 11,
    color: SEMANTIC.textMuted2,
    flex: 1,
  } as React.CSSProperties,

  resultFmt: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    fontWeight: 600,
    color: SEMANTIC.textPrimary5,
  } as React.CSSProperties,

  barTrack: {
    height: 9,
    borderRadius: 5,
    background: SEMANTIC.barBg,
    overflow: 'hidden',
  } as React.CSSProperties,

  barFill: (barPct: number, color: string): React.CSSProperties => ({
    height: '100%',
    width: `${barPct}%`,
    borderRadius: 5,
    background: color,
  }),

  // ─── Right panel ─────────────────────────────────────────────────────

  rightPanel: {
    border: `1px solid ${SEMANTIC.borderColor}`,
    borderRadius: 16,
    padding: 22,
    background: SEMANTIC.cardBg,
    display: 'flex',
    flexDirection: 'column',
  } as React.CSSProperties,

  rightTitle: {
    margin: '0 0 4px',
    fontSize: 15,
    fontWeight: 600,
    color: SEMANTIC.textPrimary,
  } as React.CSSProperties,

  rightDesc: {
    margin: '4px 0 18px',
    fontSize: 12.5,
    color: SEMANTIC.textMuted3,
    lineHeight: 1.6,
  } as React.CSSProperties,

  statRow: {
    display: 'flex',
    gap: 14,
    flexWrap: 'wrap',
  } as React.CSSProperties,

  statCard: {
    flex: 1,
    minWidth: 120,
    border: `1px solid ${SEMANTIC.borderColor}`,
    borderRadius: 12,
    padding: 15,
    background: SEMANTIC.innerCardBg,
  } as React.CSSProperties,

  statValue: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 24,
    fontWeight: 600,
  } as React.CSSProperties,

  statValueSub: (color: string): React.CSSProperties => ({
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 24,
    fontWeight: 600,
    color,
  }),

  statLabel: {
    fontSize: 11.5,
    color: SEMANTIC.textMuted3,
    marginTop: 4,
  } as React.CSSProperties,

  detailSection: {
    marginTop: 16,
    borderTop: `1px solid ${SEMANTIC.borderSubtle}`,
    paddingTop: 14,
    fontSize: 12,
    color: SEMANTIC.textDesc,
    lineHeight: 1.6,
  } as React.CSSProperties,

  detailRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 14,
    whiteSpace: 'nowrap',
    marginTop: 6,
  } as React.CSSProperties,

  detailRowFirst: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 14,
    whiteSpace: 'nowrap',
  } as React.CSSProperties,

  detailValue: {
    fontFamily: "'IBM Plex Mono', monospace",
    color: SEMANTIC.textPrimary5,
  } as React.CSSProperties,

  detailValueGreen: {
    fontFamily: "'IBM Plex Mono', monospace",
    color: SEMANTIC.textGreen2,
  } as React.CSSProperties,
};

// ─── Helpers ───────────────────────────────────────────────────────────

/** Format token count as compact shorthand (e.g. "123K", "1.2K"). */
function fmtK(n: number): string {
  if (n >= 100000) return Math.round(n / 1000) + 'K';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(Math.round(n));
}

// ============================================================================
// Component
// ============================================================================

export default function ToolDrilldown({
  tools,
  subAgentPctFmt,
  subAgentTokFmt,
}: ToolDrilldownProps) {
  return (
    <section style={s.grid}>
      {/* ── Left: Tool result drilldown ── */}
      <div style={s.panel}>
        <div style={s.titleBar}>
          <h2 style={s.title}>深入"工具结果"</h2>
          <span style={s.subtitle}>单一最大模块</span>
        </div>
        <p style={s.desc}>
          每次工具调用回传的输出。其中{' '}
          <strong style={{ color: SEMANTIC.textPrimary2, fontWeight: 600 }}>Read</strong>
          （文件内容）单项就超过了整个占用的一半。
        </p>
        <div style={s.toolList}>
          {tools.map((t) => (
            <div key={t.name}>
              <div style={s.row}>
                <span style={s.toolName}>{t.name}</span>
                <span style={s.callCount}>
                  × {t.calls} 次调用
                </span>
                <span style={s.resultFmt}>{fmtK(t.resultTokens)}</span>
              </div>
              <div style={s.barTrack}>
                <div style={s.barFill(t.barPct, t.task ? TASK_COLOR : OTHER_COLOR)} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Right: Sub-agent (Task) callout ── */}
      <div style={s.rightPanel}>
        <h2 style={s.rightTitle}>子 Agent（Task）</h2>
        <p style={s.rightDesc}>
          被生成的工作者运行在自己独立的上下文窗口中。只有它们
          <em style={{ color: SEMANTIC.textPrimary2 }}>提炼后的输出</em>
          会返回给主 Agent —— 这就是为什么它们虽然干了重活，在这里却占用极小。
        </p>
        <div style={s.statRow}>
          <div style={s.statCard}>
            <div style={s.statValueSub('oklch(0.67 0.15 25)')}>{subAgentPctFmt}</div>
            <div style={s.statLabel}>占本次请求</div>
          </div>
          <div style={s.statCard}>
            <div style={s.statValue}>{subAgentTokFmt}</div>
            <div style={s.statLabel}>注入的 Token</div>
          </div>
        </div>
        <div style={s.detailSection}>
          <div style={s.detailRowFirst}>
            <span>创建的工作者</span>
            <span style={s.detailValue}>2</span>
          </div>
          <div style={s.detailRow}>
            <span>拉取的输出摘要</span>
            <span style={s.detailValue}>3</span>
          </div>
          <div style={s.detailRow}>
            <span>相比内联的压缩</span>
            <span style={s.detailValueGreen}>高</span>
          </div>
        </div>
      </div>
    </section>
  );
}
