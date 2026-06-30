import crypto from 'crypto';
import { getDb } from '../db';
import {
  nodeText,
  type ObsidianNodeLike,
  type ObsidianOntologyDataLike,
} from '../obsidian/card-context';
import { callLLM } from '../llm/client';
import { DEFAULT_MODEL } from '../llm/config';
import {
  finishCardSummarySuccess,
  finishCardSummaryError,
} from '../repositories/ontology-repository';
import { sanitizeForLog } from '../utils/log-sanitizer.js';

/**
 * 转义 XML 特殊字符，防止用户数据中的 XML 标签破坏 prompt 结构
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ============================================================================
// Types
// ============================================================================

export type CardSummaryStatus = 'not_started' | 'running' | 'done' | 'error';

export interface CardSummaryRecord {
  session_id: string;
  topic_id: string;
  status: CardSummaryStatus;
  summary: string | null;
  error: string | null;
  model: string | null;
  prompt_hash: string | null;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
}

// ============================================================================
// Prompt building
// ============================================================================

export function ontologyTypeLabel(data: ObsidianOntologyDataLike, type: string): string {
  return data.types?.find((t) => t.key === type)?.label || type;
}

function getOntologyCardNodes(topic: ObsidianNodeLike, data: ObsidianOntologyDataLike): ObsidianNodeLike[] {
  const aggregateNodes = topic.aggregateId
    ? data.nodes.filter((n) => n.aggregateId === topic.aggregateId)
    : [];
  if (aggregateNodes.length > 0) return aggregateNodes;

  const relatedIds = new Set<string>([topic.id]);
  data.edges.forEach((edge) => {
    if (edge.s === topic.id) relatedIds.add(edge.t);
    if (edge.t === topic.id) relatedIds.add(edge.s);
  });
  return data.nodes.filter((n) => relatedIds.has(n.id));
}

export function buildKnowledgeCardSummaryPrompt(data: ObsidianOntologyDataLike, topicId: string): string {
  const topic = data.nodes.find((n) => n.id === topicId);
  if (!topic) throw new Error('主题节点不存在');
  if (topic.type !== 'topic') throw new Error('只有问题/主题节点可以生成知识总结');

  const aggregate = topic.aggregateId ? data.aggregates?.find((a) => a.id === topic.aggregateId) : undefined;
  const cardNodes = getOntologyCardNodes(topic, data);
  const cardNodeIds = new Set(cardNodes.map((n) => n.id));
  const cardEdges = data.edges.filter((e) => cardNodeIds.has(e.s) && cardNodeIds.has(e.t));
  const nodeById = new Map(cardNodes.map((n) => [n.id, n]));

  const orderedNodes = [...cardNodes].sort((a, b) => {
    const typeOrder = ['topic', 'why', 'how_to', 'pitfall', 'heuristic', 'technique'];
    return (typeOrder.indexOf(a.type) === -1 ? 99 : typeOrder.indexOf(a.type))
      - (typeOrder.indexOf(b.type) === -1 ? 99 : typeOrder.indexOf(b.type))
      || a.firstTurn - b.firstTurn
      || a.label.localeCompare(b.label);
  });

  const nodesText = orderedNodes.map((node) => {
    const evidence = (node.evidence || [])
      .slice()
      .sort((a, b) => a.turn - b.turn || b.weight - a.weight)
      .slice(0, 3)
      .map((ev) => `    - 第${ev.turn}轮/${ev.source}/${Math.round(ev.weight * 100)}%：${ev.text}`)
      .join('\n');
    return [
      `- [${ontologyTypeLabel(data, node.type)}] ${node.label}`,
      `  id: ${node.id}`,
      `  首现: 第${node.firstTurn}轮；出现轮次: ${(node.turns || [node.firstTurn]).join(', ')}`,
      `  知识内容: ${nodeText(node)}`,
      evidence ? `  证据:\n${evidence}` : '',
    ].filter(Boolean).join('\n');
  }).join('\n\n');

  const edgesText = cardEdges.map((edge) => {
    const source = nodeById.get(edge.s);
    const target = nodeById.get(edge.t);
    const dir = edge.direction === 'undirected' ? `--${edge.label}--`
      : edge.direction === 'bidirectional' ? `<--${edge.label}-->`
        : `--${edge.label}-->`;
    return `- ${source?.label || edge.s} ${dir} ${target?.label || edge.t}（第${edge.firstTurn}轮）`;
  }).join('\n');

  return `你是一个负责把对话本体沉淀整理成知识卡片总结的中文知识工程助手。

请基于下面给出的「一个知识卡片」内的主题、节点、关系和证据，生成一段面向用户复盘的知识总结。

要求：
1. 不要只是罗列节点，要把节点内容串成完整理解链路。
2. 必须以「问题/主题」为核心，按照「为什么 → 怎么做 → 坑/教训 → 经验法则 → 工具/技巧」的逻辑组织。
3. 只使用给定节点、关系和证据中的信息，不要编造外部事实。
4. 如果某一类信息缺失，可以自然跳过，不要写"暂无"。
5. 总结要具体、可读，适合放在右侧详情面板，控制在 500-900 字。
6. 末尾给出 3-5 条"可复用要点"，每条一句话。

<user_card_data>
<card_title>${escapeXml(String(aggregate?.label || topic.label))}</card_title>
<turn_range>${escapeXml(String(aggregate ? `第${aggregate.startTurn}-${aggregate.endTurn}轮` : `围绕第${topic.firstTurn}轮`))}</turn_range>

<card_nodes>
${nodesText}
</card_nodes>

<card_edges>
${edgesText || '无显式关系'}
</card_edges>
</user_card_data>

请直接输出总结正文，不要输出 JSON，不要解释你的生成过程。`;
}

// ============================================================================
// LLM invocation
// ============================================================================

async function runKnowledgeSummaryLLM(prompt: string): Promise<string> {
  try {
    return await callLLM(prompt);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error('LLM 未返回知识总结: ' + message);
  }
}

// ============================================================================
// Status query
// ============================================================================

const cardSummaryJobs = new Set<string>();

export function getCardSummaryStatus(sessionId: string, topicId: string): {
  topicId: string;
  status: CardSummaryStatus;
  summary: string | null;
  error: string | null;
  updatedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
} {
  const db = getDb();
  const row = db.prepare(`
    SELECT session_id, topic_id, status, summary, error, model, prompt_hash, updated_at, started_at, completed_at
    FROM ontology_card_summaries
    WHERE session_id = ? AND topic_id = ?
  `).get(sessionId, topicId) as CardSummaryRecord | undefined;

  if (!row) {
    return { topicId, status: 'not_started', summary: null, error: null, updatedAt: null, startedAt: null, completedAt: null };
  }

  if (row.status === 'running' && !cardSummaryJobs.has(`${sessionId}:${topicId}`)) {
    const interrupted = '总结任务已中断，请重新生成';
    db.prepare(`
      UPDATE ontology_card_summaries
      SET status = 'error',
          error = ?,
          completed_at = datetime('now'),
          updated_at = datetime('now')
      WHERE session_id = ? AND topic_id = ?
    `).run(interrupted, sessionId, topicId);
    return {
      topicId, status: 'error', summary: row.summary, error: interrupted,
      updatedAt: new Date().toISOString(), startedAt: row.started_at, completedAt: new Date().toISOString(),
    };
  }

  return {
    topicId, status: row.status, summary: row.summary, error: row.error,
    updatedAt: row.updated_at, startedAt: row.started_at, completedAt: row.completed_at,
  };
}

// ============================================================================
// Background job launcher
// ============================================================================

export function startCardSummaryJob(sessionId: string, topicId: string, prompt: string): void {
  const jobKey = `${sessionId}:${topicId}`;
  if (cardSummaryJobs.has(jobKey)) return;

  cardSummaryJobs.add(jobKey);
  const model = process.env.LLM_MODEL || DEFAULT_MODEL;
  const promptHash = crypto.createHash('sha1').update(prompt).digest('hex');
  const db = getDb();
  db.prepare(`
    INSERT INTO ontology_card_summaries (
      session_id, topic_id, status, summary, error, model, prompt_hash,
      started_at, updated_at
    )
    VALUES (?, ?, 'running', NULL, NULL, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(session_id, topic_id) DO UPDATE SET
      status = 'running', summary = NULL, error = NULL,
      model = excluded.model, prompt_hash = excluded.prompt_hash,
      started_at = datetime('now'), completed_at = NULL, updated_at = datetime('now')
  `).run(sessionId, topicId, model, promptHash);

  // 使用 setImmediate + try-catch 包裹，防止 fire-and-forget 中的未处理异常
  // 导致进程崩溃（unhandled rejection）
  setImmediate(() => {
    (async () => {
      try {
        const summary = await runKnowledgeSummaryLLM(prompt);
        try {
          finishCardSummarySuccess(sessionId, topicId, summary);
        } catch (dbErr) {
          console.error('更新知识总结状态(done)失败:', sanitizeForLog(dbErr instanceof Error ? dbErr.message : String(dbErr)));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('知识总结生成失败:', sanitizeForLog(message));
        try {
          finishCardSummaryError(sessionId, topicId, message);
        } catch (dbErr) {
          console.error('更新知识总结状态(error)失败:', sanitizeForLog(dbErr instanceof Error ? dbErr.message : String(dbErr)));
        }
      } finally {
        cardSummaryJobs.delete(jobKey);
      }
    })().catch((outerErr) => {
      // 兜底：即使 finally 中的 delete 抛出异常，也不会升级为 unhandled rejection
      console.error('知识总结后台任务外层异常:', sanitizeForLog(outerErr instanceof Error ? outerErr.message : String(outerErr)));
      cardSummaryJobs.delete(jobKey);
    });
  });
}
