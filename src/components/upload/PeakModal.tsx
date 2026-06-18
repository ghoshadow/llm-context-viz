import type { ContextCategory, ToolAggregation, SeriesPoint } from '../../types/session';
import ContextAssembly from '../pages/ContextAssembly';
import { fmt, fmtK } from '../../utils/format';
import { SEMANTIC } from '../../styles/theme';

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
  fullCtx: number;
  asstReqs: number;
  series?: SeriesPoint[];
  mode?: 'peak' | 'cumulative';
  onClose: () => void;
}

export default function PeakModal({
  categories, tools, peakTokens, peakIndex, turnIndex, reqStep,
  model, contextLimit, cacheHit, fullCtx, asstReqs, series, mode, onClose,
}: Props) {
  const isCum = mode === 'cumulative';
  const peakData = {
    session: {
      model,
      version: '',
      cwd: '',
      total_requests: asstReqs,
      peak_index: turnIndex,
      peak_tokens: peakTokens,
      context_limit: contextLimit,
      total_output: 0,
      peak_step: reqStep,
      peak_turn_idx: turnIndex,
    },
    categories,
    tools,
    series: series ?? [],
  };

  const sub = `第 ${turnIndex} 轮 · 完整输入 ${fmt(fullCtx)} tok · 计费 ${fmt(peakTokens)} tok${cacheHit > 0 ? ` · 缓存 ${fmt(cacheHit)}（${((cacheHit / fullCtx) * 100).toFixed(2)}%）` : ''}`;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1100,
      background: 'oklch(0.10 0.006 265 / 0.74)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 26,
    }} onClick={onClose}>
      <div style={{
        position: 'relative',
        width: 'min(1200px, 96vw)',
        height: 'min(900px, 93vh)',
        background: 'oklch(0.155 0.008 265)',
        border: `1px solid oklch(0.36 0.014 265)`,
        borderRadius: 18,
        overflow: 'hidden',
        boxShadow: '0 34px 90px oklch(0 0 0 / 0.6)',
        display: 'flex', flexDirection: 'column',
      }} onClick={e => e.stopPropagation()}>
        {/* Title bar */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12, padding: '13px 18px',
          borderBottom: `1px solid oklch(0.28 0.012 265)`,
          background: 'oklch(0.185 0.009 265)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: 'oklch(0.74 0.13 60)', boxShadow: '0 0 10px oklch(0.74 0.13 60 / 0.7)' }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: 'oklch(0.91 0.01 265)' }}>{isCum ? '累计拼装上下文透视' : '本轮上下文透视'}</span>
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'oklch(0.55 0.012 265)' }}>{isCum ? `第 ${turnIndex} 轮 · 累计拼装 ${fmt(fullCtx)} tok · 缓存 ${fmt(cacheHit)}（${((cacheHit / fullCtx) * 100).toFixed(2)}%）` : sub}</span>
          </div>
          <button onClick={onClose} title="关闭" style={{
            border: `1px solid oklch(0.32 0.014 265)`, borderRadius: 8,
            width: 30, height: 30, background: 'oklch(0.22 0.01 265)',
            color: 'oklch(0.82 0.01 265)', cursor: 'pointer',
            fontSize: 14, lineHeight: 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>✕</button>
        </div>
        {/* Embedded Context Assembly */}
        <div className="tl" style={{ flex: 1, overflow: 'auto' }}>
          <ContextAssembly peakData={peakData} embedded mode={isCum ? 'cumulative' : 'peak'} />
        </div>
      </div>
    </div>
  );
}

export function buildCategories(comp: Record<string, number>, fullCtx: number, cumTotal: number): ContextCategory[] {
  const scaleF = cumTotal > 0 ? fullCtx / cumTotal : 1;
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
    const t = Math.round(tokens * scaleF);
    const meta = CAT_META[key] ?? { label: key, group: 'convo' as const };
    cats.push({ key, label: meta.label, group: meta.group, estimated: EST.has(key), tokens: t, raw: 0 });
  }
  cats.sort((a, b) => b.tokens - a.tokens);
  // Absorb rounding drift into the largest category so the sum equals fullCtx
  const roundedSum = cats.reduce((s, c) => s + c.tokens, 0);
  const drift = fullCtx - roundedSum;
  if (drift !== 0 && cats.length > 0 && cats[0]!.tokens + drift > 0) {
    cats[0]!.tokens += drift;
  }
  return cats;
}
