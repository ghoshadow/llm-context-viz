import type { ShardFile } from '../content/extract-to-files.js';
import type { CandidateEntity } from '../../shared/pipeline/build-ontology.js';
import { jaccardSimilarity } from './ontology-merge.js';

const EVIDENCE_WEIGHT_CAP = {
  user: 1.0,
  reply: 0.9,
  tool_summary: 0.6,
  reasoning_summary: 0.45,
} as const;

function evidenceWeight(source: string, weight: number): number {
  const cap = EVIDENCE_WEIGHT_CAP[source as keyof typeof EVIDENCE_WEIGHT_CAP] ?? 0.45;
  const value = Number.isFinite(weight) ? weight : cap;
  return Math.max(0, Math.min(cap, value));
}

function evidenceScore(node: CandidateEntity): {
  score: number;
  hasPrimary: boolean;
  hasReasoningOnly: boolean;
  hasToolOnly: boolean;
  hasEvidence: boolean;
} {
  const evidence = node.evidence || [];
  if (evidence.length === 0) {
    return { score: 0.35, hasPrimary: false, hasReasoningOnly: false, hasToolOnly: false, hasEvidence: false };
  }
  const normalized = evidence.map((e) => evidenceWeight(e.source, e.weight));
  const top = Math.max(...normalized);
  const diversity = new Set(evidence.map((e) => e.source)).size;
  const repeatBonus = Math.min(0.16, Math.log1p(Math.max(0, evidence.length - 1)) * 0.06);
  const diversityBonus = Math.min(0.10, (diversity - 1) * 0.04);
  const score = Math.min(1, top + repeatBonus + diversityBonus);
  const hasPrimary = evidence.some((e) => e.source === 'user' || e.source === 'reply');
  const hasReasoningOnly = !hasPrimary && evidence.length > 0 && evidence.every((e) => e.source === 'reasoning_summary');
  const hasToolOnly = !hasPrimary && evidence.length > 0 && evidence.every((e) => e.source === 'tool_summary');
  return { score, hasPrimary, hasReasoningOnly, hasToolOnly, hasEvidence: true };
}

export function inferStatus(node: CandidateEntity): 'confirmed' | 'inferred' | 'needs_confirmation' {
  const ev = evidenceScore(node);
  if (ev.hasReasoningOnly) return 'needs_confirmation';
  if (ev.hasPrimary) return node.status === 'needs_confirmation' ? 'needs_confirmation' : 'confirmed';
  return 'inferred';
}

export function normalizeEvidence(node: CandidateEntity): void {
  const seen = new Set<string>();
  node.evidence = (node.evidence || [])
    .map((e) => ({
      ...e,
      text: e.text.length > 220 ? e.text.slice(0, 217) + '...' : e.text,
      weight: evidenceWeight(e.source, e.weight),
    }))
    .filter((e) => {
      const key = `${e.turn}:${e.source}:${e.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.turn - b.turn || b.weight - a.weight || a.source.localeCompare(b.source))
    .slice(0, 8);
}

function nodeShardCount(node: CandidateEntity, shards: ShardFile[]): number {
  const turns = new Set([
    node.firstTurn,
    ...(node.turns || []),
    ...(node.evidence || []).map((e) => e.turn),
  ].filter((turn) => Number.isFinite(turn)));
  const shardIds = new Set<number>();
  for (const turn of turns) {
    const shard = shards.find((s) => turn >= s.startTurn && turn <= s.endTurn);
    if (shard) shardIds.add(shard.index);
  }
  return Math.max(1, shardIds.size);
}

function snippetSupportsLabel(node: CandidateEntity): boolean {
  const snippet = (node.snippet || '').toLocaleLowerCase();
  if (!snippet) return false;
  const label = node.label.toLocaleLowerCase();
  const terms = [
    label,
    label.slice(0, 2),
    ...(node.aliases || []).map((alias) => alias.toLocaleLowerCase()),
  ].filter((term) => term.length >= 2);
  return terms.some((term) => snippet.includes(term));
}

/** 计算客观置信度 */
export function computeConf(node: CandidateEntity, shards: ShardFile[]): number {
  const ev = evidenceScore(node);
  const turnCount = new Set(node.turns || []).size;
  const turnSupport = Math.min(0.18, Math.log1p(Math.max(1, turnCount)) * 0.075);
  const rawConf = Math.max(0, Math.min(1, node.rawConf ?? node.conf ?? 0.5));
  const base = ev.score * 0.62 + turnSupport + rawConf * 0.12;
  const crossShardBonus = 1 + 0.06 * Math.min(nodeShardCount(node, shards) - 1, 3);
  const snippetMult = snippetSupportsLabel(node) ? 1.0 : 0.9;
  let conf = base * crossShardBonus * snippetMult;

  if (ev.hasReasoningOnly) {
    conf = Math.min(conf, 0.55);
  } else if (!ev.hasPrimary && ev.hasToolOnly) {
    conf = Math.min(conf, 0.65);
  } else if (!ev.hasPrimary) {
    conf = Math.min(conf, ev.hasEvidence ? 0.60 : 0.50);
  }

  return Math.min(0.95, Math.max(0.25, conf));
}

/** 跨分片语义去重：label Jaccard 相似度 > 0.7 的实体对合并 */
export function dedupByLabel(nodes: CandidateEntity[]): CandidateEntity[] {
  const result: CandidateEntity[] = [];
  const used = new Set<number>();

  for (let i = 0; i < nodes.length; i++) {
    if (used.has(i)) continue;
    let merged = { ...nodes[i]! };
    for (let j = i + 1; j < nodes.length; j++) {
      if (used.has(j)) continue;
      const sim = jaccardSimilarity(merged.label, nodes[j]!.label);
      if (sim > 0.7) {
        merged = {
          ...merged,
          turns: [...new Set([...merged.turns, ...nodes[j]!.turns])].sort((a, b) => a - b),
          aliases: [...new Set([...(merged.aliases || []), ...(nodes[j]!.aliases || [])])],
          evidence: [...(merged.evidence || []), ...(nodes[j]!.evidence || [])],
          firstTurn: Math.min(merged.firstTurn, nodes[j]!.firstTurn),
          conf: Math.max(merged.conf, nodes[j]!.conf),
          note: (merged.note || '') + ` 与「${nodes[j]!.label}」语义合并`,
        };
        used.add(j);
      }
    }
    result.push(merged);
  }
  return result;
}

/** snippet 质量检测 */
export function checkSnippetQuality(snippet: string, label: string): 'ok' | 'low' {
  for (let i = 0; i <= label.length - 2; i++) {
    if (snippet.includes(label.substring(i, i + 2))) return 'ok';
  }
  return 'low';
}
