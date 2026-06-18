import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSessionStore } from '../../store/sessionStore';
import { useUIStore } from '../../store/uiStore';
import { SEMANTIC } from '../../styles/theme';
import OntologyGraph from './OntologyGraph';
import OntologyToolbar from './OntologyToolbar';
import OntologyDetailPanel from './OntologyDetailPanel';

// ─── Component ──────────────────────────────────────────────────────────────

export default function OntologyPage() {
  // Local state
  const [turn, setTurn] = useState(31);
  const [activeTypes, setActiveTypes] = useState<Record<string, boolean>>({});
  const [playing, setPlaying] = useState(false);
  const [recenterKey, setRecenterKey] = useState(0);

  // Stores
  const selectedOntologyNode = useUIStore((s) => s.selectedOntologyNode);
  const setSelectedOntologyNode = useUIStore((s) => s.setSelectedOntologyNode);
  const setPage = useUIStore((s) => s.setPage);
  const ontologyData = useSessionStore((s) => s.ontologyData);
  const ontologyLoading = useSessionStore((s) => s.ontologyLoading);
  const ontologyError = useSessionStore((s) => s.ontologyError);
  const ontologyFetched = useSessionStore((s) => s.ontologyFetched);
  const fetchOntology = useSessionStore((s) => s.fetchOntology);
  const buildOntology = useSessionStore((s) => s.buildOntology);
  const extractOntology = useSessionStore((s) => s.extractOntology);
  const extractPhase = useSessionStore((s) => s.extractPhase);
  const extractProgress = useSessionStore((s) => s.extractProgress);
  const extractError = useSessionStore((s) => s.extractError);
  const currentSessionId = useSessionStore((s) => s.currentSessionId);

  // Build form state
  const [buildJson, setBuildJson] = useState('');
  const [buildExpanded, setBuildExpanded] = useState(false);
  const [buildMsg, setBuildMsg] = useState<string | null>(null);
  const [buildErr, setBuildErr] = useState<string | null>(null);

  // Auto-extract state
  const [shardSize, setShardSize] = useState(50);
  const [overlap, setOverlap] = useState(5);
  const [showExtractModal, setShowExtractModal] = useState(false);
  const [extractMode, setExtractMode] = useState<'full' | 'incremental'>('full');

  const handleStartExtract = useCallback(async (mode: 'full' | 'incremental') => {
    const fromTurn = mode === 'incremental' && ontologyData
      ? Math.max(...ontologyData.nodes.map(n => n.firstTurn), 0)
      : 0;
    setExtractMode(mode);
    await extractOntology({ shardSize, overlap, fromTurn });
  }, [extractOntology, shardSize, overlap, ontologyData]);

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

  // Reset error when session changes so we retry for a new session
  // (handled by selectSession clearing ontologyFetched)

  // Initialize activeTypes when data arrives
  useEffect(() => {
    if (ontologyData) {
      const at: Record<string, boolean> = {};
      ontologyData.types.forEach((t) => (at[t.key] = true));
      setActiveTypes((prev) => (Object.keys(prev).length === 0 ? at : prev));

      // Set turn to max
      const maxT = Math.max(...ontologyData.nodes.map((n) => n.firstTurn), 1);
      setTurn((prev) => (prev === 31 ? maxT : prev));
    }
  }, [ontologyData]);

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
    if (!ontologyData) return 31;
    return Math.max(...ontologyData.nodes.map((n) => n.firstTurn), 1);
  }, [ontologyData]);

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

  // ─── Callbacks ─────────────────────────────────────────────────────────

  const onToggleType = useCallback((key: string) => {
    setActiveTypes((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const onSetTurn = useCallback((t: number) => setTurn(t), []);

  const onTogglePlay = useCallback(() => {
    if (playing) {
      if (playRef.current) { clearInterval(playRef.current); playRef.current = null; }
      setPlaying(false);
      return;
    }
    setPlaying(true);
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

  const onJumpToTurn = useCallback((t: number) => setTurn(t), []);

  // ─── Render: always show page shell with header/nav ─────────────────────

  const tryBuild = async () => {
    setBuildMsg(null); setBuildErr(null);
    try {
      const parsed = JSON.parse(buildJson);
      if (!parsed.candidates || !parsed.relations) {
        setBuildErr('JSON 必须包含 candidates 和 relations 数组');
        return;
      }
      setBuildMsg('构建中...');
      const ok = await buildOntology(parsed);
      if (ok) {
        setBuildMsg('构建成功！图谱已保存。');
        setBuildJson('');
        setBuildExpanded(false);
      } else {
        setBuildErr('构建失败，请检查控制台');
      }
    } catch (e) {
      setBuildErr(e instanceof SyntaxError ? 'JSON 格式错误: ' + e.message : String(e));
    }
  };

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
          <p>本体数据需要从会话内容中通过语义抽取生成。两种方式提供数据：</p>
          <ol style={{ paddingInlineStart: 20, margin: '8px 0' }}>
            <li>🤖 自动提取（推荐）：由 LLM 自动从会话内容中抽取实体和关系</li>
            <li>直接上传已构建好的 <code style={{ fontFamily: "'IBM Plex Mono', monospace", background: SEMANTIC.innerCardBg, padding: '2px 6px', borderRadius: 4 }}>OntologyData</code> JSON（POST /:id/ontology）</li>
            <li>通过下面的构建管线，提供候选实体 + 语义关系，自动过滤/消歧/组装</li>
          </ol>

          {/* ── Auto-extract card ──────────────────────────────────────────── */}
          <div style={{ marginTop: 20, border: '1px solid oklch(0.45 0.09 165 / 0.45)', borderRadius: 12, background: 'oklch(0.74 0.12 165 / 0.06)', overflow: 'hidden' }}>
            <div style={{ padding: '16px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 16 }}>🤖</span>
                <span style={{ fontSize: 15, fontWeight: 600, color: 'oklch(0.84 0.10 165)' }}>自动提取</span>
              </div>
              <p style={{ margin: '0 0 12px', fontSize: 12.5, color: 'oklch(0.60 0.03 165)', lineHeight: 1.6 }}>
                从会话内容中自动抽取实体和关系。系统将对话按轮次分片，并行调用 LLM 并实时返回进度。
              </p>

              {/* Params */}
              <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: SEMANTIC.textSecondary }}>
                  分片大小
                  <input type="number" value={shardSize} min={10} max={200}
                    onChange={(e) => setShardSize(Number(e.target.value) || 50)}
                    disabled={extractPhase !== 'idle'}
                    style={{ width: 58, padding: '4px 6px', borderRadius: 6, border: `1px solid ${SEMANTIC.borderColor}`, background: SEMANTIC.innerCardBg, color: SEMANTIC.textPrimary, fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, textAlign: 'center' }} />
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: SEMANTIC.textSecondary }}>
                  重叠
                  <input type="number" value={overlap} min={0} max={50}
                    onChange={(e) => setOverlap(Number(e.target.value) || 5)}
                    disabled={extractPhase !== 'idle'}
                    style={{ width: 58, padding: '4px 6px', borderRadius: 6, border: `1px solid ${SEMANTIC.borderColor}`, background: SEMANTIC.innerCardBg, color: SEMANTIC.textPrimary, fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, textAlign: 'center' }} />
                </label>
              </div>

              {/* Start button */}
              <button onClick={() => handleStartExtract('full')}
                disabled={extractPhase !== 'idle' || ontologyLoading}
                style={{
                  padding: '9px 20px', borderRadius: 8, cursor: extractPhase === 'idle' ? 'pointer' : 'default',
                  border: '1px solid oklch(0.45 0.09 165)', fontFamily: "'IBM Plex Mono', monospace",
                  background: 'oklch(0.74 0.12 165 / 0.16)', color: 'oklch(0.84 0.10 165)',
                  fontSize: 12.5, opacity: extractPhase === 'idle' ? 1 : 0.5,
                  transition: 'opacity .15s',
                }}>
                {extractPhase === 'idle' ? '▶ 开始自动提取' : extractPhase === 'extracting' ? '提取中...' : extractPhase === 'merging' ? '合并中...' : '构建中...'}
              </button>

              {/* ── Progress ──────────────────────────────────────────────────── */}
              {extractPhase !== 'idle' && (
                <div style={{ marginTop: 14 }}>
                  {/* Phase text */}
                  <div style={{ fontSize: 12, color: 'oklch(0.70 0.06 165)', marginBottom: 8, fontFamily: "'IBM Plex Mono', monospace" }}>
                    {extractPhase === 'extracting'
                      ? `正在提取实体 (${extractProgress.shardsCompleted}/${extractProgress.shardsTotal} 分片)`
                      : extractPhase === 'merging'
                        ? '正在合并分片结果...'
                        : '正在构建知识图谱...'}
                  </div>

                  {/* Progress bar */}
                  {extractPhase === 'extracting' && extractProgress.shardsTotal > 0 && (
                    <div style={{ height: 5, borderRadius: 3, background: 'oklch(0.24 0.012 265)', overflow: 'hidden', marginBottom: 10 }}>
                      <div style={{
                        height: '100%', borderRadius: 3,
                        width: `${Math.round((extractProgress.shardsCompleted / extractProgress.shardsTotal) * 100)}%`,
                        background: 'oklch(0.74 0.12 165)',
                        transition: 'width .3s ease',
                      }} />
                    </div>
                  )}

                  {/* Shard details */}
                  {extractProgress.shardDetails.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 180, overflowY: 'auto' }}>
                      {extractProgress.shardDetails.map((s) => (
                        <div key={s.index} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, fontFamily: "'IBM Plex Mono', monospace" }}>
                          <span style={{ flexShrink: 0 }}>
                            {s.status === 'done' ? '✓' : s.status === 'running' ? '⏳' : s.status === 'error' ? '✗' : '○'}
                          </span>
                          <span style={{ color: s.status === 'error' ? 'oklch(0.76 0.13 45)' : s.status === 'done' ? 'oklch(0.78 0.12 150)' : 'oklch(0.58 0.012 265)', minWidth: 52 }}>
                            分片 {s.index + 1}
                          </span>
                          {s.status === 'done' && (
                            <span style={{ color: SEMANTIC.textMuted }}>
                              {s.candidates} 实体 · {s.relations} 关系
                            </span>
                          )}
                          {s.status === 'running' && (
                            <span style={{ color: SEMANTIC.textMuted }}>调用 LLM...</span>
                          )}
                          {s.status === 'error' && (
                            <span style={{ color: 'oklch(0.66 0.12 45)' }}>{s.error || '失败'}</span>
                          )}
                          {s.status === 'pending' && (
                            <span style={{ color: SEMANTIC.textMuted }}>等待中</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Error */}
                  {extractError && (
                    <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: 'oklch(0.66 0.17 25 / 0.12)', border: '1px solid oklch(0.66 0.17 25 / 0.3)', fontSize: 12, color: 'oklch(0.76 0.13 45)', lineHeight: 1.5 }}>
                      ❌ {extractError}
                      <button onClick={handleStartExtract}
                        style={{ marginLeft: 10, padding: '3px 10px', borderRadius: 6, border: '1px solid oklch(0.76 0.13 45 / 0.5)', background: 'transparent', color: 'oklch(0.76 0.13 45)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11 }}>
                        重试
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div style={{ marginTop: 24, border: `1px solid ${SEMANTIC.borderColor}`, borderRadius: 12, background: SEMANTIC.cardBg, overflow: 'hidden' }}>
            <button onClick={() => setBuildExpanded(!buildExpanded)}
              style={{ width: '100%', textAlign: 'left', border: 'none', padding: '14px 18px', background: 'transparent', color: SEMANTIC.textPrimary, cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              通过构建管线生成（粘贴候选 JSON）
              <span style={{ fontSize: 11, color: SEMANTIC.textMuted, fontWeight: 400 }}>{buildExpanded ? '收起 ▲' : '展开 ▼'}</span>
            </button>
            {buildExpanded && (
              <div style={{ padding: '0 18px 18px' }}>
                <p style={{ margin: '0 0 10px', fontSize: 12, color: SEMANTIC.textDesc3 }}>粘贴包含 <code>candidates</code>、<code>relations</code> 和可选 <code>config</code> 的 JSON。</p>
                <textarea value={buildJson} onChange={(e) => setBuildJson(e.target.value)}
                  placeholder='{"candidates": [...], "relations": [...], "config": {...}}' rows={8}
                  style={{ width: '100%', background: 'oklch(0.19 0.01 265)', color: SEMANTIC.textPrimary, border: `1px solid ${SEMANTIC.borderColor}`, borderRadius: 8, padding: 12, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11.5, resize: 'vertical', lineHeight: 1.5 }} />
                <button onClick={tryBuild} disabled={!buildJson.trim() || ontologyLoading}
                  style={{ marginTop: 10, padding: '9px 18px', borderRadius: 8, cursor: 'pointer', border: '1px solid oklch(0.45 0.09 165)', background: 'oklch(0.74 0.12 165 / 0.14)', color: 'oklch(0.84 0.10 165)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, opacity: buildJson.trim() ? 1 : 0.4 }}>
                  {ontologyLoading ? '构建中...' : '▶ 构建图谱'}
                </button>
                {buildMsg && <div style={{ marginTop: 8, fontSize: 12, color: 'oklch(0.78 0.12 150)' }}>{buildMsg}</div>}
                {buildErr && <div style={{ marginTop: 8, fontSize: 12, color: 'oklch(0.76 0.13 45)' }}>{buildErr}</div>}
              </div>
            )}
          </div>
        </div>
      );
    }
    // Main graph view
    return (
      <>
        <OntologyToolbar
          types={ontologyData.types} nodes={ontologyData.nodes} activeTypes={activeTypes}
          turn={turn} maxTurn={maxTurn} playing={playing}
          onToggleType={onToggleType} onSetTurn={onSetTurn} onTogglePlay={onTogglePlay} onRecenter={onRecenter}
          onUpdate={() => openExtractModal('incremental')}
          onRebuild={() => openExtractModal('full')}
        />
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 350px', gap: 16, marginTop: 16, minHeight: 0 }}>
          <div style={{ position: 'relative', border: `1px solid ${SEMANTIC.borderColor}`, borderRadius: 16, background: 'oklch(0.17 0.008 265 / 0.6)', overflow: 'hidden' }}>
            <OntologyGraph data={ontologyData} selectedNodeId={selectedOntologyNode} turn={turn} activeTypes={activeTypes} onSelectNode={setSelectedOntologyNode} recenterKey={recenterKey} />
            <div style={{ position: 'absolute', left: 14, bottom: 12, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'oklch(0.46 0.012 265)', pointerEvents: 'none', lineHeight: 1.5 }}>
              拖拽节点 · 滚轮缩放 · 拖拽空白平移 · 点击节点看详情
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
          />
        </div>
      </>
    );
  };

  // ─── Extract modal ──────────────────────────────────────────────────────

  const renderExtractModal = () => (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'oklch(0.10 0.006 265 / 0.74)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 26 }}
      onClick={() => { if (extractPhase === 'idle') setShowExtractModal(false); }}>
      <div style={{ width: 'min(600px, 96vw)', background: 'oklch(0.155 0.008 265)', border: '1px solid oklch(0.36 0.014 265)', borderRadius: 18, overflow: 'hidden', boxShadow: '0 34px 90px oklch(0 0 0 / 0.6)' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '13px 18px', borderBottom: '1px solid oklch(0.28 0.012 265)', background: 'oklch(0.185 0.009 265)' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'oklch(0.91 0.01 265)' }}>
            {extractMode === 'incremental' ? '🔄 增量更新本体' : '🆕 重建本体'}
          </span>
          <button onClick={() => setShowExtractModal(false)} disabled={extractPhase !== 'idle'}
            style={{ border: '1px solid oklch(0.32 0.014 265)', borderRadius: 8, width: 30, height: 30, background: 'oklch(0.22 0.01 265)', color: 'oklch(0.82 0.01 265)', cursor: 'pointer', fontSize: 14 }}>✕</button>
        </div>
        <div style={{ padding: '20px 18px' }}>
          <p style={{ margin: '0 0 16px', fontSize: 13, color: SEMANTIC.textDesc3 }}>
            {extractMode === 'incremental'
              ? `仅提取第 ${ontologyData ? Math.max(...ontologyData.nodes.map(n => n.firstTurn), 0) : 0} 轮之后的新增内容，保留已有实体。`
              : '清空已有数据，从零重新提取全部实体和关系。'}
          </p>
          <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: SEMANTIC.textSecondary }}>
              分片大小 <input type="number" value={shardSize} min={10} max={200}
                onChange={e => setShardSize(Number(e.target.value) || 50)} disabled={extractPhase !== 'idle'}
                style={{ width: 58, padding: '4px 6px', borderRadius: 6, border: `1px solid ${SEMANTIC.borderColor}`, background: SEMANTIC.innerCardBg, color: SEMANTIC.textPrimary, fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, textAlign: 'center' }} />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: SEMANTIC.textSecondary }}>
              重叠 <input type="number" value={overlap} min={0} max={50}
                onChange={e => setOverlap(Number(e.target.value) || 5)} disabled={extractPhase !== 'idle'}
                style={{ width: 58, padding: '4px 6px', borderRadius: 6, border: `1px solid ${SEMANTIC.borderColor}`, background: SEMANTIC.innerCardBg, color: SEMANTIC.textPrimary, fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, textAlign: 'center' }} />
            </label>
          </div>
          <button onClick={() => handleStartExtract(extractMode)} disabled={extractPhase !== 'idle'}
            style={{ padding: '10px 24px', borderRadius: 8, cursor: 'pointer', border: '1px solid oklch(0.45 0.09 165)', background: 'oklch(0.74 0.12 165 / 0.16)', color: 'oklch(0.84 0.10 165)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, opacity: extractPhase === 'idle' ? 1 : 0.5 }}>
            ▶ 开始提取
          </button>
          {extractPhase !== 'idle' && (
            <div style={{ marginTop: 12, fontSize: 12, color: 'oklch(0.70 0.06 165)', fontFamily: "'IBM Plex Mono', monospace" }}>
              进度: {extractProgress.shardsCompleted}/{extractProgress.shardsTotal} 分片
            </div>
          )}
          {extractError && (
            <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, background: 'oklch(0.66 0.17 25 / 0.12)', fontSize: 12, color: 'oklch(0.76 0.13 45)' }}>
              ❌ {extractError}
            </div>
          )}
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
            中抽取实体与关系（聚焦机制概念、Agent 与系统，过滤错误/函数/代码等技术工件）；随对话推进持续演化，并对同义/冲突实体做消歧。
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
