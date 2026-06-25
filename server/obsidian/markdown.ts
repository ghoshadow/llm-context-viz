import crypto from 'crypto';
import { nodeText, typeLabel, type KnowledgeCardContext, type ObsidianEdgeLike } from './card-context';

export const MANAGED_START = '<!-- llm-context-viz:start -->';
export const MANAGED_END = '<!-- llm-context-viz:end -->';

const NODE_SECTION_TYPES = ['topic', 'why', 'how_to', 'pitfall', 'heuristic', 'technique'];
const OBSIDIAN_SOURCE_TAG = '来源/大模型上下文';
const OBSIDIAN_CARD_TYPE_TAG = '类型/本体卡片';
const OBSIDIAN_CONTEXT_SUMMARY_TAG = '类型/模型上下文总结';
const TAG_RENAMES: Record<string, string> = {
  '类型/对话总结': OBSIDIAN_CONTEXT_SUMMARY_TAG,
};
const LEGACY_MANAGED_TAGS = new Set(['llm-context', 'ontology-card']);
const MANAGED_TAG_PREFIXES = ['领域/', '主题/'];
const FRONTMATTER_KEYS = [
  'source',
  'session_id',
  'topic_id',
  'aggregate_id',
  'turn_range',
  'color_group',
  'color_group_label',
  'color_group_color',
  'synced_at',
  'tags',
];

export function sanitizeFilenamePart(value: string): string {
  return value
    .replace(/[\/\\:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    || '未命名知识卡片';
}

export function topicHash(sessionId: string, topicId: string): string {
  return crypto.createHash('sha1').update(`${sessionId}:${topicId}`).digest('hex').slice(0, 8);
}

function safeMarkdownText(value: string): string {
  return value
    .replaceAll(MANAGED_START, '<!-- llm-context-viz:start escaped -->')
    .replaceAll(MANAGED_END, '<!-- llm-context-viz:end escaped -->');
}

export function renderFilename(
  context: KnowledgeCardContext,
  sessionId: string,
  topicId: string,
  template = '第{{startTurn}}-{{endTurn}}轮 - {{title}} - {{topicHash}}.md',
): string {
  const values: Record<string, string> = {
    title: context.title,
    startTurn: String(context.startTurn).padStart(3, '0'),
    endTurn: String(context.endTurn).padStart(3, '0'),
    topicHash: topicHash(sessionId, topicId),
    sessionId,
    topicId,
  };
  const raw = template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => values[key] || '');
  const withoutExtension = raw.replace(/\.md$/i, '');
  return `${sanitizeFilenamePart(withoutExtension)}.md`;
}

function yamlString(value: string | null | undefined): string {
  const safe = String(value || '').replace(/"/g, '\\"');
  return `"${safe}"`;
}

function inferredContentText(context: KnowledgeCardContext): string {
  return [
    context.title,
    context.topic.label,
    context.topic.claim,
    context.topic.snippet,
    ...context.nodes.flatMap((node) => [node.label, node.claim, node.snippet, ...(node.aliases || [])]),
  ].filter(Boolean).join('\n');
}

function inferVaultTags(context: KnowledgeCardContext): string[] {
  const text = inferredContentText(context);
  const tags: string[] = [OBSIDIAN_CARD_TYPE_TAG, OBSIDIAN_CONTEXT_SUMMARY_TAG];

  if (/智能体|Agent|agent|子代理|subagent|主代理/.test(text)) tags.push('领域/智能体');
  if (/软件工程|代码库|代码执行|源码|项目结构|代码重构|工程重构/.test(text)) tags.push('领域/软件工程');
  if (/知识管理|知识库|Obsidian|标签体系|vault/i.test(text)) tags.push('领域/知识管理');
  if (/本体建模|本体构建|本体图谱|ontology/i.test(text)) tags.push('领域/本体');
  if (/数字分身|数字人|张大仙|大仙/.test(text)) tags.push('领域/数字分身');

  if (/代码执行|执行分析|工具调用/.test(text)) tags.push('主题/代码执行分析');
  if (/代码库|源码|项目结构|大型代码/.test(text)) tags.push('主题/代码库分析');
  if (/角色扮演/.test(text)) tags.push('主题/角色扮演训练');
  if (/模型训练|微调|训练|LoRA|DPO|loss|embedding|词表/.test(text)) tags.push('主题/模型训练');

  return tags;
}

function normalizeTag(value: string): string {
  const normalized = value.trim().replace(/^#/, '').replace(/^['"]|['"]$/g, '');
  return TAG_RENAMES[normalized] || normalized;
}

function isManagedTag(tag: string): boolean {
  const normalized = normalizeTag(tag);
  return (
    normalized === OBSIDIAN_SOURCE_TAG
    || normalized === OBSIDIAN_CARD_TYPE_TAG
    || normalized === OBSIDIAN_CONTEXT_SUMMARY_TAG
    || LEGACY_MANAGED_TAGS.has(normalized)
    || MANAGED_TAG_PREFIXES.some((prefix) => normalized.startsWith(prefix))
    || normalized.startsWith('本体颜色/')
    || normalized.startsWith('ontology-color/')
  );
}

function parseInlineTags(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map(normalizeTag)
      .filter(Boolean);
  }
  return [normalizeTag(trimmed)].filter(Boolean);
}

function mergeTags(managed: string[], existing: string[]): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const tag of [...managed, ...existing]) {
    const normalized = normalizeTag(tag);
    if (!normalized || seen.has(normalized)) continue;
    if (managed.includes(tag) || !isManagedTag(normalized)) {
      tags.push(normalized);
      seen.add(normalized);
    }
  }
  return tags;
}

function renderTagLines(tags: string[]): string[] {
  return ['tags:', ...tags.map((tag) => `  - ${tag}`)];
}

function renderFrontmatter(params: {
  sessionId: string;
  topicId: string;
  context: KnowledgeCardContext;
  syncedAt: string;
}): string {
  const { context, sessionId, topicId, syncedAt } = params;
  return [
    'source: llm-context-viz',
    `session_id: ${yamlString(sessionId)}`,
    `topic_id: ${yamlString(topicId)}`,
    `aggregate_id: ${yamlString(context.aggregate?.id || '')}`,
    `turn_range: ${yamlString(`${context.startTurn}-${context.endTurn}`)}`,
    `synced_at: ${yamlString(syncedAt)}`,
    ...renderTagLines(inferVaultTags(context)),
  ].filter((line): line is string => typeof line === 'string').join('\n');
}

export function renderManagedFrontmatter(params: {
  sessionId: string;
  topicId: string;
  context: KnowledgeCardContext;
  syncedAt: string;
}): string {
  return `---\n${renderFrontmatter(params)}\n---`;
}

export function mergeManagedFrontmatter(existing: string, managed: string): string {
  const match = existing.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return `${managed}\n\n${existing}`;

  const bodyStart = match[0].length;
  const existingLines = match[1]!.split(/\r?\n/);
  const existingTags: string[] = [];
  const kept: string[] = [];
  for (let i = 0; i < existingLines.length; i++) {
    const line = existingLines[i]!;
    const key = line.match(/^([A-Za-z0-9_-]+):/)?.[1];
    if (key && FRONTMATTER_KEYS.includes(key)) {
      if (key === 'tags') {
        const inlineValue = line.replace(/^tags:\s*/, '');
        existingTags.push(...parseInlineTags(inlineValue));
        while (i + 1 < existingLines.length && /^\s+-\s+/.test(existingLines[i + 1]!)) {
          i++;
          existingTags.push(normalizeTag(existingLines[i]!.replace(/^\s+-\s+/, '')));
        }
      } else {
        while (i + 1 < existingLines.length && /^\s+-\s+/.test(existingLines[i + 1]!)) i++;
      }
      continue;
    }
    kept.push(line);
  }

  const managedBody = managed.replace(/^---\r?\n/, '').replace(/\r?\n---$/, '');
  const managedLines = managedBody.split(/\r?\n/);
  const managedTags: string[] = [];
  const rebuiltManaged: string[] = [];
  for (let i = 0; i < managedLines.length; i++) {
    const line = managedLines[i]!;
    if (/^tags:/.test(line)) {
      managedTags.push(...parseInlineTags(line.replace(/^tags:\s*/, '')));
      while (i + 1 < managedLines.length && /^\s+-\s+/.test(managedLines[i + 1]!)) {
        i++;
        managedTags.push(normalizeTag(managedLines[i]!.replace(/^\s+-\s+/, '')));
      }
      rebuiltManaged.push(...renderTagLines(mergeTags(managedTags, existingTags)));
      continue;
    }
    rebuiltManaged.push(line);
  }

  const mergedBody = [rebuiltManaged.join('\n'), ...kept.filter((line) => line.trim())].join('\n');
  return `---\n${mergedBody}\n---${existing.slice(bodyStart)}`;
}

function relationArrow(edge: ObsidianEdgeLike): string {
  const label = safeMarkdownText(edge.label);
  if (edge.direction === 'undirected') return `--${label}--`;
  if (edge.direction === 'bidirectional') return `<--${label}-->`;
  return `--${label}-->`;
}

function renderNodeSection(context: KnowledgeCardContext, type: string): string {
  const nodes = context.nodes.filter((node) => node.type === type);
  if (nodes.length === 0) return '';

  const lines = [`### ${typeLabel(type)}`, ''];
  for (const node of nodes) {
    lines.push(`- **${safeMarkdownText(node.label)}**：${safeMarkdownText(nodeText(node) || node.label)}`);
    if (node.aliases && node.aliases.length > 0) {
      lines.push(`  - 别名：${node.aliases.map(safeMarkdownText).join('、')}`);
    }
  }
  lines.push('');

  return lines.join('\n');
}

export function renderManagedCardMarkdown(params: {
  sessionId: string;
  topicId: string;
  context: KnowledgeCardContext;
  summary: string | null;
  syncedAt: string;
}): string {
  const { sessionId, topicId, context, summary } = params;
  const nodeById = new Map(context.nodes.map((node) => [node.id, node]));
  const lines: string[] = [];

  lines.push(MANAGED_START, '');

  if (summary && summary.trim()) {
    lines.push('## 知识总结', '', safeMarkdownText(summary.trim()), '');
  }

  lines.push('## 知识链路', '');
  for (const type of NODE_SECTION_TYPES) {
    const section = renderNodeSection(context, type);
    if (section) lines.push(section);
  }

  if (context.edges.length > 0) {
    lines.push('## 关系', '');
    for (const edge of context.edges) {
      const source = safeMarkdownText(nodeById.get(edge.s)?.label || edge.s);
      const target = safeMarkdownText(nodeById.get(edge.t)?.label || edge.t);
      lines.push(`- ${source} ${relationArrow(edge)} ${target}`);
    }
    lines.push('');
  }

  if (context.evidence.length > 0) {
    lines.push('## 证据', '');
    lines.push('说明：支撑权重表示该原文片段对当前节点的匹配和支撑强度，不是节点整体置信度。', '');
    for (const evidence of context.evidence) {
      lines.push(`- 第 ${evidence.turn} 轮 · ${safeMarkdownText(evidence.source)} · 支撑权重 ${Math.round(evidence.weight * 100)}%: ${safeMarkdownText(evidence.text)}`);
    }
    lines.push('');
  }

  lines.push(MANAGED_END);

  return lines.join('\n').trimEnd() + '\n';
}

export function renderFullNoteMarkdown(params: {
  sessionId: string;
  topicId: string;
  context: KnowledgeCardContext;
  summary: string | null;
  syncedAt: string;
}): string {
  const { context } = params;
  const frontmatter = `${renderManagedFrontmatter(params)}\n\n# ${safeMarkdownText(context.title)}\n\n`;

  return `${frontmatter}${renderManagedCardMarkdown(params)}\n## 我的补充\n\n`;
}

export function contentHash(content: string): string {
  return crypto.createHash('sha1').update(content).digest('hex');
}
