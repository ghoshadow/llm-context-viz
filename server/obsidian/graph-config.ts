import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { sanitizeForLog } from '../utils/log-sanitizer.js';

const OBSOLETE_ONTOLOGY_GRAPH_QUERIES = new Set<string>([
  { query: 'tag:#来源/大模型上下文', rgb: 14701138 },
  { query: 'tag:#本体颜色/主题', rgb: 16620730 },
  { query: 'tag:#本体颜色/原因', rgb: 5220073 },
  { query: 'tag:#本体颜色/方法', rgb: 5555096 },
  { query: 'tag:#本体颜色/陷阱', rgb: 15229019 },
  { query: 'tag:#本体颜色/经验法则', rgb: 16032348 },
  { query: 'tag:#本体颜色/技术', rgb: 4308433 },
].map((group) => group.query));

const LEGACY_ONTOLOGY_GRAPH_QUERIES = new Set<string>([
  'tag:#ontology-color/topic',
  'tag:#ontology-color/why',
  'tag:#ontology-color/how_to',
  'tag:#ontology-color/pitfall',
  'tag:#ontology-color/heuristic',
  'tag:#ontology-color/technique',
]);

interface GraphColorGroup {
  query: string;
  color: { a: number; rgb: number };
}

interface GraphConfig {
  [key: string]: unknown;
  colorGroups?: GraphColorGroup[];
}

export function ensureOntologyGraphColorGroups(vaultRoot: string): void {
  let obsidianDir: string;
  let graphPath: string;
  let config: GraphConfig;

  try {
    obsidianDir = path.join(vaultRoot, '.obsidian');
    graphPath = path.join(obsidianDir, 'graph.json');

    if (!existsSync(obsidianDir) || !existsSync(graphPath)) return;

    config = JSON.parse(readFileSync(graphPath, 'utf-8')) as GraphConfig;
  } catch (err) {
    console.error('[ensureOntologyGraphColorGroups] 读取 graph.json 失败:', sanitizeForLog(err instanceof Error ? err.message : String(err)));
    return;
  }

  try {
    const existing = Array.isArray(config.colorGroups) ? config.colorGroups : [];
    config.colorGroups = existing.filter((group) => {
      const query = (group.query ?? '').trim();
      return !LEGACY_ONTOLOGY_GRAPH_QUERIES.has(query) && !OBSOLETE_ONTOLOGY_GRAPH_QUERIES.has(query);
    });
    writeFileSync(graphPath!, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
  } catch (err) {
    console.error('[ensureOntologyGraphColorGroups] 写入 graph.json 失败:', sanitizeForLog(err instanceof Error ? err.message : String(err)));
  }
}
