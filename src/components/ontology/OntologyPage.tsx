import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSessionStore } from '../../store/sessionStore';
import { useUIStore } from '../../store/uiStore';
import { SEMANTIC } from '../../styles/theme';
import OntologyGraph from './OntologyGraph';
import OntologyToolbar from './OntologyToolbar';
import OntologyDetailPanel from './OntologyDetailPanel';
import ProgressBar from '../shared/ProgressBar';

// ─── Component ──────────────────────────────────────────────────────────────

export default function OntologyPage() {
  // Local state
  const [turn, setTurn] = useState(1);
  const [activeTypes, setActiveTypes] = useState<Record<string, boolean>>({});
  const [playing, setPlaying] = useState(false);
  const [recenterKey, setRecenterKey] = useState(0);
  const [turnTouched, setTurnTouched] = useState(false);

  // Stores
  const selectedOntologyNode = useUIStore((s) => s.selectedOntologyNode);
  const setSelectedOntologyNode = useUIStore((s) => s.setSelectedOntologyNode);
  const setPage = useUIStore((s) => s.setPage);
  const ontologyData = useSessionStore((s) => s.ontologyData);
  const ontologyMaxTurn = useSessionStore((s) => s.ontologyMaxTurn);
  const ontologyLoading = useSessionStore((s) => s.ontologyLoading);
  const ontologyError = useSessionStore((s) => s.ontologyError);
  const ontologyFetched = useSessionStore((s) => s.ontologyFetched);
  const fetchOntology = useSessionStore((s) => s.fetchOntology);
  const extractOntology = useSessionStore((s) => s.extractOntology);
  const fetchExtractStatus = useSessionStore((s) => s.fetchExtractStatus);
  const extractPhase = useSessionStore((s) => s.extractPhase);
  const extractProgress = useSessionStore((s) => s.extractProgress);
  const extractDepth = useSessionStore((s) => s.extractDepth);
  const extractShardSize = useSessionStore((s) => s.extractShardSize);
  const extractMaxShardChars = useSessionStore((s) => s.extractMaxShardChars);
  const extractRootDir = useSessionStore((s) => s.extractRootDir);
  const extractError = useSessionStore((s) => s.extractError);
  const currentSessionId = useSessionStore((s) => s.currentSessionId);

  // Auto-extract state
  const [shardSize, setShardSize] = useState(30);
  const [maxShardChars, setMaxShardChars] = useState(45000);
  const [forceExtract, setForceExtract] = useState(false);
  const [showExtractModal, setShowExtractModal] = useState(false);
  const [extractMode, setExtractMode] = useState<'full' | 'incremental'>('full');
  const [extractionDepth, setExtractionDepth] = useState<'refined' | 'deep'>('refined');

  const handleStartExtract = useCallback(async (mode: 'full' | 'incremental') => {
    setExtractMode(mode);
    // full=强制重建提取文件, incremental=复用已有文件（如存在）
    await extractOntology({
      shardSize,
      maxShardChars,
      force: mode === 'full' ? forceExtract : false,
      incremental: mode === 'incremental',
      extractionDepth,
    });
  }, [extractOntology, shardSize, maxShardChars, forceExtract, extractionDepth]);

  const handleRetryFailedShards = useCallback(async () => {
    await extractOntology({
      shardSize: extractShardSize,
      maxShardChars: extractMaxShardChars,
      force: false,
      incremental: false,
      retryFailedOnly: true,
      extractionDepth: extractDepth,
    });
  }, [extractOntology, extractShardSize, extractMaxShardChars, extractDepth]);

  const openExtractModal = useCallback((mode: 'full' | 'incremental') => {
    setExtractMode(mode);
    setShowExtractModal(true);
  }, []);

  // Refs
  const playRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recenterRef = useRef(0);

  // ─── Data loading ──────────────────────────────────────────────────────

  useEffect(() => {
    if (currentSessionId && !ontologyData && !ontologyLoading && !ontologyFetched) {
      fetchOntology();
    }
  }, [currentSessionId, ontologyData, ontologyLoading, ontologyFetched, fetchOntology]);

  useEffect(() => {
    if (currentSessionId) {
      setTurnTouched(false);
      fetchExtractStatus();
    }
  }, [currentSessionId, fetchExtractStatus]);

  useEffect(() => {
    if (extractPhase === 'idle') return;
    const timer = window.setInterval(() => {
      fetchExtractStatus();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [extractPhase, fetchExtractStatus]);

  useEffect(() => {
    if (extractPhase !== 'idle') return;
    setExtractionDepth(extractDepth);
    setShardSize(extractShardSize);
    setMaxShardChars(extractMaxShardChars);
  }, [extractPhase, extractDepth, extractShardSize, extractMaxShardChars]);

  // Reset error when session changes so we retry for a new session
  // (handled by selectSession clearing ontologyFetched)

  // Initialize activeTypes when data arrives
  useEffect(() => {
    if (ontologyData) {
      const at: Record<string, boolean> = {};
      ontologyData.types.forEach((t) => (at[t.key] = true));
      setActiveTypes((prev) => (Object.keys(prev).length === 0 ? at : prev));

      const maxT = ontologyMaxTurn || Math.max(...ontologyData.nodes.map((n) => n.firstTurn), 1);
      setTurn((prev) => (turnTouched ? Math.min(Math.max(prev, 1), maxT) : maxT));
    }
  }, [ontologyData, ontologyMaxTurn, turnTouched]);

  // Auto-clear selection when node becomes invisible
  useEffect(() => {
    if (!selectedOntologyNode || !ontologyData) return;
    const node = ontologyData.nodes.find((n) => n.id === selectedOntologyNode);
    if (!node || activeTypes[node.type] === false || node.firstTurn > turn) {
      setSelectedOntologyNode(null);
    }
  }, [activeTypes, turn, selectedOntologyNode, ontologyData, setSelectedOntologyNode]);

  // Cleanup play interval on unmount
  useEffect(() => {
    return () => {
      if (playRef.current) clearInterval(playRef.current);
    };
  }, []);

  // ─── Computed ──────────────────────────────────────────────────────────

  const maxTurn = useMemo(() => {
    if (ontologyMaxTurn > 0) return ontologyMaxTurn;
    if (!ontologyData) return 1;
    return Math.max(...ontologyData.nodes.map((n) => n.firstTurn), 1);
  }, [ontologyData, ontologyMaxTurn]);

  const degree = useMemo(() => {
    const d: Record<string, number> = {};
    if (!ontologyData) return d;
    ontologyData.nodes.forEach((n) => (d[n.id] = 0));
    ontologyData.edges.forEach((e) => {
      d[e.s] = (d[e.s] || 0) + 1;
      d[e.t] = (d[e.t] || 0) + 1;
    });
    return d;
  }, [ontologyData]);

  const visibleCounts = useMemo(() => {
    if (!ontologyData) return { nodes: 0, edges: 0 };
    const vn = ontologyData.nodes.filter(
      (n) => activeTypes[n.type] !== false && n.firstTurn <= turn,
    );
    const vIds = new Set(vn.map((n) => n.id));
    const ve = ontologyData.edges.filter(
      (e) => e.firstTurn <= turn && vIds.has(e.s) && vIds.has(e.t),
    );
    return { nodes: vn.length, edges: ve.length };
  }, [ontologyData, activeTypes, turn]);

  const failedShardCount = useMemo(
    () => extractProgress.shardDetails.filter((s) => s.status === 'error').length,
    [extractProgress.shardDetails],
  );

  // ─── Callbacks ─────────────────────────────────────────────────────────

  const onToggleType = useCallback((key: string) => {
    setActiveTypes((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const onSetTurn = useCallback((t: number) => {
    setTurnTouched(true);
    setTurn(t);
  }, []);

  const onTogglePlay = useCallback(() => {
    if (playing) {
      if (playRef.current) { clearInterval(playRef.current); playRef.current = null; }
      setPlaying(false);
      return;
    }
    setPlaying(true);
    setTurnTouched(true);
    const maxT = maxTurn;
    playRef.current = setInterval(() => {
      setTurn((prev) => {
        if (prev >= maxT) {
          if (playRef.current) { clearInterval(playRef.current); playRef.current = null; }
          setPlaying(false);
          return maxT;
        }
        return prev + 1;
      });
    }, 720);
  }, [playing, maxTurn]);

  const onRecenter = useCallback(() => {
    recenterRef.current += 1;
    setRecenterKey(recenterRef.current);
  }, []);

  const onJumpToTurn = useCallback((t: number) => {
    setTurnTouched(true);
    setTurn(t);
  }, []);

  // ─── Render: always show page shell with header/nav ─────────────────────

  const renderBody = () => {
    if (ontologyLoading) {
      return (
        <div style={{ textAlign: 'center', padding: '120px 20px', color: SEMANTIC.textMuted, fontSize: 15, flex: 1 }}>
          正在加载本体数据...
        </div>
      );
    }
    if (ontologyError) {
      return (
        <div style={{ textAlign: 'center', padding: '120px 20px', color: 'oklch(0.76 0.13 45)', fontSize: 15, flex: 1 }}>
          加载本体数据失败: {ontologyError}
        </div>
      );
    }
    if (!ontologyData) {
      return (
        <div style={{ maxWidth: 700, margin: '60px auto 0', padding: '0 20px', color: SEMANTIC.textMuted, fontSize: 14, lineHeight: 1.8, flex: 1 }}>
          <h2 style={{ fontSize: 20, fontWeight: 600, color: SEMANTIC.textPrimary, marginBottom: 12 }}>暂无本体数据</h2>
          <p>本体数据会由 LLM 自动从会话内容中抽取实体和关系，并构建为可浏览的知识图谱。</p>

          {renderExtractCards(false)}
        </div>
      );
    }
    const missingShards = ontologyData.missingShards || [];
    // Main graph view
    return (
      <>
        <OntologyToolbar
          types={ontologyData.types} nodes={ontologyData.nodes} activeTypes={activeTypes}
          turn={turn} maxTurn={maxTurn} phaseThemes={ontologyData.phaseThemes} playing={playing}
          onToggleType={onToggleType} onSetTurn={onSetTurn} onTogglePlay={onTogglePlay} onRecenter={onRecenter}
          onUpdate={() => openExtractModal('incremental')}
          onRebuild={() => openExtractModal('full')}
        />
        {ontologyData.incomplete && missingShards.length > 0 && (
          <div style={{
            flexShrink: 0,
            marginTop: 10,
            padding: '9px 13px',
            borderRadius: 10,
            border: '1px solid oklch(0.78 0.13 65 / 0.38)',
            background: 'oklch(0.78 0.13 65 / 0.10)',
            color: 'oklch(0.84 0.11 70)',
            fontSize: 12,
            lineHeight: 1.5,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
          }}>
            <strong style={{ fontWeight: 600 }}>部分结果</strong>
            <span style={{ color: 'oklch(0.72 0.08 70)' }}>
              缺失 {missingShards.length} 个分片：
              {missingShards.map((s) => `#${s.index + 1} 第 ${s.turnRange} 轮`).join('、')}
            </span>
          </div>
        )}
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(430px, 28vw)', gap: 16, marginTop: 16, minHeight: 0 }}>
          <div style={{ position: 'relative', border: `1px solid ${SEMANTIC.borderColor}`, borderRadius: 16, background: 'oklch(0.17 0.008 265 / 0.6)', overflow: 'hidden' }}>
            <OntologyGraph data={ontologyData} selectedNodeId={selectedOntologyNode} turn={turn} activeTypes={activeTypes} onSelectNode={setSelectedOntologyNode} recenterKey={recenterKey} />
            <div style={{ position: 'absolute', left: 14, bottom: 12, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'oklch(0.46 0.012 265)', pointerEvents: 'none', lineHeight: 1.5 }}>
              横向滚动浏览阶段 · 点击节点看详情 · 选中后高亮关系
            </div>
            <div style={{ position: 'absolute', right: 14, top: 12, display: 'flex', gap: 14, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: SEMANTIC.textMuted2, pointerEvents: 'none' }}>
              <span><span style={{ color: SEMANTIC.textPrimary6, fontWeight: 600 }}>{visibleCounts.nodes}</span> 实体</span>
              <span><span style={{ color: SEMANTIC.textPrimary6, fontWeight: 600 }}>{visibleCounts.edges}</span> 关系</span>
            </div>
          </div>
          <OntologyDetailPanel
            data={ontologyData} selectedNodeId={selectedOntologyNode} turn={turn}
            activeTypes={activeTypes} degree={degree} onSelectNode={setSelectedOntologyNode}
            onClearSelection={() => setSelectedOntologyNode(null)} onJumpToTurn={onJumpToTurn}
            sessionId={currentSessionId}
          />
        </div>
      </>
    );
  };

  // ─── Extract modal ──────────────────────────────────────────────────────

  // Extract the content cards (used by both empty state and modal)
  const renderExtractCards = (inModal: boolean) => (
    <>
      {/* ── Auto-extract card ──────────────────────────────────────────── */}
      <div style={{ marginTop: 20, border: '1px solid oklch(0.45 0.09 165 / 0.45)', borderRadius: 12, background: 'oklch(0.74 0.12 165 / 0.06)', overflow: 'hidden' }}>
        <div style={{ padding: '16px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 16 }}>🤖</span>
            <span style={{ fontSize: 15, fontWeight: 600, color: 'oklch(0.84 0.10 165)' }}>
              {inModal && extractMode === 'incremental' ? '自动提取（增量更新）' : '自动提取'}
            </span>
          </div>
          <p style={{ margin: '0 0 12px', fontSize: 12.5, color: 'oklch(0.60 0.03 165)', lineHeight: 1.6 }}>
            {inModal && extractMode === 'incremental'
              ? '对比原始 JSONL 与已有提取文件树，仅为新增轮次创建分片并执行 LLM 抽取。新结果自动合并到已有本体数据。'
              : '从会话内容中自动抽取实体和关系。系统按最大轮数和字符预算混合分片，存入文件树后并行调用 LLM。'}
          </p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: SEMANTIC.textSecondary }}>抽取模式</span>
            {([
              ['refined', '精炼'],
              ['deep', '深挖'],
            ] as const).map(([value, label]) => {
              const active = extractionDepth === value;
              return (
                <button
                  key={value}
                  type="button"
                  disabled={extractPhase !== 'idle'}
                  onClick={() => setExtractionDepth(value)}
                  style={{
                    padding: '5px 10px',
                    borderRadius: 7,
                    border: active ? '1px solid oklch(0.45 0.09 165)' : `1px solid ${SEMANTIC.borderColor}`,
                    background: active ? 'oklch(0.74 0.12 165 / 0.14)' : SEMANTIC.innerCardBg,
                    color: active ? 'oklch(0.84 0.10 165)' : SEMANTIC.textMuted,
                    cursor: extractPhase === 'idle' ? 'pointer' : 'default',
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 11.5,
                  }}
                >
                  {label}
                </button>
              );
            })}
            <span style={{ fontSize: 11, color: SEMANTIC.textMuted }}>
              {extractionDepth === 'deep' ? '每片约 24-40 实体' : '每片约 8-16 实体'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: SEMANTIC.textSecondary }}>
              最大轮数/片
              <input type="number" value={shardSize} min={10} max={200} disabled={extractPhase !== 'idle'}
                onChange={(e) => setShardSize(Number(e.target.value) || 30)}
                style={{ width: 58, padding: '4px 6px', borderRadius: 6, border: `1px solid ${SEMANTIC.borderColor}`, background: SEMANTIC.innerCardBg, color: SEMANTIC.textPrimary, fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, textAlign: 'center' }} />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: SEMANTIC.textSecondary }}>
              字符预算/片
              <input type="number" value={maxShardChars} min={10000} max={120000} step={5000} disabled={extractPhase !== 'idle'}
                onChange={(e) => setMaxShardChars(Number(e.target.value) || 45000)}
                style={{ width: 78, padding: '4px 6px', borderRadius: 6, border: `1px solid ${SEMANTIC.borderColor}`, background: SEMANTIC.innerCardBg, color: SEMANTIC.textPrimary, fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, textAlign: 'center' }} />
            </label>
            {extractMode === 'full' && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: SEMANTIC.textSecondary, cursor: 'pointer' }}>
                <input type="checkbox" checked={forceExtract} disabled={extractPhase !== 'idle'}
                  onChange={(e) => setForceExtract(e.target.checked)}
                  style={{ accentColor: 'oklch(0.74 0.12 165)' }} />
                强制重建提取文件
              </label>
            )}
          </div>
          {extractMode === 'incremental' && (
            <p style={{ margin: '0 0 12px', fontSize: 11, color: 'oklch(0.52 0.04 165)', lineHeight: 1.5 }}>
              增量模式将对比原始 JSONL 与已有文件树，仅提取新增轮次中的实体和关系，并按当前分片预算追加新分片。
            </p>
          )}
          <button onClick={() => handleStartExtract(inModal ? extractMode : 'full')}
            disabled={extractPhase !== 'idle' || ontologyLoading}
            style={{ padding: '9px 20px', borderRadius: 8, cursor: extractPhase === 'idle' ? 'pointer' : 'default', border: '1px solid oklch(0.45 0.09 165)', fontFamily: "'IBM Plex Mono', monospace", background: 'oklch(0.74 0.12 165 / 0.16)', color: 'oklch(0.84 0.10 165)', fontSize: 12.5, opacity: extractPhase === 'idle' ? 1 : 0.5 }}>
            {extractPhase === 'idle' ? '▶ 开始自动提取' : extractPhase === 'extracting' ? '提取中...' : extractPhase === 'merging' ? '合并中...' : '构建中...'}
          </button>
          {(extractPhase !== 'idle' || extractError) && (
            <div style={{ marginTop: 14 }}>
              {extractRootDir && (
                <div style={{ fontSize: 10.5, color: 'oklch(0.52 0.04 165)', marginBottom: 8, fontFamily: "'IBM Plex Mono', monospace", wordBreak: 'break-all', lineHeight: 1.4 }}>
                  提取文件树: {extractRootDir}
                </div>
              )}
              <div style={{ fontSize: 12, color: 'oklch(0.70 0.06 165)', marginBottom: 8, fontFamily: "'IBM Plex Mono', monospace" }}>
                {extractPhase === 'idle'
                  ? '提取未完成'
                  : extractPhase === 'extracting'
                  ? `正在提取实体 (${extractProgress.shardsCompleted}/${extractProgress.shardsTotal} 分片)`
                  : extractPhase === 'merging' ? '正在合并分片结果...' : '正在构建知识图谱...'}
              </div>
              {extractPhase === 'extracting' && extractProgress.shardsTotal > 0 && (
                <ProgressBar pct={Math.round((extractProgress.shardsCompleted / extractProgress.shardsTotal) * 100)} />
              )}
              {extractProgress.shardDetails.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 180, overflowY: 'auto' }}>
                  {extractProgress.shardDetails.map((s) => (
                    <div key={s.index} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, fontFamily: "'IBM Plex Mono', monospace" }}>
                      <span style={{ flexShrink: 0 }}>{s.status === 'done' ? '✓' : s.status === 'running' ? '⏳' : s.status === 'error' ? '✗' : '○'}</span>
                      <span style={{ color: s.status === 'error' ? 'oklch(0.76 0.13 45)' : s.status === 'done' ? 'oklch(0.78 0.12 150)' : 'oklch(0.58 0.012 265)', minWidth: 52 }}>分片 {s.index + 1}</span>
                      {s.status === 'done' && <span style={{ color: SEMANTIC.textMuted }}>{s.candidates} 实体 · {s.relations} 关系</span>}
                      {s.status === 'running' && <span style={{ color: SEMANTIC.textMuted }}>调用 LLM...</span>}
                      {s.status === 'error' && <span style={{ color: 'oklch(0.66 0.12 45)' }}>{s.error || '失败'}</span>}
                      {s.status === 'pending' && <span style={{ color: SEMANTIC.textMuted }}>等待中</span>}
                    </div>
                  ))}
                </div>
              )}
              {extractError && (
                <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: 'oklch(0.66 0.17 25 / 0.12)', border: '1px solid oklch(0.66 0.17 25 / 0.3)', fontSize: 12, color: 'oklch(0.76 0.13 45)', lineHeight: 1.5 }}>
                  ❌ {extractError}
                  <button onClick={() => handleStartExtract(extractMode)} style={{ marginLeft: 10, padding: '3px 10px', borderRadius: 6, border: '1px solid oklch(0.76 0.13 45 / 0.5)', background: 'transparent', color: 'oklch(0.76 0.13 45)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11 }}>重试</button>
                  {failedShardCount > 0 && extractPhase === 'idle' && (
                    <button onClick={handleRetryFailedShards} style={{ marginLeft: 8, padding: '3px 10px', borderRadius: 6, border: '1px solid oklch(0.78 0.13 65 / 0.55)', background: 'oklch(0.78 0.13 65 / 0.10)', color: 'oklch(0.84 0.11 70)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11 }}>
                      只重跑失败分片（{failedShardCount}）
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

    </>
  );

  const renderExtractModal = () => (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'oklch(0.10 0.006 265 / 0.74)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 26 }}
      onClick={() => setShowExtractModal(false)}>
      <div style={{ width: 'min(700px, 96vw)', maxHeight: '90vh', overflow: 'auto', background: 'oklch(0.155 0.008 265)', border: '1px solid oklch(0.36 0.014 265)', borderRadius: 18, boxShadow: '0 34px 90px oklch(0 0 0 / 0.6)' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '13px 18px', borderBottom: '1px solid oklch(0.28 0.012 265)', background: 'oklch(0.185 0.009 265)' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'oklch(0.91 0.01 265)' }}>
            {extractPhase !== 'idle'
              ? `${extractMode === 'incremental' ? '🔄 增量更新中' : '🆕 重建中'} (${extractProgress.shardsCompleted}/${extractProgress.shardsTotal})`
              : extractError
                ? `⚠ 提取未完成 (${extractProgress.shardsCompleted}/${extractProgress.shardsTotal})`
              : extractMode === 'incremental' ? '🔄 增量更新本体' : '🆕 重建本体'}
          </span>
          <button onClick={() => setShowExtractModal(false)}
            style={{ border: '1px solid oklch(0.32 0.014 265)', borderRadius: 8, width: 30, height: 30, background: 'oklch(0.22 0.01 265)', color: 'oklch(0.82 0.01 265)', cursor: 'pointer', fontSize: 14 }}>✕</button>
        </div>
        <div style={{ padding: '20px 22px', color: SEMANTIC.textMuted, fontSize: 14, lineHeight: 1.8 }}>
          <h2 style={{ fontSize: 20, fontWeight: 600, color: SEMANTIC.textPrimary, margin: '0 0 12px' }}>
            {extractMode === 'incremental' ? '增量更新本体数据' : '重建本体数据'}
          </h2>
          <p>本体数据会由 LLM 自动从会话内容中抽取实体和关系。你可以重建完整图谱，或只提取新增轮次做增量更新。</p>
          {renderExtractCards(true)}
        </div>
      </div>
    </div>
  );

  // ─── Page shell ───────────────────────────────────────────────────────

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: `radial-gradient(1100px 640px at 82% -12%, oklch(0.22 0.03 200 / 0.40), transparent 60%), ${SEMANTIC.pageBg}`,
        color: SEMANTIC.textPrimary,
        fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
        padding: '22px 30px 18px',
        letterSpacing: '-0.01em',
        overflow: 'hidden',
      }}
    >
      {/* Extract modal overlay */}
      {showExtractModal && renderExtractModal()}

      {/* ================================================================ */}
      {/* HEADER                                                           */}
      {/* ================================================================ */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          gap: 24,
          flexShrink: 0,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 9 }}>
            <div
              style={{
                width: 9,
                height: 9,
                borderRadius: 2,
                background: 'oklch(0.80 0.12 165)',
                boxShadow: '0 0 12px oklch(0.74 0.12 165 / 0.7)',
                flexShrink: 0,
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
              会话上下文本体建模
            </span>
          </div>
          <h1 style={{ margin: 0, fontSize: 25, fontWeight: 600, lineHeight: 1.1, letterSpacing: '-0.025em' }}>
            上下文实体关系知识图谱
          </h1>
          <p style={{ margin: '8px 0 0', fontSize: 13, lineHeight: 1.6, color: SEMANTIC.textDesc, maxWidth: 660 }}>
            仅从用户消息与模型回复的
            <strong style={{ color: 'oklch(0.84 0.01 265)', fontWeight: 600 }}>自然语义信息</strong>
            中抽取实体与关系（聚焦主题、做法、原因、教训、经验法则与工具技巧）；随对话推进持续演化，并对同义/冲突实体做消歧。
          </p>
        </div>

        {/* Navigation pills */}
        <div style={{ display: 'flex', gap: 9, fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, alignItems: 'center' }}>
          <a
            href="#"
            onClick={(e) => { e.preventDefault(); setPage('home'); }}
            style={{
              textDecoration: 'none', border: `1px solid ${SEMANTIC.borderColor}`, borderRadius: 9,
              padding: '9px 13px', color: SEMANTIC.textSecondary,
              background: SEMANTIC.innerCardBg,
            }}
          >
            ← 首页
          </a>
          <span
            style={{
              border: '1px solid oklch(0.45 0.09 165)', borderRadius: 9,
              padding: '9px 13px', color: 'oklch(0.82 0.10 165)',
              background: 'oklch(0.74 0.12 165 / 0.12)',
            }}
          >
            本体建模
          </span>
          <a
            href="#"
            onClick={(e) => { e.preventDefault(); setPage('inspector'); }}
            style={{
              textDecoration: 'none', border: `1px solid ${SEMANTIC.borderColor}`, borderRadius: 9,
              padding: '9px 13px', color: SEMANTIC.textSecondary,
              background: SEMANTIC.innerCardBg,
            }}
          >
            逐轮检查
          </a>
        </div>
      </header>

      {/* 提取进度条（modal 关闭后缩至顶部） */}
      {(extractPhase !== 'idle' || extractError) && !showExtractModal && (
        <div
          onClick={() => setShowExtractModal(true)}
          style={{
            flexShrink: 0,
            marginTop: 10,
            padding: '10px 16px',
            borderRadius: 10,
            border: '1px solid oklch(0.45 0.09 165 / 0.45)',
            background: 'oklch(0.74 0.12 165 / 0.08)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
          }}
        >
          <span style={{ fontSize: 13, flexShrink: 0 }}>🤖</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: 'oklch(0.84 0.10 165)', fontFamily: "'IBM Plex Mono', monospace", marginBottom: 4 }}>
              {extractPhase === 'idle' && extractError
                ? `提取未完成 ${extractProgress.shardsCompleted}/${extractProgress.shardsTotal}`
                : extractPhase === 'extracting'
                ? `提取中 ${extractProgress.shardsCompleted}/${extractProgress.shardsTotal}`
                : extractPhase === 'merging' ? '合并分片结果...' : '构建知识图谱...'}
            </div>
            <ProgressBar height={3} marginBottom={0} pct={
              extractPhase === 'extracting' && extractProgress.shardsTotal > 0
                ? Math.round((extractProgress.shardsCompleted / extractProgress.shardsTotal) * 100)
                : extractPhase === 'extracting' ? 0 : extractProgress.shardsTotal > 0 ? Math.round((extractProgress.shardsCompleted / extractProgress.shardsTotal) * 100) : 100
            } />
          </div>
          {extractError && (
            <span style={{ fontSize: 11, color: 'oklch(0.76 0.13 45)', flexShrink: 0, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {extractError}
            </span>
          )}
          <span style={{ fontSize: 10, color: 'oklch(0.52 0.04 165)', flexShrink: 0 }}>点击展开 ▸</span>
        </div>
      )}

      {renderBody()}

      {/* ================================================================ */}
      {/* FOOTER                                                            */}
      {/* ================================================================ */}
      <footer
        style={{
          flexShrink: 0,
          marginTop: 12,
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 10,
          color: 'oklch(0.44 0.012 265)',
          lineHeight: 1.5,
        }}
      >
        实体/关系由模型从会话内容抽取 · 置信度反映抽取确定性（复现频次/表述明确度）· 时间轴按实体首次出现轮次回放
      </footer>
    </div>
  );
}
