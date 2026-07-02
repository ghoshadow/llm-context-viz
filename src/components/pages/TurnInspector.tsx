import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useSessionStore } from '../../store/sessionStore';
import { useUIStore } from '../../store/uiStore';
import { SEMANTIC, STEP_COLORS } from '../../styles/theme';
import { fmt, fmtDate } from '../../utils/format';
import { post, get } from '../../api/client';
import ModelConfigModal from './ModelConfigModal';
import { CHARS_PER_TOKEN } from '../../pipeline/utils';
import type { TurnDetail, TurnSummary, RawToolEntry } from '../../types/session';
import { parseJSON } from './turnInspectorLogic';
import { ContextStructure, DeltaPanel, ExecutionTimeline, ToolUsagePanel, TurnListItem } from './turnInspectorPanels';

// ============================================================================
// Helpers
// ============================================================================

// ============================================================================
// Main TurnInspector Component
// ============================================================================

import PeakModal, { buildCategories } from '../upload/PeakModal';

export default function TurnInspector() {
  const sessionStore = useSessionStore();
  const contextLimit = sessionStore.currentSession?.context_limit ?? 200000;
  const {
    currentSessionId,
    fetchTurns,
    fetchMoreTurns,
    selectTurn,
    turns,
    turnsLoading,
    turnsTotal,
    turnsHasMore,
    currentTurnIndex,
    currentTurn,
    currentTurnLoading,
  } = sessionStore;

  const selectedStepIndex = useUIStore((s) => s.selectedStepIndex);
  const toggleStep = useUIStore((s) => s.toggleStep);
  const [showPeakDetail, setShowPeakDetail] = useState(false);
  const [showCumDetail, setShowCumDetail] = useState(false);
  const [showModelConfig, setShowModelConfig] = useState(false);
  const setSelectedStepIndex = useUIStore((s) => s.setSelectedStepIndex);
  const setPage = useUIStore((s) => s.setPage);

  // Local hover state for context bar (not in UI store to keep it scoped)
  const [hoveredComp, setHoveredComp] = useState<string | null>(null);

  // On mount or session change: fetch turns, auto-select latest
  useEffect(() => {
    if (currentSessionId) {
      fetchTurns(currentSessionId);
    }
  }, [currentSessionId, fetchTurns]);

  // Reset turn selection when session changes
  useEffect(() => {
    if (currentSessionId) {
      useSessionStore.setState({ currentTurnIndex: null, currentTurn: null });
    }
  }, [currentSessionId]);

  useEffect(() => {
    if (turns.length > 0 && currentTurnIndex === null) {
      selectTurn(turns[0]!.turn_index);
    }
  }, [turns, currentTurnIndex, selectTurn]);

  // Reset step selection when turn changes
  useEffect(() => {
    setSelectedStepIndex(null);
  }, [currentTurnIndex, setSelectedStepIndex]);

  const prevSegLen = useRef(0);
  const prevTurnIds = useRef('');

  // Auto-refresh: re-parse JSONL, then silently update turn list + detail
  useEffect(() => {
    if (!currentSessionId || currentTurnIndex === null) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      if (cancelled) return;
      try {
        await post(`/sessions/${currentSessionId}/refresh`);
        // Silent turn list refresh — only update if changed
        const turns = await get<TurnSummary[]>(`/sessions/${currentSessionId}/turns?all=1`);
        if (cancelled) return;
        const fp = turns.map(t => `${t.turn_index}:${t.asst_reqs}:${t.max_input}`).join(',');
        if (fp !== prevTurnIds.current) {
          prevTurnIds.current = fp;
          useSessionStore.setState({ turns });
        }
        // Current turn detail — only update if segments changed
        const t = await get<TurnDetail>(`/sessions/${currentSessionId}/turns/${currentTurnIndex}`);
        if (cancelled) return;
        const newLen = (t.segs ?? []).length;
        if (newLen !== prevSegLen.current) {
          prevSegLen.current = newLen;
          useSessionStore.setState({ currentTurn: t });
        }
      } catch { /* silently skip */ }
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      prevSegLen.current = 0;
      prevTurnIds.current = '';
    };
  }, [currentSessionId, currentTurnIndex]);

  const handleCompEnter = useCallback((key: string) => {
    setHoveredComp(key);
  }, []);

  const handleCompLeave = useCallback(() => {
    setHoveredComp(null);
  }, []);

  // Derive values from API data
  const turnDetail = useMemo(() => {
    if (!currentTurn) return null;

    const comp = currentTurn.comp ?? {};
    const delta = currentTurn.delta ?? {};
    const tools = currentTurn.tools ?? {};
    const segs = currentTurn.segs ?? [];
    const longest = currentTurn.longest ?? { k: 'm', n: '', ms: 0 };

    const durMs = currentTurn.dur_ms ?? 0;
    const modelMs = currentTurn.model_ms ?? 0;
    const toolMs = currentTurn.tool_ms ?? 0;
    const subMs = currentTurn.sub_ms ?? 0;
    const stepCount = segs.length;

    const longestName = longest.k === 'm' ? '模型生成' : longest.n;
    const longestMs = longest.ms ?? 0;

    return {
      comp,
      delta,
      tools,
      segs,
      longestName,
      longestMs,
      durMs,
      modelMs,
      toolMs,
      subMs,
      stepCount,
    };
  }, [currentTurn]);

  // Guard: no session
  if (!currentSessionId) {
    return (
      <div
        style={{
          textAlign: 'center',
          padding: '120px 20px',
          color: SEMANTIC.textMuted,
          fontSize: 15,
        }}
      >
        请先选择一个会话
      </div>
    );
  }

  return (
    <>
      {/* ================================================================ */}
      {/* HEADER                                                           */}
      {/* ================================================================ */}
      <header className="header-bar">
        <div style={{ maxWidth: 680 }}>
          <div className="tag">
            <div className="tag-dot" />
            <span className="tag-text">逐轮上下文检查器</span>
          </div>
          <h1>逐轮查看对话的上下文结构</h1>
          <p className="subtitle">
            选择左侧任意一轮对话，查看该轮请求时上下文窗口的拼装结构、本轮新增内容以及调用的工具。
          </p>
        </div>
        <div style={{ display: 'flex', gap: 9, fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setPage('home');
            }}
            style={{
              textDecoration: 'none',
              border: `1px solid ${SEMANTIC.borderColor}`,
              borderRadius: 9,
              padding: '9px 14px',
              color: SEMANTIC.textSecondary,
              background: 'oklch(0.20 0.01 265 / 0.6)',
            }}
          >
            &larr; 首页
          </a>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setPage('ontology');
            }}
            style={{
              textDecoration: 'none',
              border: `1px solid ${SEMANTIC.borderColor}`,
              borderRadius: 9,
              padding: '9px 14px',
              color: SEMANTIC.textSecondary,
              background: 'oklch(0.20 0.01 265 / 0.6)',
            }}
          >
            本体建模
          </a>
          <span
            style={{
              border: `1px solid ${SEMANTIC.borderAccent}`,
              borderRadius: 9,
              padding: '9px 14px',
              color: SEMANTIC.textAccent2,
              background: 'oklch(0.74 0.13 60 / 0.12)',
            }}
          >
            逐轮检查
          </span>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setShowModelConfig(true);
            }}
            style={{
              textDecoration: 'none',
              border: `1px solid ${SEMANTIC.borderColor}`,
              borderRadius: 9,
              padding: '9px 14px',
              color: SEMANTIC.textSecondary,
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 12,
              background: 'oklch(0.20 0.01 265 / 0.6)',
            }}
          >
            模型配置
          </a>
        </div>
      </header>

      {/* ================================================================ */}
      {/* MAIN: list + detail                                              */}
      {/* ================================================================ */}
      <section
        style={{
          marginTop: 26,
          display: 'grid',
          gridTemplateColumns: '360px 1fr',
          gap: 24,
          alignItems: 'start',
        }}
      >
        {/* LEFT: Turn list */}
        <div
          style={{
            border: `1px solid ${SEMANTIC.borderColor}`,
            borderRadius: 16,
            background: SEMANTIC.cardBg,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              padding: '16px 18px 12px',
              borderBottom: `1px solid ${SEMANTIC.borderSubtle2}`,
            }}
          >
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>对话轮次</h2>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: SEMANTIC.textMuted }}>
                共 {turns.length}{turnsTotal > turns.length ? ` / ${turnsTotal}` : ''} 轮
              </span>
              <button
                onClick={(e) => { e.preventDefault(); setPage('calibrate'); }}
                title="校准上下文常量"
                style={{
                  border: `1px solid ${SEMANTIC.borderColor}`, borderRadius: 6, padding: '3px 10px',
                  fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, cursor: 'pointer',
                  background: 'oklch(0.20 0.01 265 / 0.6)', color: SEMANTIC.textSecondary,
                }}
              >
                校准常量
              </button>
              <button
                onClick={async () => {
                  if (!currentSessionId) return;
                  try {
                    await post(`/sessions/${currentSessionId}/refresh`);
                    fetchTurns(currentSessionId);
                  } catch { fetchTurns(currentSessionId); }
                }}
                disabled={turnsLoading}
                title="刷新轮次列表"
                style={{
                  border: `1px solid ${SEMANTIC.borderColor}`, borderRadius: 6, padding: '3px 10px',
                  fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, cursor: turnsLoading ? 'not-allowed' : 'pointer',
                  background: 'oklch(0.20 0.01 265 / 0.6)', color: SEMANTIC.textSecondary,
                  opacity: turnsLoading ? 0.5 : 1,
                }}
              >
                {turnsLoading ? '刷新中...' : '↻ 刷新'}
              </button>
            </div>
          </div>

          {turnsLoading ? (
            <div style={{ padding: 40, textAlign: 'center', color: SEMANTIC.textMuted, fontSize: 13 }}>
              加载轮次数列表...
            </div>
          ) : (
            <div
              className="thin-scrollbar"
              style={{
                maxHeight: 'calc(100vh - 160px)',
                overflowY: 'auto',
                padding: '8px',
                display: 'flex',
                flexDirection: 'column',
                gap: 5,
              }}
            >
              {turns.map((t) => {
                const turnNum = String(t.turn_index).padStart(2, '0');
                const isSelected = t.turn_index === currentTurnIndex;
                return (
                  <TurnListItem
                    key={t.id}
                    turnIndex={t.turn_index}
                    turnNum={turnNum}
                    asstReqs={t.asst_reqs ?? 0}
                    maxInput={t.max_input ?? 0}
                    prompt={t.prompt ?? ''}
                    cumTotal={t.cum_total ?? 0}
                    contextLimit={contextLimit}
                    isSelected={isSelected}
                    compressionReset={!!t.compression_reset}
                    onClick={() => selectTurn(t.turn_index)}
                  />
                );
              })}
              {turnsHasMore && (
                <button
                  onClick={() => { void fetchMoreTurns(); }}
                  disabled={turnsLoading}
                  style={{
                    border: `1px solid ${SEMANTIC.borderColor}`,
                    borderRadius: 9,
                    padding: '9px 12px',
                    marginTop: 4,
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 11,
                    cursor: turnsLoading ? 'not-allowed' : 'pointer',
                    background: 'oklch(0.20 0.01 265 / 0.6)',
                    color: SEMANTIC.textSecondary,
                    opacity: turnsLoading ? 0.5 : 1,
                  }}
                >
                  加载更多
                </button>
              )}
            </div>
          )}
        </div>

        {/* RIGHT: Detail (sticky) */}
        <div
          style={{
            position: 'sticky',
            top: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
            minWidth: 0,
          }}
        >
          {currentTurnLoading ? (
            <div
              className="panel"
              style={{ textAlign: 'center', padding: 80, color: SEMANTIC.textMuted, fontSize: 14 }}
            >
              正在加载轮次详情...
            </div>
          ) : currentTurn && turnDetail ? (
            <>
              {/* Turn summary + Stats Card */}
              <div className="panel" style={{ padding: '20px 22px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 15 }}>
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 12,
                      fontWeight: 600,
                      color: SEMANTIC.textAccent,
                    }}
                  >
                    第 {String(currentTurn.turn_index).padStart(2, '0')} 轮
                  </span>
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 11,
                      color: SEMANTIC.textMuted2,
                    }}
                  >
                    {fmtDate(currentTurn.timestamp)}
                  </span>
                </div>

                <div className="four-col">
                  <div className="stat-card">
                    <div className="stat-value">{currentTurn.asst_reqs}</div>
                    <div className="stat-label">模型请求</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-value" style={{ color: SEMANTIC.textAccent }}>
                      {fmt(currentTurn.max_input)}<span style={{fontSize:11,color:'oklch(0.55 0.012 265)',marginLeft:4}}>tok</span>
                    </div>
                    <div className="stat-label">
                      峰值输入 · 步骤 #{(currentTurn.max_req_step ?? 0) + 1}
                      <span
                        style={{ marginLeft: 4, color: 'oklch(0.74 0.13 60)', cursor: 'pointer', fontSize: 10, textDecoration: 'underline' }}
                        onClick={(e) => { e.stopPropagation(); setShowPeakDetail(true); }}
                      >查看</span>
                    </div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-value" style={{ color: STEP_COLORS.model }}>
                      {fmt(currentTurn.out_tok)}<span style={{fontSize:11,color:'oklch(0.55 0.012 265)',marginLeft:4}}>tok</span>
                    </div>
                    <div className="stat-label">输出 Token</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-value">{fmt(currentTurn.cum_total)}<span style={{fontSize:11,color:'oklch(0.55 0.012 265)',marginLeft:4}}>tok</span></div>
                    <div className="stat-label">
                      累计拼装{(currentTurn.cum_cache_hit ?? 0) > 0 ? ` · 缓存 ${fmt(currentTurn.cum_cache_hit ?? 0)}（${currentTurn.cum_total > 0 ? (((currentTurn.cum_cache_hit ?? 0) / currentTurn.cum_total) * 100).toFixed(2) : '0.00'}%）` : ''}
                      <span
                        style={{ marginLeft: 4, color: 'oklch(0.74 0.13 60)', cursor: 'pointer', fontSize: 10, textDecoration: 'underline' }}
                        onClick={(e) => { e.stopPropagation(); setShowCumDetail(true); }}
                      >查看</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Context Structure Card */}
              <ContextStructure
                comp={turnDetail.comp}
                cumTotal={currentTurn.cum_total}
                maxInput={currentTurn.max_input}
                contextLimit={contextLimit}
                hoveredComp={hoveredComp}
                onCompEnter={handleCompEnter}
                onCompLeave={handleCompLeave}
              />

              {/* Execution Timeline Card */}
              <ExecutionTimeline
                durMs={turnDetail.durMs}
                modelMs={turnDetail.modelMs}
                toolMs={turnDetail.toolMs}
                subMs={turnDetail.subMs}
                stepCount={turnDetail.stepCount}
                segs={turnDetail.segs}
                longestName={turnDetail.longestName}
                longestMs={turnDetail.longestMs}
                prompt={currentTurn.prompt ?? ''}
                selectedStepIndex={selectedStepIndex}
                onToggleStep={toggleStep}
              />

              {/* Bottom grid: Delta + Tools */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
                <DeltaPanel delta={turnDetail.delta} />
                <ToolUsagePanel tools={turnDetail.tools} />
              </div>
            </>
          ) : (
            <div
              className="panel"
              style={{ textAlign: 'center', padding: 80, color: SEMANTIC.textMuted, fontSize: 14 }}
            >
              选择左侧轮次查看详情
            </div>
          )}
        </div>
      </section>

      {/* ================================================================ */}
      {/* FOOTER                                                            */}
      {/* ================================================================ */}
      <footer className="app-footer">
        <span>
          Token 数量按 ~{CHARS_PER_TOKEN} 字符/token 估算（基于 DeepSeek 官方比率：英文 3.33 / 中文 1.67） · "累计拼装"为到该轮为止拼入上下文的内容总量 · 标"估算"的模块为近似值
        </span>
      </footer>

      {/* Peak request detail modal — compute stepTools + scale once, share for both categories and tools */}
      {showPeakDetail && currentTurn && (() => {
        const comp: Record<string, number> = turnDetail?.comp ?? {};
        const segs = turnDetail?.segs ?? (currentTurn.segs ?? []);

        // Find stepTools at or before the peak step
        let stepTools: Record<string, RawToolEntry> | null = null;
        for (let i = Math.min(currentTurn.max_req_step ?? 0, segs.length - 1); i >= 0; i--) {
          const det = segs[i]?.det;
          if (det?.stepTools) {
            stepTools = det.stepTools as Record<string, RawToolEntry>;
            break;
          }
        }
        if (!stepTools) {
          const ct = JSON.parse(currentTurn.cum_tools_json || '{}') as Record<string, RawToolEntry>;
          if (Object.keys(ct).length > 0) stepTools = ct;
        }

        // Adjust comp to step level
        const adjComp = { ...comp };
        if (stepTools) {
          const turnCt: Record<string, RawToolEntry> = JSON.parse(currentTurn.cum_tools_json || '{}');
          const turnSubRt = Object.entries(turnCt).filter(([, v]) => v.task).reduce((s, [, v]) => s + (v.resultTokens ?? 0), 0);
          const stepSubRt = Object.entries(stepTools).filter(([, v]) => v.task).reduce((s, [, v]) => s + (v.resultTokens ?? 0), 0);
          const turnToolRt = Object.entries(turnCt).filter(([, v]) => !v.task).reduce((s, [, v]) => s + (v.resultTokens ?? 0), 0);
          const stepToolRt = Object.entries(stepTools).filter(([, v]) => !v.task).reduce((s, [, v]) => s + (v.resultTokens ?? 0), 0);
          if (turnSubRt > 0) adjComp.subagent = stepSubRt;
          if (turnToolRt > 0) adjComp.toolResults = stepToolRt;
        }
        const adjSum = Object.values(adjComp).reduce((a, b) => (a as number) + (b as number), 0) || 1;
        const catsP = buildCategories(adjComp, currentTurn.max_input, adjSum);
        const toolsP = stepTools
          ? Object.entries(stepTools).map(([name, v]) => ({
              name, calls: v.calls ?? 0, resultTokens: v.resultTokens ?? 0, task: v.task ?? false,
            }))
          : [];

        return (
        <PeakModal
          categories={catsP}
          tools={toolsP}
          peakTokens={currentTurn.max_input}
          peakIndex={currentTurnIndex ?? 0}
          turnIndex={currentTurn.turn_index ?? currentTurnIndex ?? 0}
          reqStep={currentTurn.max_req_step ?? 0}
          model={sessionStore.currentSession?.model ?? 'unknown'}
          contextLimit={contextLimit}
          cacheHit={currentTurn.max_cache_hit ?? 0}
          fullCtx={currentTurn.max_input + (currentTurn.max_cache_hit ?? 0)}
          asstReqs={currentTurn.asst_reqs}
          mode="peak"
          onClose={() => setShowPeakDetail(false)}
        />
        );
      })()}

      {/* Cumulative context detail modal */}
      {showCumDetail && currentTurn && (() => {
        const comp: Record<string, number> = turnDetail?.comp ?? {};
        // Replace subagent/toolResults with exact cumTools values
        const ctRaw: Record<string, RawToolEntry> = JSON.parse(currentTurn.cum_tools_json || '{}');
        const adjComp = { ...comp };
        if (Object.keys(ctRaw).length > 0) {
          const sRt = Object.entries(ctRaw).filter(([, v]) => v.task).reduce((s, [, v]) => s + (v.resultTokens ?? 0), 0);
          const tRt = Object.entries(ctRaw).filter(([, v]) => !v.task).reduce((s, [, v]) => s + (v.resultTokens ?? 0), 0);
          if (sRt > 0) adjComp.subagent = sRt;
          if (tRt > 0) adjComp.toolResults = tRt;
        }
        const compSum = Object.values(adjComp).reduce((a, b) => (a as number) + (b as number), 0) || 1;
        const cats = buildCategories(adjComp, currentTurn.cum_total, compSum);

                // Build tools list directly from cumTools — raw values, no API scaling
        const ct: Record<string, RawToolEntry> = JSON.parse(currentTurn.cum_tools_json || '{}');
        const toolsRaw = Object.entries(ct).map(([name, v]) => ({
          name,
          calls: v.calls ?? 0,
          resultTokens: v.resultTokens ?? 0,
          task: v.task ?? false,
        }));

        return (
        <PeakModal
          categories={cats}
          tools={toolsRaw}
          peakTokens={currentTurn.cum_total}
          peakIndex={currentTurnIndex ?? 0}
          turnIndex={currentTurn.turn_index ?? currentTurnIndex ?? 0}
          reqStep={0}
          model={sessionStore.currentSession?.model ?? 'unknown'}
          contextLimit={contextLimit}
          cacheHit={currentTurn.cum_cache_hit ?? 0}
          fullCtx={currentTurn.cum_total}
          asstReqs={turns.filter(t => (t.turn_index ?? 0) <= (currentTurn.turn_index ?? currentTurnIndex ?? 0)).reduce((s, t) => s + (t.asst_reqs ?? 0), 0)}
          series={turns
            .filter(t => (t.turn_index ?? 0) <= (currentTurn.turn_index ?? 0))
            .sort((a, b) => (a.turn_index ?? 0) - (b.turn_index ?? 0))
            .map(t => ({
              i: t.turn_index ?? 0,
              assembled: t.cum_total ?? 0,
              input: t.max_input ?? 0,
              output: t.out_tok ?? 0,
            }))}
          mode="cumulative"
          onClose={() => setShowCumDetail(false)}
        />
        );
      })()}

      {/* 模型配置 Modal */}
      {showModelConfig && <ModelConfigModal onClose={() => setShowModelConfig(false)} />}
    </>
  );
}
