import { useEffect, useMemo, useState } from 'react';
import { useSessionStore } from '../../store/sessionStore';
import { useUIStore } from '../../store/uiStore';
import type { SessionListItem } from '../../types/session';
import { SEMANTIC } from '../../styles/theme';
import { fmtK, fmtDateOnly } from '../../utils/format';
import { getSessionSource, type SessionSource } from '../../utils/sessionSource';
import { getSessionProjectPathText } from './sessionProjectPath';
import { getSessionCardTitleDisplay, type SessionCardTitleDisplay } from './sessionTitle';

// ─── Styles (inline objects) ────────────────────────────────────────────

const s = {
  header: {
    textAlign: 'center' as const,
    marginBottom: 48,
    paddingTop: 20,
  },
  dot: {
    display: 'inline-block',
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: 'oklch(0.74 0.13 60)',
    marginRight: 8,
    verticalAlign: 'middle' as const,
    marginTop: -2,
  },
  badge: {
    display: 'inline-block',
    fontSize: 13,
    fontWeight: 500,
    color: 'oklch(0.70 0.012 265)',
    letterSpacing: '0.04em',
    textTransform: 'uppercase' as const,
    marginBottom: 16,
  },
  h1: {
    fontSize: 40,
    fontWeight: 700,
    letterSpacing: '-0.02em',
    color: 'oklch(0.93 0.006 265)',
    margin: '0 0 14px',
  },
  desc: {
    fontSize: 16,
    lineHeight: 1.6,
    color: 'oklch(0.64 0.012 265)',
    maxWidth: 540,
    margin: '0 auto 28px',
  },
  scanBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '10px 24px',
    fontSize: 15,
    fontWeight: 600,
    color: 'oklch(0.16 0.008 265)',
    background: 'oklch(0.74 0.13 60)',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    letterSpacing: '-0.01em',
    transition: 'background 0.15s',
  } as React.CSSProperties,

  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
    gap: 18,
    maxWidth: 1080,
    margin: '0 auto',
  },

  tabs: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 4,
    padding: 4,
    maxWidth: 1080,
    margin: '0 auto 18px',
    borderRadius: 8,
    background: 'oklch(0.15 0.008 265)',
    border: `1px solid ${SEMANTIC.borderColor}`,
  } as React.CSSProperties,

  tabBtn: {
    border: 'none',
    borderRadius: 6,
    padding: '8px 10px',
    background: 'transparent',
    color: SEMANTIC.textMuted,
    cursor: 'pointer',
    fontSize: 13,
    fontFamily: "'IBM Plex Mono', monospace",
  } as React.CSSProperties,

  tabBtnActive: {
    background: 'oklch(0.74 0.13 60 / 0.14)',
    color: SEMANTIC.textAccent2,
  } as React.CSSProperties,

  empty: {
    textAlign: 'center' as const,
    padding: '80px 20px',
    color: 'oklch(0.55 0.012 265)',
    fontSize: 15,
    gridColumn: '1 / -1',
  },

  footer: {
    textAlign: 'center' as const,
    marginTop: 60,
    paddingTop: 28,
    borderTop: `1px solid oklch(0.26 0.012 265 / 0.5)`,
    fontSize: 13,
    color: 'oklch(0.46 0.012 265)',
  },
};

// ─── SessionCard ────────────────────────────────────────────────────────

const cardS = {
  card: {
    background: SEMANTIC.cardBg,
    border: `1px solid ${SEMANTIC.borderColor}`,
    borderRadius: 10,
    padding: '20px 22px',
    cursor: 'pointer',
    transition: 'border-color 0.15s, background 0.15s',
    position: 'relative' as const,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 12,
  } as React.CSSProperties,

  cardHover: {
    borderColor: 'oklch(0.38 0.014 265)',
    background: 'oklch(0.185 0.009 265 / 0.82)',
  },

  model: {
    fontSize: 18,
    fontWeight: 600,
    color: 'oklch(0.93 0.006 265)',
    letterSpacing: '-0.01em',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },

  structuredTitle: {
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
    gap: 9,
  },

  structuredIcon: {
    width: 24,
    height: 24,
    borderRadius: 7,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 13,
    fontWeight: 700,
  } as React.CSSProperties,

  structuredIconCommand: {
    color: 'oklch(0.88 0.10 165)',
    background: 'oklch(0.38 0.10 165 / 0.22)',
    border: '1px solid oklch(0.42 0.10 165 / 0.30)',
  },

  structuredIconWarning: {
    color: 'oklch(0.85 0.13 80)',
    background: 'oklch(0.64 0.10 80 / 0.16)',
    border: '1px solid oklch(0.64 0.10 80 / 0.30)',
  },

  structuredIconPlugin: {
    color: 'oklch(0.82 0.09 285)',
    background: 'oklch(0.50 0.10 285 / 0.18)',
    border: '1px solid oklch(0.50 0.10 285 / 0.32)',
  },

  structuredTextWrap: {
    minWidth: 0,
    flex: 1,
  },

  structuredName: {
    display: 'block',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    fontSize: 16,
    fontWeight: 650,
    fontFamily: "'IBM Plex Mono', monospace",
  },

  structuredNameCommand: {
    color: 'oklch(0.86 0.09 165)',
  },

  structuredNameWarning: {
    color: 'oklch(0.86 0.10 80)',
  },

  structuredNamePlugin: {
    color: 'oklch(0.86 0.08 285)',
  },

  structuredDetail: {
    display: 'block',
    marginTop: 2,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    fontSize: 12,
    color: 'oklch(0.61 0.012 265)',
  },

  filename: {
    fontSize: 13,
    color: 'oklch(0.55 0.012 265)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    fontFamily: "'IBM Plex Mono', monospace",
  },

  projectPath: {
    fontSize: 12,
    color: 'oklch(0.62 0.012 265)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    fontFamily: "'IBM Plex Mono', monospace",
  },

  stats: {
    display: 'flex',
    gap: 20,
    flexWrap: 'wrap' as const,
  },

  statItem: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 3,
  },

  statLabel: {
    fontSize: 11,
    color: 'oklch(0.52 0.012 265)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  },

  statValue: {
    fontSize: 15,
    fontWeight: 600,
    color: 'oklch(0.86 0.01 265)',
  },

  peakValue: {
    color: 'oklch(0.74 0.13 60)',
    fontWeight: 700,
  },

  date: {
    fontSize: 12,
    color: 'oklch(0.50 0.012 265)',
    marginTop: 2,
  },

  deleteBtn: {
    position: 'absolute' as const,
    top: 14,
    right: 14,
    width: 28,
    height: 28,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: 'none',
    borderRadius: 6,
    color: 'oklch(0.46 0.012 265)',
    cursor: 'pointer',
    fontSize: 16,
    transition: 'color 0.15s, background 0.15s',
    lineHeight: 1,
    padding: 0,
  } as React.CSSProperties,

  deleteBtnHover: {
    color: 'oklch(0.67 0.18 25)',
    background: 'oklch(0.67 0.18 25 / 0.10)',
  },
};

function SessionCard({ session, onSelect, onDelete }: {
  session: SessionListItem;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const projectPath = getSessionProjectPathText(session);
  const titleDisplay = getSessionCardTitleDisplay(session.ai_title, session.model);
  const titleToneSuffix = titleDisplay.kind === 'structured'
    ? titleDisplay.tone === 'command'
      ? 'Command'
      : titleDisplay.tone === 'plugin'
        ? 'Plugin'
        : 'Warning'
    : null;

  return (
    <div
      style={cardS.card}
      onMouseEnter={(e) => {
        const el = e.currentTarget;
        el.style.borderColor = cardS.cardHover.borderColor;
        el.style.background = cardS.cardHover.background;
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget;
        el.style.borderColor = (cardS.card as React.CSSProperties).border as string ?? SEMANTIC.borderColor;
        el.style.background = SEMANTIC.cardBg as string;
      }}
      onClick={() => onSelect(session.id)}
    >
      {/* Delete button */}
      <button
        style={cardS.deleteBtn}
        title="删除会话"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(session.id);
        }}
        onMouseEnter={(e) => {
          Object.assign(e.currentTarget.style, cardS.deleteBtnHover);
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.color = cardS.deleteBtn.color as string;
          (e.currentTarget as HTMLElement).style.background = cardS.deleteBtn.background as string;
        }}
      >
        &#x2715;
      </button>

      {/* Title (ai-title) or model fallback */}
      {titleDisplay.kind === 'structured' ? (
        <StructuredSessionTitle title={titleDisplay} toneSuffix={titleToneSuffix!} />
      ) : (
        <div style={cardS.model}>{titleDisplay.text}</div>
      )}

      {/* Filename */}
      <div style={cardS.filename} title={session.filename}>
        {session.filename}
      </div>

      <div style={cardS.projectPath} title={projectPath}>
        项目目录 · {projectPath}
      </div>

      {/* Stats row */}
      <div style={cardS.stats}>
        <div style={cardS.statItem}>
          <span style={cardS.statLabel}>请求数</span>
          <span style={cardS.statValue}>{session.total_requests}</span>
        </div>
        <div style={cardS.statItem}>
          <span style={cardS.statLabel}>峰值 Tokens</span>
          <span style={{ ...cardS.statValue, ...cardS.peakValue }}>
            {fmtK(session.peak_tokens)}
          </span>
        </div>
        <div style={cardS.statItem}>
          <span style={cardS.statLabel}>轮次</span>
          <span style={cardS.statValue}>{session.turn_count}</span>
        </div>
      </div>

      {/* Created date */}
      <div style={cardS.date}>{fmtDateOnly(session.created_at)}</div>
    </div>
  );
}

function StructuredSessionTitle({
  title,
  toneSuffix,
}: {
  title: Extract<SessionCardTitleDisplay, { kind: 'structured' }>;
  toneSuffix: 'Command' | 'Plugin' | 'Warning';
}) {
  const iconStyle = cardS[`structuredIcon${toneSuffix}` as const];
  const nameStyle = cardS[`structuredName${toneSuffix}` as const];

  return (
    <div style={cardS.structuredTitle} title={title.tooltip}>
      <span style={{ ...cardS.structuredIcon, ...iconStyle }}>{title.icon}</span>
      <span style={cardS.structuredTextWrap}>
        <span style={{ ...cardS.structuredName, ...nameStyle }}>{title.label}</span>
        {title.detail && <span style={cardS.structuredDetail}>{title.detail}</span>}
      </span>
    </div>
  );
}

// ─── SessionList ────────────────────────────────────────────────────────

function SessionList({ sessions, activeSource, onSelect, onDelete }: {
  sessions: SessionListItem[];
  activeSource: SessionSource;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  if (sessions.length === 0) {
    return (
      <div style={s.grid}>
        <div style={s.empty}>
          {activeSource === 'codex' ? '暂无已导入 Codex 会话' : '暂无已导入 Claude Code 会话'}
        </div>
      </div>
    );
  }

  return (
    <div style={s.grid}>
      {sessions.map((session) => (
        <SessionCard
          key={session.id}
          session={session}
          onSelect={onSelect}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

// ─── HomePage ───────────────────────────────────────────────────────────

export default function HomePage() {
  const [activeSource, setActiveSource] = useState<SessionSource>('claude');
  const sessions = useSessionStore((st) => st.sessions);
  const sessionsLoading = useSessionStore((st) => st.sessionsLoading);
  const fetchSessions = useSessionStore((st) => st.fetchSessions);
  const selectSession = useSessionStore((st) => st.selectSession);
  const deleteSession = useSessionStore((st) => st.deleteSession);
  const openScanner = useSessionStore((st) => st.openScanner);
  const setPage = useUIStore((st) => st.setPage);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const claudeSessions = useMemo(
    () => sessions.filter((session) => getSessionSource(session) === 'claude'),
    [sessions],
  );
  const codexSessions = useMemo(
    () => sessions.filter((session) => getSessionSource(session) === 'codex'),
    [sessions],
  );
  const visibleSessions = activeSource === 'codex' ? codexSessions : claudeSessions;

  const handleSelect = async (id: string) => {
    await selectSession(id);
    setPage('inspector');
  };

  const handleDelete = (id: string) => {
    if (window.confirm('确定要删除这个会话吗？此操作不可撤销。')) {
      deleteSession(id);
    }
  };

  return (
    <div>
      {/* Header */}
      <header style={s.header}>
        <div style={s.badge}>
          <span style={s.dot} />
          LLM Context Visualizer
        </div>
        <h1 style={s.h1}>LLM 上下文可视化</h1>
        <p style={s.desc}>
          扫描本地 Claude Code 与 Codex 会话 JSONL 文件，查看上下文窗口增长、分类 Token 构成，
          并逐轮检查推理与工具调用细节。
        </p>
        <button
          style={s.scanBtn}
          onClick={openScanner}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'oklch(0.78 0.14 60)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'oklch(0.74 0.13 60)';
          }}
        >
          扫描本地
        </button>
      </header>

      {/* Session list */}
      {sessionsLoading ? (
        <div style={{ ...s.grid, textAlign: 'center' }}>
          <div style={s.empty}>加载中...</div>
        </div>
      ) : (
        <>
          {sessions.length > 0 && (
            <div style={s.tabs} role="tablist" aria-label="已导入会话来源">
              {([
                ['claude', `Claude Code (${claudeSessions.length})`],
                ['codex', `Codex (${codexSessions.length})`],
              ] as const).map(([source, label]) => {
                const active = activeSource === source;
                return (
                  <button
                    key={source}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    style={{ ...s.tabBtn, ...(active ? s.tabBtnActive : {}) }}
                    onClick={() => setActiveSource(source)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}
          <SessionList
            sessions={visibleSessions}
            activeSource={activeSource}
            onSelect={handleSelect}
            onDelete={handleDelete}
          />
        </>
      )}

      {/* Footer */}
      <footer style={s.footer}>
        LLM Context Visualizer v1.0.0
      </footer>
    </div>
  );
}
