import { SEMANTIC } from '../../styles/theme';
import type { ContextAssemblyData } from './contextAssemblyData';

export function ContextAssemblyHeader({
  derived,
  embedded,
  isCum,
  setPage,
}: {
  derived: ContextAssemblyData;
  embedded?: boolean;
  isCum: boolean;
  setPage: (page: 'home' | 'ontology' | 'inspector') => void;
}) {
  return (
    <header
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        gap: 24,
        borderBottom: `1px solid ${SEMANTIC.borderColor}`,
        paddingBottom: 22,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ maxWidth: 680 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 12,
          }}
        >
          <div
            style={{
              width: 9,
              height: 9,
              borderRadius: 2,
              background: 'oklch(0.74 0.13 60)',
              boxShadow: '0 0 12px oklch(0.74 0.13 60 / 0.7)',
            }}
          />
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: SEMANTIC.textDesc6,
            }}
          >
            {isCum ? '累计拼装上下文透视' : '上下文峰值透视'}
          </span>
        </div>
        <h1
          style={{
            margin: 0,
            fontSize: 30,
            fontWeight: 600,
            lineHeight: 1.12,
            letterSpacing: '-0.025em',
          }}
        >
          {isCum ? '累计拼装上下文全貌' : '上下文消耗最大的一次请求'}
        </h1>
        <p
          style={{
            margin: '12px 0 0',
            fontSize: 14.5,
            lineHeight: 1.7,
            color: SEMANTIC.textDesc7,
            maxWidth: 600,
          }}
        >
          {isCum
            ? '从会话开始到本轮结束，上下文窗口中累计拼装的全部内容。随着对话推进，历史内容通过缓存复用，实际计费远低于拼装总量。'
            : <>每一轮对话都会把整个已拼装的上下文重新发送给模型。这里把全会话中<strong style={{ color: SEMANTIC.textPrimary4, fontWeight: 600 }}>最重的一次请求</strong>拆解成各个组成模块 —— 看清输入 Token 究竟花在了哪里。</>}
        </p>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 10,
          fontFamily: "'IBM Plex Mono', monospace",
          flexWrap: 'wrap',
          alignItems: 'stretch',
        }}
      >
        {!embedded && (
          <a
            href="#"
            onClick={(e) => { e.preventDefault(); setPage('home'); }}
            style={{
              textDecoration: 'none', display: 'flex', alignItems: 'center',
              border: `1px solid ${SEMANTIC.borderColor}`, borderRadius: 10,
              padding: '11px 15px', background: SEMANTIC.innerCardBg,
              color: SEMANTIC.textSecondary, fontSize: 12.5, height: 'fit-content',
            }}
          >← 首页</a>
        )}
        {!embedded && (
          <a
            href="#"
            onClick={(e) => { e.preventDefault(); setPage('ontology'); }}
            style={{
              textDecoration: 'none', display: 'flex', alignItems: 'center',
              border: `1px solid ${SEMANTIC.borderColor}`, borderRadius: 10,
              padding: '11px 15px', background: SEMANTIC.innerCardBg,
              color: SEMANTIC.textSecondary, fontSize: 12.5, height: 'fit-content',
            }}
          >本体建模</a>
        )}
        {!embedded && (
          <a
            href="#"
            onClick={(e) => { e.preventDefault(); setPage('inspector'); }}
            style={{
              textDecoration: 'none', display: 'flex', alignItems: 'center',
              border: `1px solid ${SEMANTIC.borderAccent}`, borderRadius: 10,
              padding: '11px 15px', background: 'oklch(0.74 0.13 60 / 0.12)',
              color: SEMANTIC.textAccent2, fontSize: 12.5, height: 'fit-content',
            }}
          >逐轮检查 →</a>
        )}

        <HeaderBadge label="模型" value={derived.model} />
        <HeaderBadge label="请求数" value={derived.requestsFmt} />
        <HeaderBadge
          label={isCum ? '累计拼装' : '峰值输入'}
          value={derived.peakTokensFmt}
          accent
        />
      </div>
    </header>
  );
}

export function ContextAssemblyHeroBar({
  derived,
  isCum,
}: {
  derived: ContextAssemblyData;
  isCum: boolean;
}) {
  return (
    <section style={{ marginTop: 30 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 14,
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 12,
              color: SEMANTIC.textDesc2,
            }}
          >
            {isCum ? `第 ${derived.peakTurnIdx + 1} 轮 · 累计拼装上下文` : `第 ${derived.peakTurnIdx} 轮 · 步骤 #${derived.peakStep + 1} · 当前轮次峰值输入`}
          </span>
        </div>
        <div
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 12.5,
            color: SEMANTIC.textDesc,
          }}
        >
          <span
            style={{
              color: SEMANTIC.textPrimary2,
              fontWeight: 600,
            }}
          >
            {derived.peakTokensFmt}
          </span>{' '}
          / {derived.contextLimitFmt} 窗口 ·{' '}
          <span style={{ color: SEMANTIC.textAccent }}>
            已用 {derived.windowPctFmt}
          </span>
        </div>
      </div>

      <div
        onMouseLeave={derived.clearHover}
        style={{
          display: 'flex',
          width: '100%',
          height: 74,
          borderRadius: 12,
          overflow: 'hidden',
          border: `1px solid ${SEMANTIC.borderBarBg}`,
          background: 'oklch(0.19 0.01 265)',
          boxShadow: SEMANTIC.barInsetBoxShadow,
        }}
      >
        {derived.barSegments.map((seg) => (
          <div
            key={seg.key}
            onMouseEnter={seg.onEnter}
            title={seg.title}
            style={{
              width: `${seg.pct}%`,
              background: seg.color,
              opacity: seg.op,
              transition: 'opacity .18s ease',
              cursor: 'default',
              position: 'relative',
              borderRight: `1px solid ${SEMANTIC.barSeparator}`,
            }}
          />
        ))}
        <div
          style={{
            width: `${derived.freePct}%`,
            background: SEMANTIC.freeStripes,
          }}
        />
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: 7,
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 10.5,
          color: SEMANTIC.textMuted3,
        }}
      >
        <span>0</span>
        <span>窗口剩余 {derived.freeTokensFmt}</span>
        <span>{derived.contextLimitFmt}</span>
      </div>
    </section>
  );
}

function HeaderBadge({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        border: `1px solid ${SEMANTIC.borderColor}`,
        borderRadius: 10,
        padding: '11px 15px',
        background: 'oklch(0.20 0.01 265 / 0.6)',
      }}
    >
      <div
        style={{
          fontSize: 10,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: SEMANTIC.textMiniLabel,
          marginBottom: 5,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 13.5,
          fontWeight: 500,
          color: accent ? SEMANTIC.textAccent : SEMANTIC.textPrimary3,
        }}
      >
        {value}
      </div>
    </div>
  );
}
