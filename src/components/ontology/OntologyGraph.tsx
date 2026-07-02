import React, { useEffect, useMemo, useRef } from 'react';
import type { OntologyData } from '../../types/ontology';
import {
  AGG_PAD,
  HEADER_H,
  buildOntologyGraphLayout,
  edgeKey,
  makeEdgePath,
  truncate,
  type LayoutEdge,
} from './ontologyGraphLayout';

interface OntologyGraphProps {
  data: OntologyData;
  selectedNodeId: string | null;
  turn: number;
  activeTypes: Record<string, boolean>;
  onSelectNode: (id: string | null) => void;
  recenterKey: number;
}

const OntologyGraph: React.FC<OntologyGraphProps> = ({
  data,
  selectedNodeId,
  turn,
  activeTypes,
  onSelectNode,
  recenterKey,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const didInitialFocusRef = useRef(false);
  const didMountRecenterRef = useRef(false);
  const didMountSelectedRef = useRef(false);

  const layout = useMemo(
    () => buildOntologyGraphLayout({ data, activeTypes, turn, selectedNodeId }),
    [data, turn, activeTypes, selectedNodeId],
  );

  const selectedAggregateId = selectedNodeId ? layout.nodeById.get(selectedNodeId)?.aggregateId : null;
  const selectedDirectEdges = useMemo(() => {
    if (!selectedNodeId) return new Set<string>();
    return new Set(
      data.edges
        .filter((e) => (e.s === selectedNodeId || e.t === selectedNodeId) && layout.visibleEdgeIds.has(edgeKey(e)))
        .map(edgeKey),
    );
  }, [data.edges, layout.visibleEdgeIds, selectedNodeId]);

  const focusNode = (nodeId: string | null, behavior: ScrollBehavior = 'smooth') => {
    const container = containerRef.current;
    if (!container) return;
    const node = nodeId ? layout.nodeById.get(nodeId) : null;
    const targetX = node ? node.x + node.w / 2 : layout.width / 2;
    const targetY = node ? node.y + node.h / 2 : layout.height / 2;
    container.scrollTo({
      left: Math.max(0, targetX - container.clientWidth / 2),
      top: Math.max(0, targetY - container.clientHeight / 2),
      behavior,
    });
  };

  const focusFirstAggregate = (behavior: ScrollBehavior = 'auto') => {
    const container = containerRef.current;
    const first = layout.aggregates[0];
    if (!container || !first) return;
    container.scrollTo({
      left: Math.max(0, first.x - 10),
      top: Math.max(0, first.y - 10),
      behavior,
    });
  };

  useEffect(() => {
    didInitialFocusRef.current = false;
    didMountSelectedRef.current = false;
  }, [data]);

  useEffect(() => {
    if (didInitialFocusRef.current || layout.aggregates.length === 0) return;
    didInitialFocusRef.current = true;
    window.requestAnimationFrame(() => focusFirstAggregate('auto'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout.aggregates]);

  useEffect(() => {
    if (!didMountSelectedRef.current) {
      didMountSelectedRef.current = true;
      return;
    }
    if (selectedNodeId) {
      window.requestAnimationFrame(() => focusNode(selectedNodeId));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeId]);

  useEffect(() => {
    if (!didMountRecenterRef.current) {
      didMountRecenterRef.current = true;
      return;
    }
    window.requestAnimationFrame(() => focusNode(selectedNodeId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenterKey]);

  const shouldDimNode = (id: string): boolean =>
    selectedNodeId !== null && !layout.neighborSet.has(id);

  const shouldDimEdge = (edge: LayoutEdge): boolean =>
    selectedNodeId !== null && !layout.neighborSet.has(edge.source.node.id) && !layout.neighborSet.has(edge.target.node.id);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        overflow: 'auto',
        position: 'relative',
        scrollbarColor: 'oklch(0.34 0.014 265) transparent',
      }}
    >
      <svg
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        style={{ display: 'block', minWidth: '100%', minHeight: '100%' }}
        onClick={() => onSelectNode(null)}
      >
        <defs>
          <marker
            id="ontology-arrow"
            viewBox="0 -3 6 6"
            refX="5.4"
            refY="0"
            markerWidth="5"
            markerHeight="5"
            orient="auto"
          >
            <path d="M0,-3L6,0L0,3" fill="context-stroke" />
          </marker>
          <marker
            id="ontology-arrow-start"
            viewBox="0 -3 6 6"
            refX="0.6"
            refY="0"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M6,-3L0,0L6,3" fill="context-stroke" />
          </marker>
        </defs>

        <g>
          {layout.aggregates.map((aggregate) => {
            const selected = selectedAggregateId === aggregate.id;
            return (
              <g key={aggregate.id}>
                <rect
                  x={aggregate.x}
                  y={aggregate.y}
                  width={aggregate.w}
                  height={aggregate.h}
                  rx={8}
                  fill={selected ? 'oklch(0.82 0.14 50 / 0.10)' : 'oklch(0.20 0.012 265 / 0.42)'}
                  stroke={selected ? 'oklch(0.82 0.14 50 / 0.62)' : 'oklch(0.34 0.018 265 / 0.72)'}
                  strokeWidth={selected ? 1.4 : 1}
                />
                <rect
                  x={aggregate.x}
                  y={aggregate.y}
                  width={aggregate.w}
                  height={HEADER_H}
                  rx={8}
                  fill={selected ? 'oklch(0.82 0.14 50 / 0.08)' : 'oklch(0.18 0.01 265 / 0.92)'}
                />
                <text
                  x={aggregate.x + AGG_PAD}
                  y={aggregate.y + 19}
                  fontFamily="'IBM Plex Sans', sans-serif"
                  fontSize={13}
                  fontWeight={600}
                  fill={selected ? 'oklch(0.86 0.11 60)' : 'oklch(0.88 0.01 265)'}
                >
                  {truncate(aggregate.label, 28)}
                  <title>{aggregate.label}</title>
                </text>
                <text
                  x={aggregate.x + AGG_PAD}
                  y={aggregate.y + 35}
                  fontFamily="'IBM Plex Mono', monospace"
                  fontSize={10.5}
                  fill="oklch(0.55 0.012 265)"
                >
                  第 {aggregate.startTurn}-{aggregate.endTurn} 轮 · {aggregate.nodeCount} 实体
                </text>
                {aggregate.lanes.map((lane) => (
                  <g key={`${aggregate.id}-${lane.type}`}>
                    <line
                      x1={lane.x}
                      y1={lane.y}
                      x2={lane.x + lane.w}
                      y2={lane.y}
                      stroke="oklch(0.30 0.014 265 / 0.72)"
                    />
                    <circle cx={lane.x + 5} cy={lane.y + 14} r={4} fill={lane.color} opacity={0.94} />
                    <text
                      x={lane.x + 16}
                      y={lane.y + 18}
                      fontFamily="'IBM Plex Sans', sans-serif"
                      fontSize={11.5}
                      fill="oklch(0.66 0.012 265)"
                    >
                      {lane.label}
                    </text>
                    <text
                      x={lane.x + lane.w}
                      y={lane.y + 18}
                      textAnchor="end"
                      fontFamily="'IBM Plex Mono', monospace"
                      fontSize={10}
                      fill="oklch(0.47 0.012 265)"
                    >
                      {lane.count}
                    </text>
                  </g>
                ))}
              </g>
            );
          })}
        </g>

        <g fill="none">
          {layout.edges.map((edge) => {
            const edgeSelected = selectedDirectEdges.has(edgeKey(edge.edge));
            const direction = edge.edge.direction || 'directed';
            return (
              <path
                key={edgeKey(edge.edge)}
                d={edge.path}
                stroke={edgeSelected ? 'oklch(0.84 0.13 60)' : 'oklch(0.44 0.018 265)'}
                strokeWidth={edgeSelected ? 2.4 : 1.2 + edge.edge.conf * 1.2}
                strokeOpacity={shouldDimEdge(edge) ? 0.10 : edgeSelected ? 0.92 : 0.34}
                strokeDasharray={edge.crossAggregate ? '5 5' : undefined}
                markerStart={direction === 'bidirectional' ? 'url(#ontology-arrow-start)' : undefined}
                markerEnd={direction === 'directed' || direction === 'bidirectional' ? 'url(#ontology-arrow)' : undefined}
              />
            );
          })}
        </g>

        {selectedNodeId && (
          <g pointerEvents="none">
            {layout.edges
              .filter((edge) => selectedDirectEdges.has(edgeKey(edge.edge)))
              .map((edge) => (
                <text
                  key={`label-${edgeKey(edge.edge)}`}
                  x={edge.labelX}
                  y={edge.labelY}
                  textAnchor="middle"
                  fontFamily="'IBM Plex Sans', sans-serif"
                  fontSize={10.5}
                  fill="oklch(0.86 0.10 60)"
                  paintOrder="stroke"
                  stroke="oklch(0.16 0.008 265)"
                  strokeWidth={4}
                >
                  {edge.edge.label}
                </text>
              ))}
          </g>
        )}

        <g>
          {layout.nodes.map((layoutNode) => {
            const node = layoutNode.node;
            const selected = selectedNodeId === node.id;
            const dimmed = shouldDimNode(node.id);
            const quiet = layoutNode.degree === 0;
            const labelMax = layoutNode.w > 260 ? 24 : 15;
            return (
              <g
                key={node.id}
                transform={`translate(${layoutNode.x},${layoutNode.y})`}
                onClick={(ev) => {
                  ev.stopPropagation();
                  onSelectNode(node.id);
                }}
                style={{ cursor: 'pointer' }}
              >
                <title>{node.label}</title>
                <rect
                  width={layoutNode.w}
                  height={layoutNode.h}
                  rx={7}
                  fill={selected ? 'oklch(0.26 0.03 60 / 0.92)' : 'oklch(0.175 0.008 265 / 0.94)'}
                  stroke={selected ? 'oklch(0.92 0.11 60)' : layoutNode.color}
                  strokeWidth={selected ? 1.8 : 1}
                  opacity={dimmed ? 0.24 : quiet ? 0.66 : 1}
                />
                <rect
                  x={0}
                  y={0}
                  width={5}
                  height={layoutNode.h}
                  rx={5}
                  fill={layoutNode.color}
                  opacity={dimmed ? 0.34 : 0.92}
                />
                <circle
                  cx={18}
                  cy={layoutNode.h / 2}
                  r={selected ? 5.8 : 4.8}
                  fill={layoutNode.color}
                  opacity={dimmed ? 0.30 : 1}
                />
                <text
                  x={31}
                  y={layoutNode.h / 2 + 4.5}
                  fontFamily="'IBM Plex Sans', sans-serif"
                  fontSize={12}
                  fontWeight={selected ? 650 : 500}
                  fill={selected ? 'oklch(0.95 0.01 265)' : 'oklch(0.82 0.01 265)'}
                  opacity={dimmed ? 0.38 : 1}
                >
                  {truncate(node.label, selected ? 26 : labelMax)}
                </text>
                {layoutNode.degree > 0 && (
                  <text
                    x={layoutNode.w - 10}
                    y={layoutNode.h / 2 + 4}
                    textAnchor="end"
                    fontFamily="'IBM Plex Mono', monospace"
                    fontSize={9.5}
                    fill="oklch(0.52 0.012 265)"
                    opacity={dimmed ? 0.30 : 1}
                  >
                    {layoutNode.degree}
                  </text>
                )}
              </g>
            );
          })}
        </g>

        {layout.nodes.length === 0 && (
          <text
            x={layout.width / 2}
            y={layout.height / 2}
            textAnchor="middle"
            fontFamily="'IBM Plex Sans', sans-serif"
            fontSize={14}
            fill="oklch(0.58 0.012 265)"
          >
            当前筛选条件下没有可显示的实体
          </text>
        )}
      </svg>
    </div>
  );
};

export default OntologyGraph;
