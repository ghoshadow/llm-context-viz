import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOntologyGraphLayout } from './ontologyGraphLayout';

test('builds visible ontology graph layout with selected neighbors', () => {
  const layout = buildOntologyGraphLayout({
    data: {
      types: [{ key: 'topic', label: 'Topic', color: 'red' }],
      nodes: [
        {
          id: 'a',
          type: 'topic',
          label: 'Alpha',
          rawConf: 0.9,
          aliases: [],
          turns: [1],
          firstTurn: 1,
          conf: 0.9,
          status: 'confirmed',
          evidence: [],
          snippet: '',
        },
        {
          id: 'b',
          type: 'topic',
          label: 'Beta',
          rawConf: 0.8,
          aliases: [],
          turns: [2],
          firstTurn: 2,
          conf: 0.8,
          status: 'confirmed',
          evidence: [],
          snippet: '',
        },
      ],
      edges: [{ s: 'a', t: 'b', label: 'relates', conf: 0.7, firstTurn: 2, evidence: [] }],
      aggregates: [],
    },
    activeTypes: { topic: true },
    turn: 2,
    selectedNodeId: 'a',
  });

  assert.equal(layout.nodes.length, 2);
  assert.equal(layout.edges.length, 1);
  assert.equal(layout.neighborSet.has('b'), true);
});
