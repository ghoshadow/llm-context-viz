import type { ExtractionManifest } from '../content/extract-to-files.js';
import type { CandidateEntity, OntologyBuildConfig, SemanticRelation } from '../../shared/pipeline/build-ontology.js';
import type { ShardResult } from './extract-ontology.js';

interface Aggregate {
  id: string;
  label: string;
  startTurn: number;
  endTurn: number;
  shardIndices: number[];
  nodeIds: string[];
}

export function buildAggregates(
  themes: Array<{ shardIndex: number; startTurn: number; theme: string }>,
  manifest: ExtractionManifest,
): Aggregate[] {
  if (themes.length === 0) return [];
  const sorted = [...themes].sort((a, b) => a.shardIndex - b.shardIndex);
  const aggregates: Aggregate[] = [];
  let current: Aggregate | null = null;

  for (const t of sorted) {
    if (current && current.label === t.theme) {
      // 相同主题：扩展当前聚合
      current.endTurn = manifest.shards.find((s) => s.index === t.shardIndex)?.endTurn ?? t.startTurn;
      current.shardIndices.push(t.shardIndex);
    } else {
      if (current) aggregates.push(current);
      current = {
        id: `agg_${String(aggregates.length).padStart(3, '0')}`,
        label: t.theme,
        startTurn: t.startTurn,
        endTurn: manifest.shards.find((s) => s.index === t.shardIndex)?.endTurn ?? t.startTurn,
        shardIndices: [t.shardIndex],
        nodeIds: [],
      };
    }
  }
  if (current) aggregates.push(current);

  // 合并相似标签的相邻聚合
  return mergeSimilarAggregates(aggregates);
}

function mergeSimilarAggregates(aggs: Aggregate[]): Aggregate[] {
  if (aggs.length <= 1) return aggs;
  const result: Aggregate[] = [aggs[0]!];
  for (let i = 1; i < aggs.length; i++) {
    const prev = result[result.length - 1]!;
    const curr = aggs[i]!;
    if (jaccardSimilarity(prev.label, curr.label) > 0.5) {
      prev.label = prev.label.length <= curr.label.length ? prev.label : curr.label;
      prev.endTurn = curr.endTurn;
      prev.shardIndices = [...new Set([...prev.shardIndices, ...curr.shardIndices])];
      prev.nodeIds = [...new Set([...prev.nodeIds, ...curr.nodeIds])];
    } else {
      result.push(curr);
    }
  }
  return result;
}

export function mergeResults(results: ShardResult[], maxTurn: number): {
  candidates: CandidateEntity[];
  relations: SemanticRelation[];
  config: OntologyBuildConfig;
} {
  const candidateMap = new Map<string, CandidateEntity>();
  for (const shard of results) {
    for (const c of shard.candidates) {
      const existing = candidateMap.get(c.id);
      if (!existing || c.conf > existing.conf) {
        candidateMap.set(c.id, {
          ...c,
          turns: [...new Set([...(existing?.turns || []), ...c.turns])].sort((a, b) => a - b),
          aliases: [...new Set([...(existing?.aliases || []), ...(c.aliases || [])])],
          evidence: [...(existing?.evidence || []), ...(c.evidence || [])],
          firstTurn: existing ? Math.min(existing.firstTurn, c.firstTurn) : c.firstTurn,
        });
      } else {
        candidateMap.set(c.id, {
          ...existing,
          turns: [...new Set([...existing.turns, ...c.turns])].sort((a, b) => a - b),
          aliases: [...new Set([...(existing.aliases || []), ...(c.aliases || [])])],
          evidence: [...(existing.evidence || []), ...(c.evidence || [])],
        });
      }
    }
  }

  // 边方向保留：不排序 s,t
  const relationMap = new Map<string, SemanticRelation>();
  for (const shard of results) {
    for (const r of shard.relations) {
      const key = [r.s, r.t, r.label].join('::');
      const existing = relationMap.get(key);
      if (!existing || r.conf > existing.conf) {
        relationMap.set(key, {
          ...r,
          firstTurn: existing ? Math.min(existing.firstTurn, r.firstTurn) : r.firstTurn,
          evidence: [...(existing?.evidence || []), ...(r.evidence || [])],
        });
      } else {
        relationMap.set(key, {
          ...existing,
          firstTurn: Math.min(existing.firstTurn, r.firstTurn),
          evidence: [...(existing.evidence || []), ...(r.evidence || [])],
        });
      }
    }
  }

  const mergedConfig: OntologyBuildConfig = {};
  for (const shard of results) {
    if (shard.config) {
      Object.assign(mergedConfig, shard.config);
      if (shard.config.reclassify) {
        mergedConfig.reclassify = { ...(mergedConfig.reclassify || {}), ...shard.config.reclassify };
      }
    }
  }

  return { candidates: Array.from(candidateMap.values()), relations: Array.from(relationMap.values()), config: mergedConfig };
}

export function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}
