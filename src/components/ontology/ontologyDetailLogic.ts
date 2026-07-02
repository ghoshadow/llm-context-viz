import type { OntologyData, OntologyEvidence, OntologyNode } from '../../types/ontology';

export function confColor(c: number): string {
  if (c >= 0.85) return 'oklch(0.78 0.12 150)';
  if (c >= 0.7) return 'oklch(0.80 0.11 95)';
  return 'oklch(0.76 0.13 45)';
}

export function sourceLabel(source: string): string {
  if (source === 'user') return '用户';
  if (source === 'reply') return '回复';
  if (source === 'tool_summary') return '工具摘要';
  if (source === 'reasoning_summary') return '推理摘要';
  return source;
}

export function sortedEvidence(evidence: OntologyEvidence[]): OntologyEvidence[] {
  return [...evidence].sort((a, b) => a.turn - b.turn || b.weight - a.weight || a.source.localeCompare(b.source));
}

export function statusLabel(status?: string): { label: string; color: string } {
  if (status === 'confirmed') return { label: '已确认', color: 'oklch(0.78 0.12 150)' };
  if (status === 'needs_confirmation') return { label: '待确认', color: 'oklch(0.78 0.13 45)' };
  return { label: '推断', color: 'oklch(0.74 0.10 210)' };
}

export function buildConfidenceNotes(node: OntologyNode, evidence: OntologyEvidence[]): string[] {
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

export function getCardNodes(topic: OntologyNode, data: OntologyData): OntologyNode[] {
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
