import type { OntologyData, OntologyEdge, OntologyNode, OntologyType } from '../../types/ontology';
import { ontologyTypeSortKey } from './typeOrder';

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
export const AGG_PAD = 18;
export const HEADER_H = 44;
const LANE_LABEL_H = 24;
const LANE_GAP = 20;
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

function buildOntologyGraphLayout({
  data,
  activeTypes,
  turn,
  selectedNodeId,
}: {
  data: OntologyData;
  activeTypes: Record<string, boolean>;
  turn: number;
  selectedNodeId: string | null;
}): GraphLayout {
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

export type { LayoutAggregate, LayoutLane, LayoutNode, LayoutEdge, GraphLayout };
export { edgeKey, truncate, makeEdgePath, buildOntologyGraphLayout };
