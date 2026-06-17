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
  const fetchOntology = useSessionStore((s) => s.fetchOntology);
  const currentSessionId = useSessionStore((s) => s.currentSessionId);

  // Refs
  const playRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recenterRef = useRef(0);

  // ─── Data loading ──────────────────────────────────────────────────────

  useEffect(() => {
    if (currentSessionId && !ontologyData && !ontologyLoading && !ontologyError) {
      fetchOntology();
    }
  }, [currentSessionId, ontologyData, ontologyLoading, ontologyError, fetchOntology]);

  // Reset error when session changes so we retry for a new session
  useEffect(() => {
    // error state auto-clears on next fetchOntology call; no explicit reset needed
  }, [currentSessionId]);

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

  // ─── Loading / Error / Empty states ────────────────────────────────────

  if (ontologyLoading) {
    return (
      <div style={{ textAlign: 'center', padding: '120px 20px', color: SEMANTIC.textMuted, fontSize: 15 }}>
        正在加载本体数据...
      </div>
    );
  }

  if (ontologyError) {
    return (
      <div style={{ textAlign: 'center', padding: '120px 20px', color: 'oklch(0.76 0.13 45)', fontSize: 15 }}>
        加载本体数据失败: {ontologyError}
      </div>
    );
  }

  if (!ontologyData) {
    return (
      <div style={{ textAlign: 'center', padding: '120px 20px', color: SEMANTIC.textMuted, fontSize: 14, lineHeight: 1.8 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, color: SEMANTIC.textPrimary, marginBottom: 12 }}>
          暂无本体数据
        </h2>
        <p>本体数据需要从会话中通过语义抽取生成，目前尚未上传。</p>
        <p style={{ marginTop: 8 }}>
          可通过 <code style={{ fontFamily: "'IBM Plex Mono', monospace", background: SEMANTIC.innerCardBg, padding: '2px 6px', borderRadius: 4 }}>
            POST /api/sessions/{currentSessionId}/ontology
          </code> 接口上传。
        </p>
      </div>
    );
  }

  // ─── Render ────────────────────────────────────────────────────────────

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
            onClick={(e) => { e.preventDefault(); setPage('inspector'); }}
            style={{
              textDecoration: 'none', border: `1px solid ${SEMANTIC.borderColor}`, borderRadius: 9,
              padding: '9px 13px', color: SEMANTIC.textSecondary,
              background: SEMANTIC.innerCardBg,
            }}
          >
            逐轮检查
          </a>
          <a
            href="#"
            onClick={(e) => { e.preventDefault(); setPage('assembly'); }}
            style={{
              textDecoration: 'none', border: `1px solid ${SEMANTIC.borderColor}`, borderRadius: 9,
              padding: '9px 13px', color: SEMANTIC.textSecondary,
              background: SEMANTIC.innerCardBg,
            }}
          >
            峰值透视
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
        </div>
      </header>

      {/* ================================================================ */}
      {/* TOOLBAR                                                          */}
      {/* ================================================================ */}
      <OntologyToolbar
        types={ontologyData.types}
        nodes={ontologyData.nodes}
        activeTypes={activeTypes}
        turn={turn}
        maxTurn={maxTurn}
        playing={playing}
        onToggleType={onToggleType}
        onSetTurn={onSetTurn}
        onTogglePlay={onTogglePlay}
        onRecenter={onRecenter}
      />

      {/* ================================================================ */}
      {/* MAIN: graph + detail                                             */}
      {/* ================================================================ */}
      <div
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: '1fr 350px',
          gap: 16,
          marginTop: 16,
          minHeight: 0,
        }}
      >
        {/* Graph area */}
        <div
          style={{
            position: 'relative',
            border: `1px solid ${SEMANTIC.borderColor}`,
            borderRadius: 16,
            background: 'oklch(0.17 0.008 265 / 0.6)',
            overflow: 'hidden',
          }}
        >
          <OntologyGraph
            data={ontologyData}
            selectedNodeId={selectedOntologyNode}
            turn={turn}
            activeTypes={activeTypes}
            onSelectNode={setSelectedOntologyNode}
            recenterKey={recenterKey}
          />
          {/* Graph stats overlay */}
          <div
            style={{
              position: 'absolute',
              left: 14,
              bottom: 12,
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 10,
              color: 'oklch(0.46 0.012 265)',
              pointerEvents: 'none',
              lineHeight: 1.5,
            }}
          >
            拖拽节点 · 滚轮缩放 · 拖拽空白平移 · 点击节点看详情
          </div>
          <div
            style={{
              position: 'absolute',
              right: 14,
              top: 12,
              display: 'flex',
              gap: 14,
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              color: SEMANTIC.textMuted2,
              pointerEvents: 'none',
            }}
          >
            <span>
              <span style={{ color: SEMANTIC.textPrimary6, fontWeight: 600 }}>{visibleCounts.nodes}</span> 实体
            </span>
            <span>
              <span style={{ color: SEMANTIC.textPrimary6, fontWeight: 600 }}>{visibleCounts.edges}</span> 关系
            </span>
          </div>
        </div>

        {/* Detail panel */}
        <OntologyDetailPanel
          data={ontologyData}
          selectedNodeId={selectedOntologyNode}
          turn={turn}
          activeTypes={activeTypes}
          degree={degree}
          onSelectNode={setSelectedOntologyNode}
          onClearSelection={() => setSelectedOntologyNode(null)}
          onJumpToTurn={onJumpToTurn}
        />
      </div>

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
