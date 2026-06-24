// ============================================================================
// Context Ontology Types — DDD 聚合根 + 知识图谱
// ============================================================================

/** Entity type descriptor. */
export interface OntologyType {
  key: string;
  label: string;
  color: string;
}

/** DDD Aggregate Root — a named topic boundary grouping related entities. */
export interface Aggregate {
  id: string;
  label: string;
  startTurn: number;
  endTurn: number;
  shardIndices: number[];
  nodeIds: string[];
}

/** Entity (node) in the knowledge graph. */
export interface OntologyNode {
  id: string;
  label: string;
  type: string;
  /** LLM raw confidence. Not displayed. */
  rawConf: number;
  /** Computed confidence 0-1. Displayed in UI. */
  conf: number;
  /** 1-based turn index where the entity first appears. */
  firstTurn: number;
  /** All turn indices this entity appears in. */
  turns: number[];
  /** Alternative names. */
  aliases: string[];
  /** Excerpt from the conversation. */
  snippet: string;
  /** Snippet quality: 'ok' or 'low'. */
  snippetQuality?: 'ok' | 'low';
  /** Optional disambiguation note. */
  note?: string;
  /** Owning aggregate ID. */
  aggregateId?: string;
}

/** Relationship (edge) between two entities. Directed. */
export interface OntologyEdge {
  s: string;
  t: string;
  label: string;
  firstTurn: number;
  conf: number;
}

/** Complete ontology dataset for a session. */
export interface OntologyData {
  types: OntologyType[];
  /** Topic-boundary groups. Manual builds may leave this empty. */
  aggregates?: Aggregate[];
  nodes: OntologyNode[];
  edges: OntologyEdge[];
  phaseThemes?: PhaseTheme[];
}

/** Phase theme marker (legacy — replaced by Aggregate for display). */
export interface PhaseTheme {
  shardIndex: number;
  startTurn: number;
  theme: string;
}
