import { useMemo, useState } from 'react';
import {
  COLORS, GROUP_META, SEMANTIC, WINDOW,
} from '../../styles/theme';
import { squarify } from '../../utils/geometry';
import { fmt, fmtK } from '../../utils/format';
import type { ContextCategory, ToolAggregation } from '../../types/session';

// ─── Types ────────────────────────────────────────────────────────────────

interface Props {
  categories: ContextCategory[];
  tools: ToolAggregation[];
  peakTokens: number;
  peakIndex: number;
  turnIndex: number;
  reqStep: number;
  model: string;
  contextLimit: number;
  cacheHit: number;
  onClose: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function buildCategories(comp: Record<string, number>, peakTokens: number, cacheHit: number): ContextCategory[] {
  const CAT_META: Record<string, { label: string; group: ContextCategory['group'] }> = {
    sysPrompt: { label: '系统提示', group: 'core' },
    tools: { label: '工具定义', group: 'core' },
    skills: { label: '技能定义', group: 'core' },
    memory: { label: '记忆文件', group: 'core' },
    mcp: { label: 'MCP 配置', group: 'core' },
    reminders: { label: '周期提醒', group: 'core' },
    thinking: { label: '思考过程', group: 'io' },
    asstText: { label: '助手输出', group: 'io' },
    toolCalls: { label: '工具调用', group: 'io' },
    toolResults: { label: '工具结果', group: 'io' },
    userMsgs: { label: '用户消息', group: 'convo' },
    subagent: { label: '子代理', group: 'convo' },
  };
  const EST = new Set(['sysPrompt', 'tools']);
  const cats: ContextCategory[] = [];
  for (const [key, tokens] of Object.entries(comp)) {
    const meta = CAT_META[key] ?? { label: key, group: 'convo' as const };
    cats.push({ key, label: meta.label, group: meta.group, estimated: EST.has(key), tokens: Math.round(tokens), raw: 0 });
  }
  // Add cache hit as a category
  if (cacheHit > 0) {
    cats.push({ key: 'cacheHit', label: '缓存命中', group: 'io', estimated: false, tokens: cacheHit, raw: 0 });
  }
  cats.sort((a, b) => b.tokens - a.tokens);
  return cats;
}

// ─── Component ────────────────────────────────────────────────────────────

export default function PeakModal({
  categories,
  tools,
  peakTokens, peakIndex, turnIndex, reqStep,
  model, contextLimit, cacheHit, onClose,
}: Props) {
  const [hovered, setHovered] = useState<string | null>(null);

  const CATSUM = categories.reduce((a, c) => a + c.tokens, 0) || 1;
  const peakTokensFmt = fmt(peakTokens);
  const windowPctFmt = ((peakTokens / contextLimit) * 100).toFixed(0) + '%';
  const freeTokensFmt = fmt(Math.max(0, contextLimit - peakTokens));

  // Window bar segments
  const barSegments = categories.map(c => ({
    key: c.key, color: COLORS[c.key] ?? 'oklch(0.5 0 0)',
    pct: (c.tokens / contextLimit) * 100, title: `${c.label} — ${fmt(c.tokens)} tok`,
  }));
  const freePct = Math.max(0, ((contextLimit - peakTokens) / contextLimit) * 100);

  // Legend
  const legendRows = categories.map(c => ({
    key: c.key, label: c.label, color: COLORS[c.key] ?? 'oklch(0.5 0 0)',
    tokensFmt: fmt(c.tokens), pctFmt: ((c.tokens / CATSUM) * 100).toFixed(1) + '%',
    barPct: (c.tokens / (categories[0]?.tokens ?? 1)) * 100,
    estBadge: c.estimated ? '估算' : '',
  }));

  // Treemap
  const treeCells = useMemo(() => {
    const valid = categories.filter(c => c.tokens > 0);
    if (valid.length === 0) return [];
    const results = squarify(valid.map(c => ({ key: c.key, value: c.tokens, label: c.label })), 100, 100);
    return results.map(r => {
      const key = (r.item as any).key as string;
      const label = (r.item as any).label as string;
      const big = r.w > 16 && r.h > 16;
      const med = r.w > 9 && r.h > 11;
      const tiny = r.w < 6 || r.h < 6;
      return {
        key, label, color: COLORS[key] ?? 'oklch(0.5 0 0)',
        left: r.left, top: r.top, w: r.w, h: r.h,
        pctFmt: ((r.value / CATSUM) * 100).toFixed(1) + '%',
        labelSize: r.w > 30 ? 14 : big ? 12 : tiny ? 8 : 11,
        labelOp: med ? 1 : 0,
        valOp: r.w > 11 && r.h > 9 ? 1 : 0,
        innerPadV: tiny ? 1 : big ? 9 : 4,
        innerPadH: tiny ? 2 : big ? 10 : 5,
        op: 1,
      };
    });
  }, [categories, CATSUM]);

  // Groups
  const order = ['io', 'convo', 'core'] as const;
  const groups = order.map(gk => {
    const mem = categories.filter(c => c.group === gk).sort((a, b) => b.tokens - a.tokens);
    const gtot = mem.reduce((a, c) => a + c.tokens, 0);
    const gtotSafe = gtot || 1;
    let acc = 0;
    const stops = mem.map(c => {
      const a0 = (acc / gtotSafe) * 100;
      acc += c.tokens;
      return `${COLORS[c.key] ?? 'oklch(0.5 0 0)'} ${a0.toFixed(2)}% ${((acc / gtotSafe) * 100).toFixed(2)}%`;
    });
    const meta = GROUP_META[gk] ?? { label: gk, desc: '', accent: 'oklch(0.5 0 0)' };
    return {
      key: gk, label: meta.label, desc: meta.desc, accent: meta.accent,
      tokensFmt: fmt(gtot), pctFmt: ((gtot / CATSUM) * 100).toFixed(0) + '%',
      conic: stops.length ? `conic-gradient(${stops.join(',')})` : 'none',
      members: mem.map(c => ({ label: c.label, color: COLORS[c.key] ?? 'oklch(0.5 0 0)', pctFmt: ((c.tokens / CATSUM) * 100).toFixed(1) + '%' })),
    };
  });

  // Tool rows
  const maxRes = Math.max(...tools.map(t => t.resultTokens), 1);
  const toolRows = tools.map(t => ({
    name: t.name, calls: t.calls, resultFmt: fmt(t.resultTokens),
    barPct: (t.resultTokens / maxRes) * 100,
    color: t.task ? 'oklch(0.67 0.15 25)' : 'oklch(0.76 0.13 62)',
    taskTag: t.task ? ' · 子 Agent' : '',
  }));

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1100,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      background: 'oklch(0 0 0 / 0.55)', backdropFilter: 'blur(6px)',
      paddingTop: 40, paddingBottom: 40, overflowY: 'auto',
    }} onClick={onClose}>
      <div style={{
        width: 960, maxWidth: 'calc(100vw - 48px)',
        padding: '30px 34px 28px', borderRadius: 14,
        background: 'oklch(0.17 0.008 265)',
        border: `1px solid ${SEMANTIC.borderColor}`,
        boxShadow: '0 20px 60px oklch(0 0 0 / 0.5)',
      }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 22, borderBottom: `1px solid ${SEMANTIC.borderColor}`, paddingBottom: 16 }}>
          <div>
            <div style={{ fontSize: 11, color: SEMANTIC.textMuted, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 4 }}>
              第 {turnIndex} 轮 · 步骤 #{reqStep + 1} · 峰值请求
            </div>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>上下文消耗最大的一次请求</h2>
          </div>
          <div style={{ display: 'flex', gap: 10, fontFamily: "'IBM Plex Mono', monospace" }}>
            <div style={{ border: `1px solid ${SEMANTIC.borderColor}`, borderRadius: 8, padding: '8px 12px', background: 'oklch(0.20 0.01 265 / 0.6)' }}>
              <div style={{ fontSize: 9, color: SEMANTIC.textMuted }}>模型</div>
              <div style={{ fontSize: 12, color: SEMANTIC.textPrimary }}>{model}</div>
            </div>
            <div style={{ border: `1px solid ${SEMANTIC.borderColor}`, borderRadius: 8, padding: '8px 12px', background: 'oklch(0.20 0.01 265 / 0.6)' }}>
              <div style={{ fontSize: 9, color: SEMANTIC.textMuted }}>峰值输入</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'oklch(0.74 0.13 60)' }}>{peakTokensFmt}</div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: SEMANTIC.textMuted, fontSize: 22, cursor: 'pointer', padding: '0 0 0 8px', alignSelf: 'flex-start' }}>✕</button>
          </div>
        </div>

        {/* Window bar */}
        <div style={{ marginBottom: 22 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: SEMANTIC.textMuted }}>
            <span>{peakTokensFmt} / {fmtK(contextLimit)} 窗口 · 已用 {windowPctFmt}</span>
          </div>
          <div style={{ display: 'flex', width: '100%', height: 40, borderRadius: 8, overflow: 'hidden', border: `1px solid ${SEMANTIC.borderColor}`, background: 'oklch(0.19 0.01 265)' }}>
            {barSegments.map(s => (
              <div key={s.key} title={s.title} style={{ width: `${s.pct}%`, background: s.color, opacity: 0.9 }} />
            ))}
            <div style={{ width: `${freePct}%`, background: 'repeating-linear-gradient(135deg, oklch(0.24 0.01 265) 0 4px, oklch(0.20 0.01 265) 4px 8px)' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: SEMANTIC.textMuted }}>
            <span>0</span><span>窗口剩余 {freeTokensFmt}</span><span>{fmtK(contextLimit)}</span>
          </div>
        </div>

        {/* Treemap + Legend */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 1fr', gap: 16, marginBottom: 22 }}>
          <div style={{ border: `1px solid ${SEMANTIC.borderColor}`, borderRadius: 12, padding: '16px 16px 18px', background: SEMANTIC.cardBg }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>各模块 Token 占用</h3>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: SEMANTIC.textMuted }}>面积 = Token 数</span>
            </div>
            <div style={{ position: 'relative', width: '100%', height: 200, overflow: 'hidden', borderRadius: 8 }}>
              {treeCells.map(c => (
                <div key={c.key} style={{ position: 'absolute', left: `${c.left}%`, top: `${c.top}%`, width: `${c.w}%`, height: `${c.h}%`, padding: 1 }}>
                  <div style={{ width: '100%', height: '100%', borderRadius: 5, background: c.color, padding: `${c.innerPadV}px ${c.innerPadH}px`, overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                    <div style={{ fontSize: c.labelSize, fontWeight: 600, lineHeight: 1.15, color: 'oklch(0.16 0.02 265)', opacity: c.labelOp }}>{c.label}</div>
                    <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 600, color: 'oklch(0.16 0.02 265 / 0.85)', opacity: c.valOp }}>{c.pctFmt}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ border: `1px solid ${SEMANTIC.borderColor}`, borderRadius: 12, padding: '16px 18px', background: SEMANTIC.cardBg }}>
            <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 600 }}>模块明细</h3>
            {legendRows.map(r => (
              <div key={r.key} style={{ padding: '6px 0', borderBottom: `1px solid oklch(0.26 0.012 265 / 0.4)` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: r.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, flex: 1, color: SEMANTIC.textSecondary }}>{r.label}</span>
                  {r.estBadge && <span style={{ fontSize: 9, color: SEMANTIC.textMuted, border: `1px solid ${SEMANTIC.borderColor}`, borderRadius: 3, padding: '0 4px' }}>{r.estBadge}</span>}
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 600, color: SEMANTIC.textPrimary }}>{r.tokensFmt}</span>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: SEMANTIC.textMuted, width: 42, textAlign: 'right' }}>{r.pctFmt}</span>
                </div>
                <div style={{ height: 3, borderRadius: 2, background: 'oklch(0.26 0.01 265)', marginTop: 5, marginLeft: 18 }}>
                  <div style={{ height: '100%', width: `${r.barPct}%`, borderRadius: 2, background: r.color }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Groups */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 22 }}>
          {groups.map(g => (
            <div key={g.key} style={{ border: `1px solid ${SEMANTIC.borderColor}`, borderRadius: 12, padding: '16px 14px', background: SEMANTIC.cardBg, textAlign: 'center' }}>
              <div style={{ width: 64, height: 64, borderRadius: '50%', margin: '0 auto 10px', background: g.conic || g.accent, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ width: 44, height: 44, borderRadius: '50%', background: SEMANTIC.pageBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: SEMANTIC.textPrimary }}>{g.pctFmt}</span>
                </div>
              </div>
              <div style={{ fontWeight: 600, fontSize: 13, color: SEMANTIC.textPrimary }}>{g.label}</div>
              <div style={{ fontSize: 12, color: g.accent, fontWeight: 600, marginTop: 2 }}>{g.tokensFmt} tok</div>
              <div style={{ fontSize: 10, color: SEMANTIC.textMuted, marginTop: 2 }}>{g.desc}</div>
              <div style={{ marginTop: 8 }}>
                {g.members.map(m => (
                  <div key={m.label} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2, fontSize: 10, color: SEMANTIC.textMuted }}>
                    <span style={{ width: 7, height: 7, borderRadius: 1, background: m.color, flexShrink: 0 }} />
                    <span>{m.label}</span>
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", marginLeft: 'auto' }}>{m.pctFmt}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Tool drilldown */}
        {toolRows.length > 0 && (
          <div style={{ border: `1px solid ${SEMANTIC.borderColor}`, borderRadius: 12, padding: '16px 18px', background: SEMANTIC.cardBg }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600 }}>工具调用</h3>
            {toolRows.map(t => (
              <div key={t.name} style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 3 }}>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, fontWeight: 600, color: SEMANTIC.textPrimary, width: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.name}>{t.name}</span>
                  <span style={{ fontSize: 10, color: SEMANTIC.textMuted, flex: 1, textAlign: 'right' }}>
                    {t.calls} 次调用{t.taskTag} · {t.resultFmt} tok
                  </span>
                </div>
                <div style={{ height: 6, borderRadius: 3, background: 'oklch(0.24 0.01 265)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${t.barPct}%`, borderRadius: 3, background: t.color }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export { buildCategories };
