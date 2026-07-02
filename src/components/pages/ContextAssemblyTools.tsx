import { SEMANTIC } from '../../styles/theme';
import type { ToolAggregation } from '../../types/session';
import type { ContextAssemblyData } from './contextAssemblyData';

export function ContextAssemblyTools({
  derived,
  tools,
}: {
  derived: ContextAssemblyData;
  tools: ToolAggregation[];
}) {
  return (
    <section
      style={{
        marginTop: 30,
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 22,
        alignItems: 'start',
      }}
    >
      <div
        style={{
          border: `1px solid ${SEMANTIC.borderColor}`,
          borderRadius: 16,
          padding: '20px 22px',
          background: SEMANTIC.cardBg,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 12,
            marginBottom: 4,
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: 15,
              fontWeight: 600,
              whiteSpace: 'nowrap',
            }}
          >
            深入"工具结果"
          </h2>
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 10.5,
              color: SEMANTIC.textDesc5,
              flexShrink: 0,
              textAlign: 'right',
              paddingTop: 3,
            }}
          >
            单一最大模块
          </span>
        </div>
        <p
          style={{
            margin: '4px 0 16px',
            fontSize: 12.5,
            color: SEMANTIC.textDesc3,
            lineHeight: 1.6,
          }}
        >
          截至本轮/本步，已累计回传的所有工具输出。即使当前步骤本身不调用工具，前面步骤的工具结果仍然留在上下文中。
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
          {derived.toolRows.map((t) => (
            <div key={t.name}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  marginBottom: 5,
                }}
              >
                <span
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: SEMANTIC.textPrimary3,
                    width: 420,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={t.name}
                >
                  {t.name}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: SEMANTIC.textMuted,
                    flex: 1,
                    textAlign: 'right',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {t.calls} 次调用{t.taskTag}
                  {' · '}
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, color: SEMANTIC.textPrimary5 }}>
                    {t.resultFmt}
                  </span>
                </span>
              </div>
              <div
                style={{
                  height: 9,
                  borderRadius: 5,
                  background: 'oklch(0.24 0.01 265)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${t.barPct}%`,
                    borderRadius: 5,
                    background: t.color,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div
        style={{
          border: `1px solid ${SEMANTIC.borderColor}`,
          borderRadius: 16,
          padding: 22,
          background: SEMANTIC.cardBg,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <h2
          style={{
            margin: '0 0 4px',
            fontSize: 15,
            fontWeight: 600,
          }}
        >
          子 Agent（Task）
          <span className="estimate-badge">估算</span>
        </h2>
        <p
          style={{
            margin: '4px 0 18px',
            fontSize: 12.5,
            color: SEMANTIC.textDesc3,
            lineHeight: 1.6,
          }}
        >
          被生成的工作者运行在自己独立的上下文窗口中。只有它们
          <em style={{ color: SEMANTIC.textPrimary7 }}>
            提炼后的输出
          </em>
          会返回给主 Agent —— 这就是为什么它们虽然干了重活,在这里却占用极小。
        </p>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <SubAgentStat
            color="oklch(0.67 0.15 25)"
            label="占本次请求"
            value={derived.subAgentPctFmt}
          />
          <SubAgentStat
            color={SEMANTIC.textPrimary3 ?? 'oklch(0.90 0.01 265)'}
            label="注入的 Token"
            value={derived.subAgentTokFmt}
          />
        </div>
        <div
          style={{
            marginTop: 16,
            borderTop: `1px solid ${SEMANTIC.borderSubtle2}`,
            paddingTop: 14,
            fontSize: 12,
            color: SEMANTIC.textDesc,
            lineHeight: 1.6,
          }}
        >
          <SubAgentMetric label="创建的工作者" value={tools.filter((t) => t.task).length} />
          <SubAgentMetric
            label="拉取的输出摘要"
            value={tools
              .filter((t) => t.task)
              .reduce((sum, t) => sum + t.calls, 0)}
            spaced
          />
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 14,
              whiteSpace: 'nowrap',
              marginTop: 6,
            }}
          >
            <span>相比内联的压缩</span>
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                color: SEMANTIC.textGreen2,
              }}
            >
              高
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

function SubAgentStat({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: string;
}) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 120,
        border: `1px solid ${SEMANTIC.borderColor}`,
        borderRadius: 12,
        padding: 15,
        background: 'oklch(0.20 0.01 265 / 0.5)',
      }}
    >
      <div
        style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 24,
          fontWeight: 600,
          color,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 11.5,
          color: SEMANTIC.textDesc3,
          marginTop: 4,
        }}
      >
        {label}
      </div>
    </div>
  );
}

function SubAgentMetric({
  label,
  spaced,
  value,
}: {
  label: string;
  spaced?: boolean;
  value: number;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 14,
        whiteSpace: 'nowrap',
        marginTop: spaced ? 6 : undefined,
      }}
    >
      <span>{label}</span>
      <span
        style={{
          fontFamily: "'IBM Plex Mono', monospace",
          color: SEMANTIC.textPrimary5,
        }}
      >
        {value}
      </span>
    </div>
  );
}
