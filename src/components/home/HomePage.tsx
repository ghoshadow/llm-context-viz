import { useEffect } from 'react';
import { useSessionStore } from '../../store/sessionStore';
import { useUIStore } from '../../store/uiStore';
import type { SessionListItem } from '../../types/session';
import { SEMANTIC } from '../../styles/theme';

// ─── Helper: format peak tokens ─────────────────────────────────────────

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    return iso.slice(0, 10);
  }
}

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
  uploadBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
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

  scanBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '10px 20px',
    fontSize: 14,
    fontWeight: 500,
    color: SEMANTIC.textAccent2,
    background: 'oklch(0.74 0.13 60 / 0.12)',
    border: `1px solid oklch(0.50 0.10 60 / 0.4)`,
    borderRadius: 8,
    cursor: 'pointer',
    transition: 'background 0.15s',
  } as React.CSSProperties,

  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
    gap: 18,
    maxWidth: 1080,
    margin: '0 auto',
  },

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
  },

  filename: {
    fontSize: 13,
    color: 'oklch(0.55 0.012 265)',
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
      <div style={cardS.model}>{session.ai_title || session.model || 'unknown'}</div>

      {/* Filename */}
      <div style={cardS.filename} title={session.filename}>
        {session.filename}
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
            {fmtTokens(session.peak_tokens)}
          </span>
        </div>
        <div style={cardS.statItem}>
          <span style={cardS.statLabel}>轮次</span>
          <span style={cardS.statValue}>{session.turn_count}</span>
        </div>
      </div>

      {/* Created date */}
      <div style={cardS.date}>{fmtDate(session.created_at)}</div>
    </div>
  );
}

// ─── SessionList ────────────────────────────────────────────────────────

function SessionList({ sessions, onSelect, onDelete }: {
  sessions: SessionListItem[];
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  if (sessions.length === 0) {
    return (
      <div style={s.grid}>
        <div style={s.empty}>
          暂无会话，上传一个 JSONL 文件开始分析
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
  const sessions = useSessionStore((st) => st.sessions);
  const sessionsLoading = useSessionStore((st) => st.sessionsLoading);
  const fetchSessions = useSessionStore((st) => st.fetchSessions);
  const selectSession = useSessionStore((st) => st.selectSession);
  const deleteSession = useSessionStore((st) => st.deleteSession);
  const openUpload = useSessionStore((st) => st.openUpload);
  const openScanner = useSessionStore((st) => st.openScanner);
  const setPage = useUIStore((st) => st.setPage);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const handleSelect = async (id: string) => {
    await selectSession(id);
    setPage('assembly');
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
          上传 Claude Code 会话 JSONL 文件，查看上下文窗口增长、分类 Token 构成，
          并逐轮检查推理与工具调用细节。
        </p>
        <button
          style={s.uploadBtn}
          onClick={openUpload}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'oklch(0.78 0.14 60)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'oklch(0.74 0.13 60)';
          }}
        >
          上传新会话
        </button>
        <button
          style={s.scanBtn}
          onClick={openScanner}
        >
          📂 扫描本地
        </button>
      </header>

      {/* Session list */}
      {sessionsLoading ? (
        <div style={{ ...s.grid, textAlign: 'center' }}>
          <div style={s.empty}>加载中...</div>
        </div>
      ) : (
        <SessionList
          sessions={sessions}
          onSelect={handleSelect}
          onDelete={handleDelete}
        />
      )}

      {/* Footer */}
      <footer style={s.footer}>
        LLM Context Visualizer v1.0.0
      </footer>
    </div>
  );
}
