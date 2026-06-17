// ============================================================================
// Context Ontology Types — knowledge graph extracted from conversation semantics
//
// Entities and relationships are derived from user messages, assistant replies,
// and reasoning — filtered to retain only mechanism/concept, Agent, and system
// entities (excluding error strings, function names, code files, etc.).
// ============================================================================

/** Entity type descriptor (e.g. mechanism, agent, system). */
export interface OntologyType {
  key: string;
  label: string;
  color: string;
}

/** Entity (node) in the knowledge graph. */
export interface OntologyNode {
  id: string;
  label: string;
  type: string;
  /** Confidence score 0-1. */
  conf: number;
  /** 1-based turn index where the entity first appears. */
  firstTurn: number;
  /** All turn indices this entity appears in. */
  turns: number[];
  /** Alternative names used for this entity. */
  aliases: string[];
  /** Excerpt from the conversation where this entity was identified. */
  snippet: string;
  /** Optional disambiguation / conflict-resolution note. */
  note?: string;
}

/** Relationship (edge) between two entities. */
export interface OntologyEdge {
  /** Source node id. */
  s: string;
  /** Target node id. */
  t: string;
  /** Relationship label describing the connection. */
  label: string;
  /** 1-based turn index where the relationship first appears. */
  firstTurn: number;
  /** Confidence score 0-1. */
  conf: number;
}

/** Complete ontology dataset for a session. */
export interface OntologyData {
  types: OntologyType[];
  nodes: OntologyNode[];
  edges: OntologyEdge[];
}
