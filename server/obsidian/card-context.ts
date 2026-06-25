import type { OntologyEvidence } from '../../src/types/ontology';

export interface ObsidianNodeLike {
  id: string;
  label: string;
  type: string;
  firstTurn: number;
  turns?: number[];
  aliases?: string[];
  claim?: string;
  snippet?: string;
  aggregateId?: string;
  evidence?: OntologyEvidence[];
}

export interface ObsidianEdgeLike {
  s: string;
  t: string;
  label: string;
  direction?: 'directed' | 'undirected' | 'bidirectional';
  firstTurn: number;
  conf?: number;
  evidence?: OntologyEvidence[];
}

export interface ObsidianAggregateLike {
  id: string;
  label: string;
  startTurn: number;
  endTurn: number;
  nodeIds?: string[];
}

export interface ObsidianOntologyDataLike {
  nodes: ObsidianNodeLike[];
  edges: ObsidianEdgeLike[];
  aggregates?: ObsidianAggregateLike[];
  types?: Array<{ key: string; label: string; color?: string }>;
}

export interface ObsidianTypeLike {
  key: string;
  label: string;
  color?: string;
}

export interface KnowledgeCardContext {
  topic: ObsidianNodeLike;
  aggregate: ObsidianAggregateLike | null;
  nodes: ObsidianNodeLike[];
  edges: ObsidianEdgeLike[];
  evidence: OntologyEvidence[];
  types?: ObsidianTypeLike[];
  title: string;
  startTurn: number;
  endTurn: number;
}

const TYPE_ORDER = ['topic', 'why', 'how_to', 'pitfall', 'heuristic', 'technique'];

function typeRank(type: string): number {
  const index = TYPE_ORDER.indexOf(type);
  return index === -1 ? TYPE_ORDER.length : index;
}

function evidenceKey(evidence: OntologyEvidence): string {
  return `${evidence.turn}:${evidence.source}:${evidence.text}`;
}

export function nodeText(node: ObsidianNodeLike): string {
  return (node.claim || node.snippet || node.label || '').trim();
}

export function typeLabel(type: string): string {
  if (type === 'topic') return '问题/主题';
  if (type === 'why') return '为什么';
  if (type === 'how_to') return '怎么做';
  if (type === 'pitfall') return '坑/教训';
  if (type === 'heuristic') return '经验法则';
  if (type === 'technique') return '工具/技巧';
  return type;
}

export function getKnowledgeCardContext(data: ObsidianOntologyDataLike, topicId: string): KnowledgeCardContext {
  if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
    throw new Error('本体数据结构不完整');
  }

  const topic = data.nodes.find((node) => node.id === topicId);
  if (!topic) throw new Error('主题节点不存在');
  if (topic.type !== 'topic') throw new Error('只有问题/主题节点可以同步到 Obsidian');

  const aggregate = topic.aggregateId
    ? data.aggregates?.find((item) => item.id === topic.aggregateId) || null
    : null;

  const aggregateNodes = topic.aggregateId
    ? data.nodes.filter((node) => node.aggregateId === topic.aggregateId)
    : [];

  const relatedIds = new Set<string>([topic.id]);
  if (aggregateNodes.length === 0) {
    for (const edge of data.edges) {
      if (edge.s === topic.id) relatedIds.add(edge.t);
      if (edge.t === topic.id) relatedIds.add(edge.s);
    }
  }

  const nodes = (aggregateNodes.length > 0 ? aggregateNodes : data.nodes.filter((node) => relatedIds.has(node.id)))
    .slice()
    .sort((a, b) => (
      typeRank(a.type) - typeRank(b.type)
      || a.firstTurn - b.firstTurn
      || a.label.localeCompare(b.label)
    ));

  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = data.edges
    .filter((edge) => nodeIds.has(edge.s) && nodeIds.has(edge.t))
    .slice()
    .sort((a, b) => (
      a.firstTurn - b.firstTurn
      || a.s.localeCompare(b.s)
      || a.t.localeCompare(b.t)
      || a.label.localeCompare(b.label)
    ));

  const evidenceMap = new Map<string, OntologyEvidence>();
  for (const node of nodes) {
    for (const evidence of node.evidence || []) {
      evidenceMap.set(evidenceKey(evidence), evidence);
    }
  }

  const evidence = Array.from(evidenceMap.values())
    .sort((a, b) => (
      a.turn - b.turn
      || b.weight - a.weight
      || a.source.localeCompare(b.source)
      || a.text.localeCompare(b.text)
    ));

  const turns = nodes.flatMap((node) => (
    node.turns && node.turns.length > 0 ? node.turns : [node.firstTurn]
  ));
  const startTurn = aggregate?.startTurn ?? Math.min(...turns, topic.firstTurn);
  const endTurn = aggregate?.endTurn ?? Math.max(...turns, topic.firstTurn);

  return {
    topic,
    aggregate,
    nodes,
    edges,
    evidence,
    types: data.types || [],
    title: aggregate?.label || topic.label,
    startTurn,
    endTurn,
  };
}
