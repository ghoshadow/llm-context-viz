import { useMemo } from 'react';
import { SEMANTIC } from '../../styles/theme';
import type { OntologyData, OntologyNode } from '../../types/ontology';
import { EntityEvidenceSection } from './EntityEvidenceSection';
import { EntityRelationsSection, type RelatedEntity } from './EntityRelationsSection';
import { EntitySummarySection } from './EntitySummarySection';
import { ObsidianActionsSection } from './ObsidianActionsSection';
import {
  buildConfidenceNotes,
  confColor,
  getCardNodes,
  sortedEvidence,
  statusLabel,
} from './ontologyDetailLogic';
import { useEntitySummary } from './useEntitySummary';
import { useObsidianCardSync } from './useObsidianCardSync';

// ─── Selected Entity State ──────────────────────────────────────────────────

export function OntologySelectedEntity({
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
  const {
    summaryStatus,
    summaryChecking,
    summaryEditing,
    summaryDraft,
    setSummaryDraft,
    summarySaving,
    summarySaveError,
    summaryRunning,
    summaryDone,
    summaryFailed,
    handleGenerateSummary,
    handleEditSummary,
    handleCancelSummaryEdit,
    handleSaveSummary,
  } = useEntitySummary({ sessionId, nodeId: node.id, nodeType: node.type });
  const {
    obsidianStatus,
    obsidianConfig,
    obsidianConfigOpen,
    setObsidianConfigOpen,
    obsidianVaultPath,
    setObsidianVaultPath,
    obsidianNotesDir,
    setObsidianNotesDir,
    obsidianBusy,
    obsidianError,
    handleSaveObsidianConfig,
    handleSyncObsidian,
  } = useObsidianCardSync({ sessionId, nodeId: node.id, nodeType: node.type });
  const c = node.conf;
  const cfColor = confColor(c);
  const st = statusLabel(node.status);
  const orderedEvidence = useMemo(() => sortedEvidence(node.evidence || []), [node.evidence]);
  const confidenceNotes = useMemo(() => buildConfidenceNotes(node, orderedEvidence), [node, orderedEvidence]);
  const cardNodes = useMemo(() => getCardNodes(node, data), [node, data]);
  const cardEdges = useMemo(() => {
    const ids = new Set(cardNodes.map((n) => n.id));
    return data.edges.filter((e) => ids.has(e.s) && ids.has(e.t));
  }, [cardNodes, data.edges]);
  const summaryNodeCount = Math.max(0, cardNodes.length - 1);
  const related = useMemo<RelatedEntity[]>(() => {
    const visibleIds = new Set(
      data.nodes.filter((n) => activeTypes[n.type] !== false && n.firstTurn <= turn).map((n) => n.id),
    );
    const relatedEntities: RelatedEntity[] = [];
    data.edges.forEach((e) => {
      if (e.firstTurn > turn) return;
      const edgeDirection = e.direction || 'directed';
      if (e.s === node.id && visibleIds.has(e.t)) {
        const o = data.nodes.find((n) => n.id === e.t);
        if (o)
          relatedEntities.push({
            id: e.t,
            label: o.label,
            color: data.types.find((t) => t.key === o.type)?.color || 'oklch(0.6 0 0)',
            rel: e.label,
            dir: edgeDirection === 'undirected' ? '—' : edgeDirection === 'bidirectional' ? '↔' : '→',
          });
      } else if (e.t === node.id && visibleIds.has(e.s)) {
        const o = data.nodes.find((n) => n.id === e.s);
        if (o)
          relatedEntities.push({
            id: e.s,
            label: o.label,
            color: data.types.find((t) => t.key === o.type)?.color || 'oklch(0.6 0 0)',
            rel: e.label,
            dir: edgeDirection === 'undirected' ? '—' : edgeDirection === 'bidirectional' ? '↔' : '←',
          });
      }
    });
    return relatedEntities;
  }, [activeTypes, data.edges, data.nodes, data.types, node.id, turn]);

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
          <EntitySummarySection
            sessionId={sessionId}
            summaryNodeCount={summaryNodeCount}
            summaryStatus={summaryStatus}
            summaryChecking={summaryChecking}
            summaryEditing={summaryEditing}
            summaryDraft={summaryDraft}
            setSummaryDraft={setSummaryDraft}
            summarySaving={summarySaving}
            summarySaveError={summarySaveError}
            summaryRunning={summaryRunning}
            summaryDone={summaryDone}
            summaryFailed={summaryFailed}
            onGenerateSummary={handleGenerateSummary}
            onEditSummary={handleEditSummary}
            onCancelSummaryEdit={handleCancelSummaryEdit}
            onSaveSummary={handleSaveSummary}
          />

          <ObsidianActionsSection
            obsidianStatus={obsidianStatus}
            obsidianConfig={obsidianConfig}
            obsidianConfigOpen={obsidianConfigOpen}
            setObsidianConfigOpen={setObsidianConfigOpen}
            obsidianVaultPath={obsidianVaultPath}
            setObsidianVaultPath={setObsidianVaultPath}
            obsidianNotesDir={obsidianNotesDir}
            setObsidianNotesDir={setObsidianNotesDir}
            obsidianBusy={obsidianBusy}
            obsidianError={obsidianError}
            onSaveObsidianConfig={handleSaveObsidianConfig}
            onSyncObsidian={handleSyncObsidian}
          />
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

      <EntityEvidenceSection
        confidence={c}
        confidenceColor={cfColor}
        status={st}
        confidenceNotes={confidenceNotes}
        orderedEvidence={orderedEvidence}
      />

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

      <EntityRelationsSection related={related} onSelectNode={onSelectNode} />
    </div>
  );
}
