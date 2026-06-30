import React, { useEffect, useMemo, useState } from 'react';
import { SEMANTIC } from '../../styles/theme';
import type { OntologyData, OntologyNode, OntologyEvidence } from '../../types/ontology';
import { sortOntologyTypes } from './typeOrder';
import { get, post, put } from '../../api/client';
import { MarkdownBlock } from '../shared/MarkdownBlock';

interface OntologyDetailPanelProps {
  data: OntologyData;
  selectedNodeId: string | null;
  turn: number;
  activeTypes: Record<string, boolean>;
  degree: Record<string, number>;
  onSelectNode: (id: string | null) => void;
  onClearSelection: () => void;
  onJumpToTurn: (turn: number) => void;
  sessionId: string | null;
}

type SummaryStatus = 'not_started' | 'running' | 'done' | 'error';

interface CardSummaryStatus {
  topicId: string;
  status: SummaryStatus;
  summary: string | null;
  error: string | null;
  updatedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

interface ObsidianConfigStatus {
  vaultPath: string | null;
  notesDir: string;
  filenameTemplate: string;
  configured: boolean;
  error: string | null;
}

interface ObsidianSyncStatus {
  topicId: string;
  configured: boolean;
  status: 'not_synced' | 'synced' | 'error';
  notePath: string | null;
  error: string | null;
  lastSyncedAt: string | null;
  updatedAt?: string | null;
  skipped?: boolean;
}

function confColor(c: number): string {
  if (c >= 0.85) return 'oklch(0.78 0.12 150)';
  if (c >= 0.7) return 'oklch(0.80 0.11 95)';
  return 'oklch(0.76 0.13 45)';
}

function sourceLabel(source: string): string {
  if (source === 'user') return '用户';
  if (source === 'reply') return '回复';
  if (source === 'tool_summary') return '工具摘要';
  if (source === 'reasoning_summary') return '推理摘要';
  return source;
}

function sortedEvidence(evidence: OntologyEvidence[]): OntologyEvidence[] {
  return [...evidence].sort((a, b) => a.turn - b.turn || b.weight - a.weight || a.source.localeCompare(b.source));
}

function statusLabel(status?: string): { label: string; color: string } {
  if (status === 'confirmed') return { label: '已确认', color: 'oklch(0.78 0.12 150)' };
  if (status === 'needs_confirmation') return { label: '待确认', color: 'oklch(0.78 0.13 45)' };
  return { label: '推断', color: 'oklch(0.74 0.10 210)' };
}

function buildConfidenceNotes(node: OntologyNode, evidence: OntologyEvidence[]): string[] {
  const sourceCounts = evidence.reduce<Record<string, number>>((acc, ev) => {
    acc[ev.source] = (acc[ev.source] || 0) + 1;
    return acc;
  }, {});
  const sourceText = Object.entries(sourceCounts)
    .map(([source, count]) => `${sourceLabel(source)}${count}`)
    .join(' · ');
  const notes: string[] = [
    sourceText ? `证据来源：${sourceText}` : '证据来源：无直接证据，按低可信推断处理',
    `复现程度：出现于 ${node.turns.length} 轮，首现第 ${node.firstTurn} 轮`,
  ];

  const hasPrimary = evidence.some((ev) => ev.source === 'user' || ev.source === 'reply');
  const reasoningOnly = evidence.length > 0 && evidence.every((ev) => ev.source === 'reasoning_summary');
  const toolOnly = evidence.length > 0 && evidence.every((ev) => ev.source === 'tool_summary');
  if (reasoningOnly) {
    notes.push('封顶规则：仅由推理摘要支撑，最高按 55% 处理');
  } else if (toolOnly) {
    notes.push('封顶规则：仅由工具摘要支撑，最高按 65% 处理');
  } else if (!hasPrimary) {
    notes.push('封顶规则：缺少用户/回复主证据，按补充证据处理');
  } else {
    notes.push('主证据：包含用户输入或模型回复，可进入已确认区间');
  }

  if (node.snippetQuality === 'low') {
    notes.push('片段质量：原文片段与节点标签匹配较弱，已降低权重');
  } else {
    notes.push('片段质量：原文片段可用于支撑该节点');
  }

  return notes;
}

function getCardNodes(topic: OntologyNode, data: OntologyData): OntologyNode[] {
  const aggregateNodes = topic.aggregateId
    ? data.nodes.filter((n) => n.aggregateId === topic.aggregateId)
    : [];
  if (aggregateNodes.length > 0) return aggregateNodes;

  const relatedIds = new Set<string>([topic.id]);
  data.edges.forEach((e) => {
    if (e.s === topic.id) relatedIds.add(e.t);
    if (e.t === topic.id) relatedIds.add(e.s);
  });
  return data.nodes.filter((n) => relatedIds.has(n.id));
}

// ─── Empty State ────────────────────────────────────────────────────────────

function EmptyState({
  data,
  degree,
  onSelectNode,
}: {
  data: OntologyData;
  degree: Record<string, number>;
  onSelectNode: (id: string | null) => void;
}) {
  // Count per type
  const counts: Record<string, number> = {};
  data.types.forEach((t) => (counts[t.key] = 0));
  data.nodes.forEach((n) => (counts[n.type] = (counts[n.type] || 0) + 1));

  // Hub entities by degree
  const hubs = [...data.nodes]
    .sort((a, b) => (degree[b.id] || 0) - (degree[a.id] || 0))
    .slice(0, 7);

  return (
    <div>
      {/* Legend */}
      <h2 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 600, color: SEMANTIC.textPrimary }}>
        图例 · 实体类型
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
        {sortOntologyTypes(data.types).map((t) => (
          <div key={t.key} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 12.5 }}>
            <span
              style={{ width: 11, height: 11, borderRadius: '50%', background: t.color, flexShrink: 0 }}
            />
            <span style={{ flex: 1, color: 'oklch(0.82 0.01 265)' }}>{t.label}</span>
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: SEMANTIC.textMuted }}>
              {counts[t.key] || 0}
            </span>
          </div>
        ))}
      </div>

      {/* Hub entities */}
      <h2 style={{ margin: '0 0 9px', fontSize: 14, fontWeight: 600, color: SEMANTIC.textPrimary }}>
        核心枢纽实体
      </h2>
      <p style={{ margin: '0 0 11px', fontSize: 11.5, color: SEMANTIC.textDesc4, lineHeight: 1.5 }}>
        关联最多的实体 —— 点击在图中聚焦。
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {hubs.map((n) => (
          <button
            key={n.id}
            onClick={() => onSelectNode(n.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              border: '1px solid oklch(0.26 0.012 265)',
              borderRadius: 9,
              padding: '8px 10px',
              background: SEMANTIC.innerCardBg,
              cursor: 'pointer',
              fontFamily: 'inherit',
              textAlign: 'left' as const,
              width: '100%',
              color: 'inherit',
            }}
          >
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: '50%',
                background: data.types.find((t) => t.key === n.type)?.color || 'oklch(0.6 0 0)',
                flexShrink: 0,
              }}
            />
            <span style={{ flex: 1, fontSize: 12.5, color: SEMANTIC.textPrimary6 }}>{n.label}</span>
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: SEMANTIC.textMuted }}>
              {degree[n.id] || 0} 连
            </span>
          </button>
        ))}
      </div>

      {/* Disambiguation footnote */}
      <div style={{ marginTop: 18, borderTop: `1px solid ${SEMANTIC.borderSubtle2}`, paddingTop: 13, fontSize: 11.5, color: SEMANTIC.textMuted, lineHeight: 1.6 }}>
        <span style={{ color: 'oklch(0.78 0.10 60)' }}>◆</span> 标「消歧」的实体表示对话中出现过同义混淆或假设修正，已合并/澄清。
      </div>
    </div>
  );
}

// ─── Selected Entity State ──────────────────────────────────────────────────

function SelectedEntity({
  node,
  typeColor,
  typeLabel,
  data,
  turn,
  activeTypes,
  degree,
  onSelectNode,
  onClearSelection,
  onJumpToTurn,
  sessionId,
}: {
  node: OntologyNode;
  typeColor: string;
  typeLabel: string;
  data: OntologyData;
  turn: number;
  activeTypes: Record<string, boolean>;
  degree: Record<string, number>;
  onSelectNode: (id: string | null) => void;
  onClearSelection: () => void;
  onJumpToTurn: (turn: number) => void;
  sessionId: string | null;
}) {
  const [summaryStatus, setSummaryStatus] = useState<CardSummaryStatus>({
    topicId: node.id,
    status: 'not_started',
    summary: null,
    error: null,
    updatedAt: null,
    startedAt: null,
    completedAt: null,
  });
  const [summaryChecking, setSummaryChecking] = useState(false);
  const [summaryEditing, setSummaryEditing] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState('');
  const [summarySaving, setSummarySaving] = useState(false);
  const [summarySaveError, setSummarySaveError] = useState<string | null>(null);
  const [obsidianStatus, setObsidianStatus] = useState<ObsidianSyncStatus>({
    topicId: node.id,
    configured: false,
    status: 'not_synced',
    notePath: null,
    error: null,
    lastSyncedAt: null,
  });
  const [obsidianConfig, setObsidianConfig] = useState<ObsidianConfigStatus | null>(null);
  const [obsidianConfigOpen, setObsidianConfigOpen] = useState(false);
  const [obsidianVaultPath, setObsidianVaultPath] = useState('');
  const [obsidianNotesDir, setObsidianNotesDir] = useState('LLM知识卡片');
  const [obsidianBusy, setObsidianBusy] = useState(false);
  const [obsidianError, setObsidianError] = useState<string | null>(null);
  const c = node.conf;
  const cfColor = confColor(c);
  const st = statusLabel(node.status);
  const orderedEvidence = useMemo(() => sortedEvidence(node.evidence || []), [node.evidence]);
  const evidenceTurnCount = new Set(orderedEvidence.map((ev) => ev.turn)).size;
  const confidenceNotes = useMemo(() => buildConfidenceNotes(node, orderedEvidence), [node, orderedEvidence]);
  const cardNodes = useMemo(() => getCardNodes(node, data), [node, data]);
  const cardEdges = useMemo(() => {
    const ids = new Set(cardNodes.map((n) => n.id));
    return data.edges.filter((e) => ids.has(e.s) && ids.has(e.t));
  }, [cardNodes, data.edges]);
  const summaryNodeCount = Math.max(0, cardNodes.length - 1);
  const summaryRunning = summaryStatus.status === 'running';
  const summaryDone = summaryStatus.status === 'done' && Boolean(summaryStatus.summary);
  const summaryFailed = summaryStatus.status === 'error';
  const summaryLabel = summaryRunning
    ? '知识总结 总结中'
    : summaryDone
      ? '知识总结 已总结'
      : summaryFailed
        ? '知识总结 总结失败'
        : '知识总结 未总结';
  const summaryHint = summaryFailed
    ? `点击再次总结 ${summaryNodeCount}节点`
    : summaryDone || summaryRunning
      ? `${summaryNodeCount}节点`
      : `点击进行总结 ${summaryNodeCount}节点`;

  const loadSummaryStatus = async () => {
    if (!sessionId || node.type !== 'topic') return;
    setSummaryChecking(true);
    try {
      const result = await get<CardSummaryStatus>(`/sessions/${sessionId}/ontology/summarize-card/${encodeURIComponent(node.id)}`);
      setSummaryStatus(result);
    } catch (err) {
      setSummaryStatus({
        topicId: node.id,
        status: 'error',
        summary: null,
        error: err instanceof Error ? err.message : '获取知识总结状态失败',
        updatedAt: null,
        startedAt: null,
        completedAt: null,
      });
    } finally {
      setSummaryChecking(false);
    }
  };

  const loadObsidianStatus = async () => {
    if (!sessionId || node.type !== 'topic') return;
    try {
      const [config, status] = await Promise.all([
        get<ObsidianConfigStatus>('/obsidian/config'),
        get<ObsidianSyncStatus>(`/sessions/${sessionId}/ontology/obsidian-card/${encodeURIComponent(node.id)}`),
      ]);
      setObsidianConfig(config);
      setObsidianStatus(status);
      setObsidianVaultPath(config.vaultPath || '');
      setObsidianNotesDir(config.notesDir || 'LLM知识卡片');
      setObsidianError(status.error || config.error);
    } catch (err) {
      setObsidianError(err instanceof Error ? err.message : '获取 Obsidian 状态失败');
    }
  };

  const handleGenerateSummary = async () => {
    if (!sessionId || summaryStatus.status === 'running' || summaryDone) return;
    setSummaryEditing(false);
    setSummarySaveError(null);
    setSummaryStatus((prev) => ({ ...prev, topicId: node.id, status: 'running', error: null }));
    try {
      const result = await post<CardSummaryStatus>(`/sessions/${sessionId}/ontology/summarize-card`, {
        topicId: node.id,
      });
      setSummaryStatus(result);
    } catch (err) {
      setSummaryStatus({
        topicId: node.id,
        status: 'error',
        summary: null,
        error: err instanceof Error ? err.message : '生成知识总结失败',
        updatedAt: null,
        startedAt: null,
        completedAt: null,
      });
    }
  };

  const handleSaveObsidianConfig = async () => {
    setObsidianBusy(true);
    setObsidianError(null);
    try {
      const config = await put<ObsidianConfigStatus>('/obsidian/config', {
        vaultPath: obsidianVaultPath,
        notesDir: obsidianNotesDir || 'LLM知识卡片',
      });
      setObsidianConfig(config);
      setObsidianConfigOpen(false);
      await loadObsidianStatus();
    } catch (err) {
      setObsidianError(err instanceof Error ? err.message : '保存 Obsidian 配置失败');
    } finally {
      setObsidianBusy(false);
    }
  };

  const handleSyncObsidian = async () => {
    if (!sessionId || node.type !== 'topic') return;
    if (!obsidianConfig?.configured) {
      setObsidianConfigOpen(true);
      return;
    }

    setObsidianBusy(true);
    setObsidianError(null);
    try {
      const status = await post<ObsidianSyncStatus>(
        `/sessions/${sessionId}/ontology/obsidian-card/${encodeURIComponent(node.id)}`,
      );
      setObsidianStatus(status);
      setObsidianError(status.error);
    } catch (err) {
      setObsidianStatus((prev) => ({ ...prev, status: 'error' }));
      setObsidianError(err instanceof Error ? err.message : '同步到 Obsidian 失败');
    } finally {
      setObsidianBusy(false);
    }
  };

  const handleEditSummary = () => {
    setSummaryDraft(summaryStatus.summary || '');
    setSummarySaveError(null);
    setSummaryEditing(true);
  };

  const handleCancelSummaryEdit = () => {
    setSummaryEditing(false);
    setSummaryDraft('');
    setSummarySaveError(null);
  };

  const handleSaveSummary = async () => {
    if (!sessionId || summarySaving) return;
    if (!summaryDraft.trim()) {
      setSummarySaveError('知识总结内容不能为空');
      return;
    }

    setSummarySaving(true);
    setSummarySaveError(null);
    try {
      const result = await put<CardSummaryStatus>(
        `/sessions/${sessionId}/ontology/summarize-card/${encodeURIComponent(node.id)}`,
        { summary: summaryDraft.trim() },
      );
      setSummaryStatus(result);
      setSummaryEditing(false);
      setSummaryDraft('');
    } catch (err) {
      setSummarySaveError(err instanceof Error ? err.message : '保存知识总结失败');
    } finally {
      setSummarySaving(false);
    }
  };

  useEffect(() => {
    setSummaryStatus({
      topicId: node.id,
      status: 'not_started',
      summary: null,
      error: null,
      updatedAt: null,
      startedAt: null,
      completedAt: null,
    });
    setSummaryEditing(false);
    setSummaryDraft('');
    setSummarySaveError(null);
    setSummarySaving(false);
    setObsidianStatus({
      topicId: node.id,
      configured: false,
      status: 'not_synced',
      notePath: null,
      error: null,
      lastSyncedAt: null,
    });
    setObsidianConfig(null);
    setObsidianConfigOpen(false);
    setObsidianVaultPath('');
    setObsidianNotesDir('LLM知识卡片');
    setObsidianBusy(false);
    setObsidianError(null);
    loadSummaryStatus();
    loadObsidianStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id, sessionId]);

  useEffect(() => {
    if (summaryStatus.status !== 'running') return;
    const timer = window.setInterval(() => {
      loadSummaryStatus();
    }, 2000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summaryStatus.status, node.id, sessionId]);

  // Related edges
  const visibleIds = new Set(
    data.nodes.filter((n) => activeTypes[n.type] !== false && n.firstTurn <= turn).map((n) => n.id),
  );
  const related: {
    id: string;
    label: string;
    color: string;
    rel: string;
    dir: string;
  }[] = [];
  data.edges.forEach((e) => {
    if (e.firstTurn > turn) return;
    const edgeDirection = e.direction || 'directed';
    if (e.s === node.id && visibleIds.has(e.t)) {
      const o = data.nodes.find((n) => n.id === e.t);
      if (o)
        related.push({
          id: e.t,
          label: o.label,
          color: data.types.find((t) => t.key === o.type)?.color || 'oklch(0.6 0 0)',
          rel: e.label,
          dir: edgeDirection === 'undirected' ? '—' : edgeDirection === 'bidirectional' ? '↔' : '→',
        });
    } else if (e.t === node.id && visibleIds.has(e.s)) {
      const o = data.nodes.find((n) => n.id === e.s);
      if (o)
        related.push({
          id: e.s,
          label: o.label,
          color: data.types.find((t) => t.key === o.type)?.color || 'oklch(0.6 0 0)',
          rel: e.label,
          dir: edgeDirection === 'undirected' ? '—' : edgeDirection === 'bidirectional' ? '↔' : '←',
        });
    }
  });

  return (
    <div>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            border: `1px solid ${typeColor}`,
            borderRadius: 20,
            padding: '3px 10px',
            fontSize: 11,
            color: typeColor,
            background: 'oklch(0.22 0.01 265 / 0.6)',
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: typeColor }} />
          {typeLabel}
        </span>
        <span style={{ flex: 1 }} />
        <button
          onClick={onClearSelection}
          style={{
            border: '1px solid oklch(0.30 0.014 265)',
            borderRadius: 7,
            width: 26,
            height: 26,
            background: 'oklch(0.22 0.01 265)',
            color: 'oklch(0.78 0.01 265)',
            cursor: 'pointer',
            fontSize: 13,
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>

      {/* Name */}
      <h2 style={{ margin: '6px 0 2px', fontSize: 19, fontWeight: 600, lineHeight: 1.2, color: SEMANTIC.textPrimary }}>
        {node.label}
      </h2>

      {node.type === 'topic' && (
        <div style={{ marginTop: 12 }}>
          {summaryNodeCount > 0 && (
            <>
              <button
                type="button"
                onClick={handleGenerateSummary}
                disabled={!sessionId || summaryDone || summaryRunning || summaryChecking}
                style={{
                  width: '100%',
                  border: summaryFailed ? '1px solid oklch(0.66 0.17 25 / 0.5)' : '1px solid oklch(0.45 0.09 165 / 0.55)',
                  borderRadius: 8,
                  padding: '8px 11px',
                  background: summaryFailed
                    ? 'oklch(0.66 0.17 25 / 0.10)'
                    : summaryDone
                      ? 'oklch(0.74 0.12 165 / 0.16)'
                      : SEMANTIC.innerCardBg,
                  color: summaryFailed
                    ? 'oklch(0.76 0.13 45)'
                    : summaryDone
                      ? 'oklch(0.84 0.10 165)'
                      : 'oklch(0.78 0.01 265)',
                  cursor: !sessionId || summaryDone || summaryRunning || summaryChecking ? 'default' : 'pointer',
                  fontFamily: 'inherit',
                  fontSize: 12.5,
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                }}
              >
                <span>{summaryChecking ? '知识总结 检查中' : summaryLabel}</span>
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: SEMANTIC.textMuted }}>
                  {summaryChecking ? `${summaryNodeCount}节点` : summaryHint}
                </span>
              </button>

              {(summaryStatus.summary || summaryStatus.error || summaryRunning) && (
                <div style={{
                  marginTop: 9,
                  border: summaryFailed ? '1px solid oklch(0.66 0.17 25 / 0.4)' : '1px solid oklch(0.32 0.014 265)',
                  borderRadius: 10,
                  background: summaryFailed ? 'oklch(0.66 0.17 25 / 0.10)' : 'oklch(0.19 0.01 265 / 0.46)',
                  padding: '11px 12px',
                }}>
                  {summaryRunning && (
                    <div style={{ fontSize: 12, color: SEMANTIC.textMuted, lineHeight: 1.55 }}>
                      正在生成当前知识卡片总结。刷新页面后会自动恢复这个状态。
                    </div>
                  )}
                  {summaryStatus.error && (
                    <div style={{ fontSize: 12, color: 'oklch(0.76 0.13 45)', lineHeight: 1.55 }}>
                      {summaryStatus.error}
                    </div>
                  )}
                  {summaryStatus.summary && !summaryEditing && (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
                        <span style={{ fontSize: 11, color: SEMANTIC.textMuted, fontFamily: "'IBM Plex Mono', monospace" }}>
                          Markdown · 已保存
                        </span>
                        <span style={{ flex: 1 }} />
                        <button
                          type="button"
                          onClick={handleEditSummary}
                          disabled={summarySaving}
                          style={{
                            border: '1px solid oklch(0.45 0.09 165 / 0.45)',
                            borderRadius: 7,
                            padding: '4px 9px',
                            background: 'oklch(0.24 0.012 265)',
                            color: 'oklch(0.82 0.10 165)',
                            cursor: summarySaving ? 'default' : 'pointer',
                            fontFamily: 'inherit',
                            fontSize: 11,
                          }}
                        >
                          编辑
                        </button>
                      </div>
                      <MarkdownBlock text={summaryStatus.summary} />
                    </>
                  )}
                  {summaryStatus.summary && summaryEditing && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <textarea
                        value={summaryDraft}
                        onChange={(event) => setSummaryDraft(event.target.value)}
                        disabled={summarySaving}
                        rows={12}
                        style={{
                          width: '100%',
                          boxSizing: 'border-box',
                          resize: 'vertical',
                          border: '1px solid oklch(0.34 0.014 265)',
                          borderRadius: 8,
                          padding: '9px 10px',
                          background: 'oklch(0.16 0.008 265)',
                          color: SEMANTIC.textPrimary,
                          outline: 'none',
                          fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
                          fontSize: 12.5,
                          lineHeight: 1.6,
                        }}
                      />
                      {summarySaveError && (
                        <div style={{ fontSize: 11.5, color: 'oklch(0.76 0.13 45)', lineHeight: 1.45 }}>
                          {summarySaveError}
                        </div>
                      )}
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                        <button
                          type="button"
                          onClick={handleCancelSummaryEdit}
                          disabled={summarySaving}
                          style={{
                            border: '1px solid oklch(0.30 0.014 265)',
                            borderRadius: 7,
                            padding: '5px 10px',
                            background: 'oklch(0.22 0.01 265)',
                            color: 'oklch(0.76 0.01 265)',
                            cursor: summarySaving ? 'default' : 'pointer',
                            fontFamily: 'inherit',
                            fontSize: 11.5,
                          }}
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          onClick={handleSaveSummary}
                          disabled={summarySaving}
                          style={{
                            border: '1px solid oklch(0.45 0.09 165 / 0.55)',
                            borderRadius: 7,
                            padding: '5px 11px',
                            background: 'oklch(0.30 0.06 165 / 0.45)',
                            color: 'oklch(0.86 0.10 165)',
                            cursor: summarySaving ? 'default' : 'pointer',
                            fontFamily: 'inherit',
                            fontSize: 11.5,
                            fontWeight: 600,
                          }}
                        >
                          {summarySaving ? '保存中' : '保存'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          <div style={{
            marginTop: 9,
            border: '1px solid oklch(0.32 0.014 265)',
            borderRadius: 9,
            padding: '9px 10px',
            background: 'oklch(0.19 0.01 265 / 0.46)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                type="button"
                onClick={handleSyncObsidian}
                disabled={obsidianBusy}
                style={{
                  border: obsidianStatus.status === 'error' ? '1px solid oklch(0.66 0.17 25 / 0.48)' : '1px solid oklch(0.45 0.09 165 / 0.55)',
                  borderRadius: 7,
                  padding: '6px 10px',
                  background: obsidianStatus.status === 'synced'
                    ? 'oklch(0.74 0.12 165 / 0.16)'
                    : obsidianStatus.status === 'error'
                      ? 'oklch(0.66 0.17 25 / 0.10)'
                      : 'oklch(0.24 0.012 265)',
                  color: obsidianStatus.status === 'synced'
                    ? 'oklch(0.84 0.10 165)'
                    : obsidianStatus.status === 'error'
                      ? 'oklch(0.76 0.13 45)'
                      : 'oklch(0.78 0.01 265)',
                  cursor: obsidianBusy ? 'default' : 'pointer',
                  fontFamily: 'inherit',
                  fontSize: 11.5,
                  fontWeight: 600,
                }}
              >
                {obsidianBusy
                  ? '同步中'
                  : obsidianStatus.status === 'synced'
                    ? '再次同步'
                    : obsidianStatus.status === 'error'
                      ? '同步失败'
                      : obsidianConfig?.configured
                        ? '同步到 Obsidian'
                        : '配置 Obsidian'}
              </button>
              {(obsidianConfig?.configured || obsidianConfigOpen) && (
                <button
                  type="button"
                  onClick={() => setObsidianConfigOpen((open) => !open)}
                  style={{
                    border: '1px solid oklch(0.30 0.014 265)',
                    borderRadius: 7,
                    padding: '6px 9px',
                    background: 'transparent',
                    color: SEMANTIC.textMuted,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontSize: 11,
                  }}
                >
                  {obsidianConfigOpen ? '收起' : '设置'}
                </button>
              )}
              {obsidianStatus.lastSyncedAt && (
                <span style={{ marginLeft: 'auto', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: SEMANTIC.textMuted }}>
                  {obsidianStatus.skipped ? '未变更' : '已写入'}
                </span>
              )}
            </div>

            {obsidianStatus.notePath && (
              <div style={{ marginTop: 6, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: SEMANTIC.textMuted, wordBreak: 'break-all' }}>
                {obsidianStatus.notePath}
              </div>
            )}

            {obsidianError && (
              <div style={{ marginTop: 6, fontSize: 11.5, color: 'oklch(0.76 0.13 45)', lineHeight: 1.45 }}>
                {obsidianError}
              </div>
            )}

            {obsidianConfigOpen && (
              <div style={{ marginTop: 9, display: 'flex', flexDirection: 'column', gap: 7 }}>
                <input
                  value={obsidianVaultPath}
                  onChange={(event) => setObsidianVaultPath(event.target.value)}
                  placeholder="/Users/you/Documents/ObsidianVault"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    border: '1px solid oklch(0.30 0.014 265)',
                    borderRadius: 7,
                    padding: '7px 9px',
                    background: 'oklch(0.16 0.008 265)',
                    color: SEMANTIC.textPrimary,
                    outline: 'none',
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 11.5,
                  }}
                />
                <input
                  value={obsidianNotesDir}
                  onChange={(event) => setObsidianNotesDir(event.target.value)}
                  placeholder="LLM知识卡片"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    border: '1px solid oklch(0.30 0.014 265)',
                    borderRadius: 7,
                    padding: '7px 9px',
                    background: 'oklch(0.16 0.008 265)',
                    color: SEMANTIC.textPrimary,
                    outline: 'none',
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 11.5,
                  }}
                />
                <button
                  type="button"
                  onClick={handleSaveObsidianConfig}
                  disabled={obsidianBusy}
                  style={{
                    alignSelf: 'flex-end',
                    border: '1px solid oklch(0.45 0.09 165 / 0.55)',
                    borderRadius: 7,
                    padding: '5px 11px',
                    background: 'oklch(0.30 0.06 165 / 0.45)',
                    color: 'oklch(0.86 0.10 165)',
                    cursor: obsidianBusy ? 'default' : 'pointer',
                    fontFamily: 'inherit',
                    fontSize: 11.5,
                    fontWeight: 600,
                  }}
                >
                  保存配置
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {node.type !== 'topic' && node.claim && (
        <div
          style={{
            marginTop: 10,
            border: '1px solid oklch(0.32 0.014 265)',
            borderRadius: 9,
            padding: '9px 11px',
            background: 'oklch(0.20 0.01 265 / 0.45)',
            color: 'oklch(0.84 0.01 265)',
            fontSize: 12.5,
            lineHeight: 1.55,
          }}
        >
          {node.claim}
        </div>
      )}

      {/* Aliases */}
      {node.type !== 'topic' && node.aliases.length > 0 && (
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: SEMANTIC.textMuted, marginTop: 2 }}>
          别名 · {node.aliases.join(' · ')}
        </div>
      )}

      {/* Confidence */}
      <div style={{ marginTop: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
          <span style={{ fontSize: 11.5, color: SEMANTIC.textDesc3 }}>抽取置信度</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10.5, color: st.color, border: `1px solid ${st.color}`, borderRadius: 999, padding: '1px 7px' }}>
              {st.label}
            </span>
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, fontWeight: 600, color: cfColor }}>
              {Math.round(c * 100)}%
            </span>
          </div>
        </div>
        <div style={{ height: 6, borderRadius: 4, background: 'oklch(0.24 0.01 265)', overflow: 'hidden' }}>
          <div
            style={{
              height: '100%',
              width: `${Math.round(c * 100)}%`,
              borderRadius: 4,
              background: cfColor,
            }}
          />
        </div>
        <div style={{
          marginTop: 8,
          border: '1px solid oklch(0.28 0.012 265)',
          borderRadius: 8,
          padding: '8px 9px',
          background: 'oklch(0.18 0.008 265 / 0.48)',
          color: SEMANTIC.textMuted,
          fontSize: 11.5,
          lineHeight: 1.55,
        }}>
          <div style={{ color: SEMANTIC.textDesc, marginBottom: 4 }}>
            由证据来源、复现轮次、片段质量和封顶规则综合计算；不是模型原始自评分。
          </div>
          {confidenceNotes.map((note) => (
            <div key={note}>· {note}</div>
          ))}
        </div>
      </div>

      {orderedEvidence.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 11.5, color: SEMANTIC.textDesc3, marginBottom: 7 }}>
            证据 · {evidenceTurnCount}轮 · {orderedEvidence.length}条
          </div>
          <div style={{ fontSize: 11, color: SEMANTIC.textMuted, lineHeight: 1.45, marginBottom: 7 }}>
            支撑权重表示该原文片段对当前节点的匹配和支撑强度，不是节点整体置信度。
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {orderedEvidence.map((ev, idx) => (
              <div
                key={`${ev.turn}-${ev.source}-${idx}`}
                style={{
                  border: '1px solid oklch(0.27 0.012 265)',
                  borderRadius: 8,
                  padding: '8px 9px',
                  background: SEMANTIC.innerCardBg,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'oklch(0.70 0.08 165)' }}>
                    第{ev.turn}轮
                  </span>
                  <span style={{ fontSize: 10, color: 'oklch(0.58 0.012 265)' }}>
                    {sourceLabel(ev.source)}
                  </span>
                  <span style={{ marginLeft: 'auto', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: SEMANTIC.textMuted }}>
                    支撑权重 {Math.round(ev.weight * 100)}%
                  </span>
                </div>
                <div style={{ fontSize: 11.5, color: 'oklch(0.76 0.01 265)', lineHeight: 1.45 }}>
                  {ev.text}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Disambiguation note */}
      {node.note && (
        <div
          style={{
            marginTop: 14,
            border: '1px solid oklch(0.42 0.09 60 / 0.5)',
            borderRadius: 10,
            padding: '10px 12px',
            background: 'oklch(0.74 0.12 60 / 0.08)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, color: 'oklch(0.82 0.10 60)', marginBottom: 5 }}>
            ◆ 消歧 / 冲突消解
          </div>
          <div style={{ fontSize: 12, color: 'oklch(0.80 0.02 60)', lineHeight: 1.55 }}>{node.note}</div>
        </div>
      )}

      {/* Source snippet */}
      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 11.5, color: SEMANTIC.textDesc3, marginBottom: 6 }}>
          原文片段
          {node.snippetQuality === 'low' && (
            <span style={{ marginLeft: 8, fontSize: 10, color: 'oklch(0.76 0.13 45)' }}>⚠ 可能与实体无关</span>
          )}
        </div>
        <div
          style={{
            fontSize: 12.5,
            color: 'oklch(0.82 0.01 265)',
            lineHeight: 1.6,
            borderLeft: `2px solid ${typeColor}`,
            padding: '2px 0 2px 11px',
            fontStyle: 'italic',
            opacity: node.snippetQuality === 'low' ? 0.6 : 1,
          }}
        >
          「{node.snippet}」
        </div>
      </div>

      {/* Turn chips */}
      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 11.5, color: SEMANTIC.textDesc3, marginBottom: 7 }}>
          出现于 {node.turns.length} 轮 · 首现第 {node.firstTurn} 轮（点击跳转）
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {node.turns.map((t) => (
            <button
              key={t}
              onClick={() => onJumpToTurn(t)}
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 11,
                border: '1px solid oklch(0.30 0.014 265)',
                borderRadius: 6,
                padding: '2px 8px',
                background: SEMANTIC.innerCardBg,
                color: 'oklch(0.78 0.01 265)',
                cursor: 'pointer',
              }}
            >
              第{t}轮
            </button>
          ))}
        </div>
      </div>

      {/* Related entities */}
      <div style={{ marginTop: 18 }}>
        <div style={{ fontSize: 11.5, color: SEMANTIC.textDesc3, marginBottom: 8 }}>
          关联实体 · {related.length}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {related.map((r) => (
            <button
              key={r.id + r.dir + r.rel}
              onClick={() => onSelectNode(r.id)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 3,
                border: '1px solid oklch(0.26 0.012 265)',
                borderRadius: 9,
                padding: '8px 10px',
                background: SEMANTIC.innerCardBg,
                cursor: 'pointer',
                fontFamily: 'inherit',
                textAlign: 'left' as const,
                width: '100%',
                color: 'inherit',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: r.color, flexShrink: 0 }} />
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: SEMANTIC.textMuted2, flexShrink: 0 }}>
                  {r.dir}
                </span>
                <span style={{ fontSize: 11, color: SEMANTIC.textDesc }}>{r.rel}</span>
              </div>
              <span style={{ fontSize: 12, color: SEMANTIC.textPrimary6, paddingLeft: 14, lineHeight: 1.35 }}>
                {r.label}
              </span>
            </button>
          ))}
          {related.length === 0 && (
            <div style={{ fontSize: 12, color: SEMANTIC.textDesc3, padding: '8px 0' }}>无关联实体</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

const OntologyDetailPanel: React.FC<OntologyDetailPanelProps> = ({
  data,
  selectedNodeId,
  turn,
  activeTypes,
  degree,
  onSelectNode,
  onClearSelection,
  onJumpToTurn,
  sessionId,
}) => {
  const node = selectedNodeId ? data.nodes.find((n) => n.id === selectedNodeId) : null;
  const typeInfo = node ? data.types.find((t) => t.key === node.type) : null;

  return (
    <div
      className="tl"
      style={{
        border: `1px solid ${SEMANTIC.borderColor}`,
        borderRadius: 16,
        background: SEMANTIC.cardBg,
        overflowY: 'auto',
        padding: '18px 18px 22px',
        fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
      }}
    >
      {node && typeInfo ? (
        <SelectedEntity
          node={node}
          typeColor={typeInfo.color}
          typeLabel={typeInfo.label}
          data={data}
          turn={turn}
          activeTypes={activeTypes}
          degree={degree}
          onSelectNode={onSelectNode}
          onClearSelection={onClearSelection}
          onJumpToTurn={onJumpToTurn}
          sessionId={sessionId}
        />
      ) : (
        <EmptyState data={data} degree={degree} onSelectNode={onSelectNode} />
      )}
    </div>
  );
};

export default OntologyDetailPanel;
