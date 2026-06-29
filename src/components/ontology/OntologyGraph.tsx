import React, { useEffect, useMemo, useRef } from 'react';
import type { OntologyType, OntologyNode, OntologyEdge } from '../../types/ontology';
import { ontologyTypeSortKey } from './typeOrder';

interface OntologyGraphProps {
  data: {
    types: OntologyType[];
    nodes: OntologyNode[];
    edges: OntologyEdge[];
    aggregates?: Array<{ id: string; label: string; startTurn: number; endTurn: number }>;
  };
  selectedNodeId: string | null;
  turn: number;
  activeTypes: Record<string, boolean>;
  onSelectNode: (id: string | null) => void;
  recenterKey: number;
}

interface LayoutAggregate {
  id: string;
  label: string;
  startTurn: number;
  endTurn: number;
  x: number;
  y: number;
  w: number;
  h: number;
  lanes: LayoutLane[];
  nodeCount: number;
}

interface LayoutLane {
  type: string;
  label: string;
  color: string;
  x: number;
  y: number;
  w: number;
  h: number;
  count: number;
}

interface LayoutNode {
  node: OntologyNode;
  aggregateId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  degree: number;
}

interface LayoutEdge {
  edge: OntologyEdge;
  source: LayoutNode;
  target: LayoutNode;
  path: string;
  labelX: number;
  labelY: number;
  crossAggregate: boolean;
}

interface GraphLayout {
  width: number;
  height: number;
  aggregates: LayoutAggregate[];
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  nodeById: Map<string, LayoutNode>;
  visibleEdgeIds: Set<string>;
  neighborSet: Set<string>;
}

const TYPE_FALLBACK: Record<string, { label: string; color: string }> = {
  topic: { label: '问题/主题', color: 'oklch(0.80 0.12 0)' },
  how_to: { label: '怎么做', color: 'oklch(0.74 0.12 165)' },
  why: { label: '为什么', color: 'oklch(0.70 0.13 245)' },
  pitfall: { label: '坑/教训', color: 'oklch(0.66 0.17 25)' },
  heuristic: { label: '经验法则', color: 'oklch(0.78 0.13 60)' },
  technique: { label: '工具/技巧', color: 'oklch(0.74 0.11 210)' },
};

const PAGE_PAD = 26;
const AGG_W = 520;
const AGG_GAP = 42;
const AGG_PAD = 18;
const HEADER_H = 44;
const LANE_LABEL_H = 24;
const LANE_GAP = 20;
const NODE_W = 228;
const NODE_H = 36;
const NODE_GAP_X = 12;
const NODE_GAP_Y = 10;
const MIN_HEIGHT = 620;

function edgeKey(e: OntologyEdge): string {
  return `${e.s}->${e.t}:${e.label}:${e.direction || 'directed'}`;
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

function rectPort(from: LayoutNode, to: LayoutNode): { x: number; y: number } {
  const fx = from.x + from.w / 2;
  const fy = from.y + from.h / 2;
  const tx = to.x + to.w / 2;
  const ty = to.y + to.h / 2;
  const dx = tx - fx;
  const dy = ty - fy;

  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return { x: fx, y: fy };

  const sx = Math.abs(dx) > 0 ? (from.w / 2) / Math.abs(dx) : Infinity;
  const sy = Math.abs(dy) > 0 ? (from.h / 2) / Math.abs(dy) : Infinity;
  const scale = Math.min(sx, sy, 1) * 0.92;
  return { x: fx + dx * scale, y: fy + dy * scale };
}

function makeEdgePath(source: LayoutNode, target: LayoutNode): { path: string; labelX: number; labelY: number } {
  const start = rectPort(source, target);
  const end = rectPort(target, source);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const sameAggregate = source.aggregateId === target.aggregateId;
  const bend = sameAggregate ? 72 : Math.max(90, Math.min(260, Math.abs(dx) * 0.42));
  const direction = dx >= 0 ? 1 : -1;
  const c1x = start.x + bend * direction;
  const c2x = end.x - bend * direction;
  const c1y = start.y + (sameAggregate ? dy * 0.12 : 0);
  const c2y = end.y - (sameAggregate ? dy * 0.12 : 0);

  return {
    path: `M ${start.x} ${start.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${end.x} ${end.y}`,
    labelX: (start.x + end.x) / 2,
    labelY: (start.y + end.y) / 2 - 8,
  };
}

function buildLayout(
  data: OntologyGraphProps['data'],
  turn: number,
  activeTypes: Record<string, boolean>,
  selectedNodeId: string | null,
): GraphLayout {
  const typeMap = new Map<string, OntologyType>();
  data.types.forEach((t) => typeMap.set(t.key, t));

  const colorFor = (type: string): string =>
    typeMap.get(type)?.color || TYPE_FALLBACK[type]?.color || 'oklch(0.64 0.04 265)';
  const labelFor = (type: string): string =>
    typeMap.get(type)?.label || TYPE_FALLBACK[type]?.label || type;

  const aggregateMeta = new Map<string, { id: string; label: string; startTurn: number; endTurn: number }>();
  data.aggregates?.forEach((a) => aggregateMeta.set(a.id, a));

  const visibleNodes = data.nodes.filter((n) => activeTypes[n.type] !== false && n.firstTurn <= turn);
  const visibleIds = new Set(visibleNodes.map((n) => n.id));
  const visibleEdges = data.edges.filter((e) => e.firstTurn <= turn && visibleIds.has(e.s) && visibleIds.has(e.t));

  const degree: Record<string, number> = {};
  visibleNodes.forEach((n) => (degree[n.id] = 0));
  visibleEdges.forEach((e) => {
    degree[e.s] = (degree[e.s] || 0) + 1;
    degree[e.t] = (degree[e.t] || 0) + 1;
  });

  const nodesByAggregate = new Map<string, OntologyNode[]>();
  for (const node of visibleNodes) {
    const aggregateId = node.aggregateId || 'unassigned';
    if (!nodesByAggregate.has(aggregateId)) nodesByAggregate.set(aggregateId, []);
    nodesByAggregate.get(aggregateId)!.push(node);
  }

  const aggregateEntries = Array.from(nodesByAggregate.entries())
    .map(([id, nodes]) => {
      const meta = aggregateMeta.get(id);
      const turnsArray = nodes.flatMap((n) => n.turns.length > 0 ? n.turns : [n.firstTurn]);
      const minTurn = nodes.length > 0 ? Math.min(...nodes.map((n) => n.firstTurn)) : 1;
      const maxTurn = turnsArray.length > 0 ? Math.max(...turnsArray) : minTurn;
      return {
        id,
        label: meta?.label || (id === 'unassigned' ? '未分组知识' : id),
        startTurn: meta?.startTurn ?? minTurn,
        endTurn: meta?.endTurn ?? maxTurn,
        nodes,
      };
    })
    .sort((a, b) => a.startTurn - b.startTurn || a.label.localeCompare(b.label));

  if (aggregateEntries.length === 0) {
    return {
      width: 900,
      height: MIN_HEIGHT,
      aggregates: [],
      nodes: [],
      edges: [],
      nodeById: new Map(),
      visibleEdgeIds: new Set(),
      neighborSet: new Set(selectedNodeId ? [selectedNodeId] : []),
    };
  }

  const aggregates: LayoutAggregate[] = [];
  const layoutNodes: LayoutNode[] = [];
  const nodeById = new Map<string, LayoutNode>();
  let maxBottom = PAGE_PAD;

  aggregateEntries.forEach((entry, aggregateIndex) => {
    const aggX = PAGE_PAD + aggregateIndex * (AGG_W + AGG_GAP);
    const aggY = PAGE_PAD;
    const contentX = aggX + AGG_PAD;
    const contentW = AGG_W - AGG_PAD * 2;
    const lanes: LayoutLane[] = [];
    let cursorY = aggY + HEADER_H + 16;

    const typesInAggregate = Array.from(new Set(entry.nodes.map((n) => n.type)))
      .sort((a, b) => ontologyTypeSortKey(a) - ontologyTypeSortKey(b) || a.localeCompare(b));

    typesInAggregate.forEach((type) => {
      const laneNodes = entry.nodes
        .filter((n) => n.type === type)
        .sort((a, b) =>
          (degree[b.id] || 0) - (degree[a.id] || 0)
          || a.firstTurn - b.firstTurn
          || a.label.localeCompare(b.label),
        );
      if (laneNodes.length === 0) return;

      const topicLane = type === 'topic';
      const cols = topicLane ? 1 : Math.min(2, Math.max(1, laneNodes.length));
      const nodeW = topicLane ? contentW : (contentW - NODE_GAP_X) / 2;
      const rows = Math.ceil(laneNodes.length / cols);
      const laneH = LANE_LABEL_H + rows * NODE_H + Math.max(0, rows - 1) * NODE_GAP_Y + 2;

      lanes.push({
        type,
        label: labelFor(type),
        color: colorFor(type),
        x: contentX,
        y: cursorY,
        w: contentW,
        h: laneH,
        count: laneNodes.length,
      });

      laneNodes.forEach((node, index) => {
        const col = topicLane ? 0 : index % cols;
        const row = topicLane ? index : Math.floor(index / cols);
        const nodeX = contentX + col * (nodeW + NODE_GAP_X);
        const nodeY = cursorY + LANE_LABEL_H + row * (NODE_H + NODE_GAP_Y);
        const layoutNode: LayoutNode = {
          node,
          aggregateId: entry.id,
          x: nodeX,
          y: nodeY,
          w: nodeW,
          h: NODE_H,
          color: colorFor(node.type),
          degree: degree[node.id] || 0,
        };
        layoutNodes.push(layoutNode);
        nodeById.set(node.id, layoutNode);
      });

      cursorY += laneH + LANE_GAP;
    });

    const aggH = Math.max(190, cursorY - aggY - LANE_GAP + AGG_PAD);
    aggregates.push({
      id: entry.id,
      label: entry.label,
      startTurn: entry.startTurn,
      endTurn: entry.endTurn,
      x: aggX,
      y: aggY,
      w: AGG_W,
      h: aggH,
      lanes,
      nodeCount: entry.nodes.length,
    });
    maxBottom = Math.max(maxBottom, aggY + aggH);
  });

  const visibleEdgeIds = new Set(visibleEdges.map(edgeKey));
  const neighborSet = new Set<string>();
  if (selectedNodeId) {
    neighborSet.add(selectedNodeId);
    visibleEdges.forEach((e) => {
      if (e.s === selectedNodeId) neighborSet.add(e.t);
      if (e.t === selectedNodeId) neighborSet.add(e.s);
    });
    visibleEdges.forEach((e) => {
      if (neighborSet.has(e.s)) neighborSet.add(e.t);
      if (neighborSet.has(e.t)) neighborSet.add(e.s);
    });
  }

  const layoutEdges = visibleEdges
    .map((edge) => {
      const source = nodeById.get(edge.s);
      const target = nodeById.get(edge.t);
      if (!source || !target) return null;
      const curve = makeEdgePath(source, target);
      return {
        edge,
        source,
        target,
        path: curve.path,
        labelX: curve.labelX,
        labelY: curve.labelY,
        crossAggregate: source.aggregateId !== target.aggregateId,
      };
    })
    .filter((e): e is LayoutEdge => Boolean(e));

  return {
    width: PAGE_PAD * 2 + aggregateEntries.length * AGG_W + Math.max(0, aggregateEntries.length - 1) * AGG_GAP,
    height: Math.max(MIN_HEIGHT, maxBottom + PAGE_PAD),
    aggregates,
    nodes: layoutNodes,
    edges: layoutEdges,
    nodeById,
    visibleEdgeIds,
    neighborSet,
  };
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
    () => buildLayout(data, turn, activeTypes, selectedNodeId),
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
