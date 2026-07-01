// ============================================================================
// Ontology Build Pipeline
//
// 5-stage declarative pipeline that transforms human/LLM-annotated candidate
// entities + semantic relations into the final knowledge graph (OntologyData).
//
// Stages:
//   1. Source Selection     — only natural-language text sources
//   2. Candidate Extraction — external (manual / LLM); passed in as input
//   3. Type Policy Filter   — keep only configured knowledge types
//   4. Disambiguation       — reclassify or merge ambiguous entities
//   5. Assembly & Validation — dedup edges, prune orphans, validate connectivity
//
// Usage:
//   import { buildOntology } from '../pipeline/build-ontology';
//   const result = buildOntology({ candidates, relations, config });
// ============================================================================

import type {
  OntologyData,
  OntologyNode,
  OntologyEdge,
  OntologyType,
  OntologyEvidence,
  OntologyEvidenceStatus,
  OntologyEdgeDirection,
} from '../types/ontology';

// ─── Type definitions for pipeline input ─────────────────────────────────────

/** Raw candidate entity (before filtering / reclassification). */
export interface CandidateEntity {
  id: string;
  label: string;
  type: string;
  conf: number;
  rawConf?: number;
  firstTurn: number;
  turns: number[];
  aliases?: string[];
  claim?: string;
  snippet: string;
  evidence?: OntologyEvidence[];
  status?: OntologyEvidenceStatus;
  snippetQuality?: 'ok' | 'low';
  note?: string;
  aggregateId?: string;
}

/** Raw semantic relation (between two entity IDs). */
export interface SemanticRelation {
  s: string;
  t: string;
  label: string;
  direction?: OntologyEdgeDirection;
  firstTurn: number;
  conf: number;
  evidence?: OntologyEvidence[];
}

/** All 6 knowledge type definitions. */
export const TYPE_DEFS: Record<string, { label: string; color: string }> = {
  topic:     { label: '问题/主题', color: 'oklch(0.80 0.12 0)' },
  how_to:    { label: '怎么做',   color: 'oklch(0.74 0.12 165)' },
  why:       { label: '为什么',   color: 'oklch(0.70 0.13 245)' },
  pitfall:   { label: '坑/教训',  color: 'oklch(0.66 0.17 25)' },
  heuristic: { label: '经验法则', color: 'oklch(0.78 0.13 60)' },
  technique: { label: '工具/技巧',color: 'oklch(0.74 0.11 210)' },
};

// ─── Pipeline configuration ─────────────────────────────────────────────────

export interface OntologyBuildConfig {
  /** Text sources used for extraction (metadata only). */
  sources?: string[];
  /** Which entity types to keep in the final graph. Default: all 6 knowledge types. */
  keepTypes?: string[];
  /** Reclassify entities: map entity ID → new type. */
  reclassify?: Record<string, string>;
  /** Whether to remove nodes with zero edges. Default: false. */
  pruneOrphans?: boolean;
  /** Max turn index for metadata. */
  maxTurn?: number;
}

export interface OntologyBuildInput {
  candidates: CandidateEntity[];
  relations: SemanticRelation[];
  config?: OntologyBuildConfig;
}

export interface OntologyBuildOutput {
  meta: {
    title: string;
    method: string;
    sources: string[];
    keptTypes: string[];
    filteredTypes: string[];
    reclassified: Record<string, string>;
    prunedOrphans: string[];
    disambiguated: string[];
    maxTurn: number;
    generatedAt: string;
  };
  stats: {
    candidates: number;
    nodes: number;
    edges: number;
    countByType: Record<string, number>;
  };
  data: OntologyData;
  aggregates?: Array<{ id: string; label: string; startTurn: number; endTurn: number; shardIndices: number[]; nodeIds: string[] }>;
  phaseThemes?: Array<{ shardIndex: number; startTurn: number; theme: string }>;
}

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_KEEP_TYPES = ['topic', 'why', 'how_to', 'pitfall', 'heuristic', 'technique'];

const DEFAULT_SOURCES = ['user', 'reply', 'reasoning_summary', 'tool_summary'];

// ─── Pipeline ────────────────────────────────────────────────────────────────

export function buildOntology(input: OntologyBuildInput): OntologyBuildOutput {
  const cfg = input.config || {};
  const keepTypes = cfg.keepTypes || DEFAULT_KEEP_TYPES;
  const sources = cfg.sources || DEFAULT_SOURCES;
  const reclassify = cfg.reclassify || {};
  const pruneOrphans = cfg.pruneOrphans === true; // default false — 不剪枝

  // ── Stage 3+4: Reclassify → Filter by keepTypes ──────────────────────
  const reclassified = input.candidates.map((e) => ({
    ...e,
    type: reclassify[e.id] || e.type,
  }));
  let nodes: CandidateEntity[] = reclassified.filter((e) => keepTypes.includes(e.type));
  const keptIds = new Set(nodes.map((n) => n.id));

  // ── Stage 5a: Keep edges where both endpoints survive filtering ───────
  const seen = new Set<string>();
  const edges: SemanticRelation[] = [];
  for (const r of input.relations) {
    if (!keptIds.has(r.s) || !keptIds.has(r.t)) continue;
    const direction = r.direction || 'directed';
    const key = direction === 'undirected'
      ? [[r.s, r.t].sort().join('--'), r.label, direction].join('::')
      : [r.s, r.t, r.label, direction].join('::');
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ ...r, direction });
  }

  // ── Stage 5b: Compute degree ──────────────────────────────────────────
  const degree: Record<string, number> = {};
  nodes.forEach((n) => (degree[n.id] = 0));
  edges.forEach((e) => {
    degree[e.s] = (degree[e.s] || 0) + 1;
    degree[e.t] = (degree[e.t] || 0) + 1;
  });

  // ── Stage 5c: Prune orphans ───────────────────────────────────────────
  const pruned: string[] = [];
  if (pruneOrphans) {
    const orphanIds = nodes.filter((n) => degree[n.id] === 0).map((n) => n.id);
    pruned.push(...orphanIds);
    nodes = nodes.filter((n) => (degree[n.id] ?? 0) > 0);
  }

  // ── Validate: every edge endpoint must exist ─────────────────────────
  const finalIds = new Set(nodes.map((n) => n.id));
  const dangling = edges.filter((e) => !finalIds.has(e.s) || !finalIds.has(e.t));
  if (dangling.length > 0) {
    throw new Error('Dangling edges after pruning: ' + JSON.stringify(dangling));
  }

  // ── Sort for deterministic output ─────────────────────────────────────
  nodes.sort((a, b) => b.conf - a.conf || a.id.localeCompare(b.id));
  edges.sort((a, b) => a.firstTurn - b.firstTurn || a.s.localeCompare(b.s));

  // ── Build type list ───────────────────────────────────────────────────
  const types: OntologyType[] = keepTypes
    .filter((k) => TYPE_DEFS[k])
    .map((k) => ({ key: k, label: TYPE_DEFS[k]!.label, color: TYPE_DEFS[k]!.color }));

  // ── Map to OntologyNode / OntologyEdge ────────────────────────────────
  const sortEvidence = <T extends { turn: number; weight: number; source: string }>(evidence?: T[]): T[] =>
    [...(evidence || [])].sort((a, b) => a.turn - b.turn || b.weight - a.weight || a.source.localeCompare(b.source));

  const outputNodes: OntologyNode[] = nodes.map((n) => ({
    id: n.id,
    label: n.label,
    type: n.type,
    rawConf: n.rawConf ?? n.conf,
    conf: n.conf,
    firstTurn: n.firstTurn,
    turns: n.turns,
    aliases: n.aliases || [],
    claim: n.claim,
    snippet: n.snippet,
    evidence: sortEvidence(n.evidence),
    status: n.status || 'inferred',
    snippetQuality: n.snippetQuality || 'ok',
    note: n.note,
    aggregateId: n.aggregateId,
  }));

  const outputEdges: OntologyEdge[] = edges.map((e) => ({
    s: e.s,
    t: e.t,
    label: e.label,
    direction: e.direction || 'directed',
    firstTurn: e.firstTurn,
    conf: e.conf,
    evidence: sortEvidence(e.evidence),
  }));

  // ── Stats ─────────────────────────────────────────────────────────────
  const countByType: Record<string, number> = {};
  keepTypes.forEach((k) => (countByType[k] = 0));
  outputNodes.forEach((n) => (countByType[n.type] = (countByType[n.type] || 0) + 1));

  const disambiguated = outputNodes.filter((n) => n.note).map((n) => n.id);
  const maxTurn = cfg.maxTurn || Math.max(...outputNodes.map((n) => n.firstTurn), 1);

  // Filtered types: all TYPE_DEFS keys except keepTypes
  const filteredTypes = Object.keys(TYPE_DEFS).filter((t) => !keepTypes.includes(t));

  return {
    meta: {
      title: '会话上下文本体 · 实体关系知识图谱',
      method:
        'Source Selection → Candidate Extraction → Type Policy Filter → Disambiguation → Assembly & Validation',
      sources,
      keptTypes: keepTypes,
      filteredTypes,
      reclassified: reclassify,
      prunedOrphans: pruned,
      disambiguated,
      maxTurn,
      generatedAt: new Date().toISOString(),
    },
    stats: {
      candidates: input.candidates.length,
      nodes: outputNodes.length,
      edges: outputEdges.length,
      countByType,
    },
    data: {
      types,
      aggregates: [],
      nodes: outputNodes,
      edges: outputEdges,
    },
  };
}
