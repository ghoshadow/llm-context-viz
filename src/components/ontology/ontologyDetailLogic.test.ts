import assert from 'node:assert/strict';
import test from 'node:test';
import type { OntologyData, OntologyEvidence, OntologyNode } from '../../types/ontology';
import {
  buildConfidenceNotes,
  getCardNodes,
  sortedEvidence,
  sourceLabel,
  statusLabel,
} from './ontologyDetailLogic';

test('sorts evidence by turn, weight, then source', () => {
  const evidence: OntologyEvidence[] = [
    { turn: 2, source: 'reply', text: 'b', weight: 0.2 },
    { turn: 1, source: 'tool_summary', text: 'c', weight: 0.5 },
    { turn: 1, source: 'reply', text: 'a', weight: 0.9 },
  ];

  assert.deepEqual(sortedEvidence(evidence).map((ev) => ev.text), ['a', 'c', 'b']);
});

test('labels known evidence sources and statuses', () => {
  assert.equal(sourceLabel('tool_summary'), '工具摘要');
  assert.equal(sourceLabel('custom'), 'custom');
  assert.deepEqual(statusLabel('confirmed'), { label: '已确认', color: 'oklch(0.78 0.12 150)' });
  assert.deepEqual(statusLabel(undefined), { label: '推断', color: 'oklch(0.74 0.10 210)' });
});

test('builds confidence notes with cap rules', () => {
  const node = nodeLike({ turns: [1, 3], firstTurn: 1, snippetQuality: 'low' });
  const notes = buildConfidenceNotes(node, [
    { turn: 1, source: 'reasoning_summary', text: 'r1', weight: 0.4 },
    { turn: 3, source: 'reasoning_summary', text: 'r2', weight: 0.3 },
  ]);

  assert.equal(notes[0], '证据来源：推理摘要2');
  assert.equal(notes[1], '复现程度：出现于 2 轮，首现第 1 轮');
  assert.ok(notes.includes('封顶规则：仅由推理摘要支撑，最高按 55% 处理'));
  assert.ok(notes.includes('片段质量：原文片段与节点标签匹配较弱，已降低权重'));
});

test('uses aggregate nodes for knowledge card nodes before edge neighbors', () => {
  const topic = nodeLike({ id: 'topic', aggregateId: 'card-a' });
  const peer = nodeLike({ id: 'peer', aggregateId: 'card-a' });
  const neighbor = nodeLike({ id: 'neighbor' });
  const data: OntologyData = {
    types: [],
    nodes: [topic, peer, neighbor],
    edges: [{ s: 'topic', t: 'neighbor', label: 'rel', firstTurn: 1, conf: 0.8 }],
  };

  assert.deepEqual(getCardNodes(topic, data).map((n) => n.id), ['topic', 'peer']);
});

function nodeLike(overrides: Partial<OntologyNode> = {}): OntologyNode {
  return {
    id: 'n1',
    label: 'Node',
    type: 'topic',
    aliases: [],
    turns: [1],
    firstTurn: 1,
    rawConf: 0.9,
    conf: 0.9,
    evidence: [],
    snippet: 'snippet',
    snippetQuality: 'ok',
    ...overrides,
  };
}
