import React from 'react';
import { SEMANTIC } from '../../styles/theme';
import { OntologyEmptyState } from './OntologyEmptyState';
import { OntologySelectedEntity } from './OntologySelectedEntity';
import type { OntologyData } from '../../types/ontology';

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
        <OntologySelectedEntity
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
        <OntologyEmptyState data={data} degree={degree} onSelectNode={onSelectNode} />
      )}
    </div>
  );
};

export default OntologyDetailPanel;
