import type { OntologyType } from '../../types/ontology';

export const ONTOLOGY_TYPE_ORDER = ['topic', 'why', 'how_to', 'pitfall', 'heuristic', 'technique'];

export function ontologyTypeSortKey(type: string): number {
  const idx = ONTOLOGY_TYPE_ORDER.indexOf(type);
  return idx === -1 ? ONTOLOGY_TYPE_ORDER.length + 1 : idx;
}

export function sortOntologyTypes(types: OntologyType[]): OntologyType[] {
  return [...types].sort((a, b) => ontologyTypeSortKey(a.key) - ontologyTypeSortKey(b.key) || a.label.localeCompare(b.label));
}
