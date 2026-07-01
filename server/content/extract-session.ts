/**
 * extract-session.ts
 *
 * 从 JSONL 会话转录中提取自然语言内容（用户消息、模型回复、推理摘要），
 * 用于喂给 LLM 做本体提取。
 */

import { isCodexJsonl, runCodexPipeline } from '../../shared/pipeline/codex-jsonl';
import type { TimelineSegment, TurnData } from '../../shared/types/session';
import { sanitizeForLog } from '../utils/log-sanitizer.js';

/** 单个 turn 的结构化内容 */
export interface TurnContent {
  /** turn 编号（从 1 开始） */
  turnNum: number;
  /** 该 turn 的格式化文本：## 第 N 轮\n### 用户输入\n...\n### 模型\n[REPLY] ...\n[REASONING_SUMMARY] ... */
  content: string;
}

interface JsonlBlock {
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
  tool_use_id?: string;
}

interface JsonlMessage {
  role: string;
  content: string | JsonlBlock[];
}

interface JsonlLine {
  type: string;
  message?: JsonlMessage;
}

type SegmentDetail = TimelineSegment['det'];

const MAX_REASONING_SUMMARY_CHARS = 1_600;
const MAX_TOOL_SUMMARY_CHARS = 1_200;
const MAX_LINES_PER_SOURCE = 10;

const KNOWLEDGE_MARKERS = [
  '原因',
  '根因',
  '因为',
  '导致',
  '所以',
  '本质',
  '应该',
  '需要',
  '必须',
  '不要',
  '优先',
  '建议',
  '方案',
  '权衡',
  '修复',
  '验证',
  '测试',
  '检查',
  '失败',
  '错误',
  '问题',
  '结论',
  '发现',
  '风险',
  '约束',
];

function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function compactText(text: string, maxChars: number): string {
  const normalized = normalizeText(text);
  if (normalized.length <= maxChars) return normalized;

  const head = normalized.slice(0, Math.floor(maxChars * 0.72)).trim();
  const tail = normalized.slice(-Math.floor(maxChars * 0.20)).trim();
  return `${head}\n...[中间省略 ${normalized.length - head.length - tail.length} 字]...\n${tail}`;
}

function scoreKnowledgeLine(line: string): number {
  let score = 0;
  for (const marker of KNOWLEDGE_MARKERS) {
    if (line.includes(marker)) score += 3;
  }
  if (/^(结论|原因|根因|问题|修复|方案|风险|验证|发现|建议|注意|坑|教训)[:：]/.test(line.trim())) score += 6;
  if (/[。；;]$/.test(line.trim())) score += 1;
  if (/[{}()[\]<>]/.test(line)) score -= 2;
  if (/\.(tsx?|jsx?|json|md|css)|\/Users\/|localhost|npm |git |const |function |import /.test(line)) score -= 3;
  if (line.length < 18) score -= 2;
  if (line.length > 280) score -= 1;
  return score;
}

function summarizeReasoning(thinking: string): string {
  const normalized = thinking.replace(/\r\n/g, '\n').trim();
  if (!normalized) return '';

  const lines = normalized
    .split(/\n+/)
    .map((line) => line.replace(/^[-*]\s+/, '').trim())
    .filter((line) => line.length >= 8);

  const picked: string[] = [];
  const seen = new Set<string>();
  for (const line of lines
    .map((line, index) => ({ line, index, score: scoreKnowledgeLine(line) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)) {
    const key = line.line.slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(compactText(line.line, 240));
    if (picked.length >= MAX_LINES_PER_SOURCE) break;
  }

  const summary = picked.length > 0
    ? picked.map((line) => `- ${line}`).join('\n')
    : compactText(normalized, MAX_REASONING_SUMMARY_CHARS);

  return compactText(summary, MAX_REASONING_SUMMARY_CHARS);
}

function summarizeReasoningBlocks(blocks: string[]): string {
  if (blocks.length === 0) return '';
  return summarizeReasoning(blocks.join('\n'));
}

function summarizeToolResult(block: JsonlBlock): string {
  let text = '';
  if (typeof block.content === 'string') {
    text = block.content;
  } else if (Array.isArray(block.content)) {
    text = block.content
      .map((item) => {
        if (item && typeof item === 'object' && 'text' in item && typeof item.text === 'string') return item.text;
        return JSON.stringify(item);
      })
      .join('\n');
  } else if (block.content) {
    text = JSON.stringify(block.content);
  }
  if (!text.trim()) return '';

  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) =>
      /error|failed|success|warning|修复|失败|错误|通过|发现|changed|insertions|deletions|Exit code|Process exited/i.test(line),
    )
    .slice(0, MAX_LINES_PER_SOURCE);

  const summary = lines.length > 0 ? lines.map((line) => `- ${line}`).join('\n') : compactText(text, MAX_TOOL_SUMMARY_CHARS);
  return compactText(summary, MAX_TOOL_SUMMARY_CHARS);
}

function summarizeToolSummaries(summaries: string[]): string {
  if (summaries.length === 0) return '';
  const lines = summaries
    .join('\n')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const picked: string[] = [];
  for (const line of lines) {
    const key = line.slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(line);
    if (picked.length >= MAX_LINES_PER_SOURCE) break;
  }
  return compactText(picked.join('\n'), MAX_TOOL_SUMMARY_CHARS);
}

function segmentText(detail: SegmentDetail): string {
  return typeof detail.text === 'string' ? detail.text : '';
}

function segmentThinking(detail: SegmentDetail): string {
  if (typeof detail.think !== 'string' || !detail.think.trim()) return '';
  const tok = typeof detail.thinkTok === 'number' && detail.thinkTok > 0
    ? `\nreasoning_output_tokens: ${detail.thinkTok}`
    : '';
  return `${detail.think}${tok}`;
}

function codexToolSummary(seg: TimelineSegment): string {
  const detail = seg.det;
  const name = typeof detail.name === 'string' && detail.name.trim() ? detail.name : seg.n;
  const chunks: string[] = [`[${name}]`];

  if (typeof detail.input === 'string' && detail.input.trim()) {
    chunks.push(`调用: ${compactText(detail.input, 420)}`);
  }
  if (typeof detail.result === 'string' && detail.result.trim()) {
    chunks.push(`结果: ${compactText(detail.result, 900)}`);
  }
  if (detail.isError === true) chunks.push('状态: error');

  return chunks.join('\n');
}

function codexContentFromTurn(turn: TurnData, turnNum: number): TurnContent {
  const parts: string[] = [
    `## 第 ${turnNum} 轮\n\n### 用户输入\n${normalizeText(turn.prompt)}`,
  ];
  const modelParts: string[] = [];
  const reasoningBlocks: string[] = [];
  const toolSummaries: string[] = [];

  for (const seg of turn.segs) {
    const thinking = segmentThinking(seg.det);
    if (thinking) reasoningBlocks.push(thinking);

    const text = segmentText(seg.det);
    if (text) modelParts.push(`[REPLY] ${normalizeText(text)}`);

    if (seg.k === 't' || seg.k === 's') {
      const summary = codexToolSummary(seg);
      if (summary) toolSummaries.push(summary);
    }
  }

  if (modelParts.length > 0 || reasoningBlocks.length > 0 || toolSummaries.length > 0) {
    parts.push('### 模型');
    parts.push(...modelParts);

    const reasoning = summarizeReasoningBlocks(reasoningBlocks);
    if (reasoning) parts.push(`[REASONING_SUMMARY]\n${reasoning}`);

    const tools = summarizeToolSummaries(toolSummaries);
    if (tools) parts.push(`[TOOL_SUMMARY]\n${tools}`);
  }

  return { turnNum, content: parts.join('\n') };
}

function extractCodexContentWithTurns(rawJsonl: string): TurnContent[] {
  const { turns } = runCodexPipeline(rawJsonl, 'codex-session.jsonl');
  return turns.map((turn, index) => codexContentFromTurn(turn, index + 1));
}

/**
 * 从原始 JSONL 字符串中提取全部自然语言内容，返回格式化文本。
 *
 * 提取规则：
 * - 用户消息：跳过纯 tool_result 的 content；否则开启新 turn，提取 text block
 * - 助手消息：统一归入 ### 模型，text block 标记 [REPLY]
 * - thinking 不直接透传，只保留 [REASONING_SUMMARY] 作为低权重证据
 * - tool_result 不直接透传，只保留 [TOOL_SUMMARY] 作为低权重验证线索
 */
export function extractSessionContent(rawJsonl: string): string {
  const turns = extractContentWithTurns(rawJsonl);
  return turns.map((t) => t.content).join('');
}

/**
 * 从原始 JSONL 字符串中提取全部自然语言内容，返回按 turn 分组的结构化数组。
 *
 * 提取规则同 extractSessionContent。
 * 返回的 TurnContent.content 为每个 turn 的完整格式化文本，
 * 包含 turn 标记、用户消息、推理摘要、工具摘要和助手回复。
 */
export function extractContentWithTurns(rawJsonl: string): TurnContent[] {
  if (isCodexJsonl(rawJsonl)) {
    return extractCodexContentWithTurns(rawJsonl);
  }

  const lines = rawJsonl.trim().split('\n').filter(Boolean);
  let turnNum = 0;
  const turns: TurnContent[] = [];
  let currentTurnParts: string[] = [];
  let currentReasoning: string[] = [];
  let currentToolSummaries: string[] = [];

  function flushTurn(): void {
    if (currentTurnParts.length > 0 && turnNum > 0) {
      if (currentReasoning.length > 0) {
        const summary = summarizeReasoningBlocks(currentReasoning);
        if (summary) currentTurnParts.push(`[REASONING_SUMMARY]\n${summary}`);
      }
      if (currentToolSummaries.length > 0) {
        const summary = summarizeToolSummaries(currentToolSummaries);
        if (summary) currentTurnParts.push(`[TOOL_SUMMARY]\n${summary}`);
      }
      turns.push({ turnNum, content: currentTurnParts.join('\n') });
    }
    currentTurnParts = [];
    currentReasoning = [];
    currentToolSummaries = [];
  }

  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as JsonlLine;
      const { type, message: msg } = obj;

      if (type === 'user' && msg?.role === 'user') {
        let content = '';
        if (typeof msg.content === 'string') {
          content = msg.content;
        } else if (Array.isArray(msg.content)) {
          // 跳过纯工具结果行
          if (msg.content.every((b) => b.type === 'tool_result')) {
            for (const block of msg.content) {
              const summary = summarizeToolResult(block);
              if (summary) currentToolSummaries.push(summary);
            }
            continue;
          }
          const texts: string[] = [];
          for (const block of msg.content) {
            if (block.type === 'text' && block.text) texts.push(block.text);
          }
          content = texts.join('\n');
        }
        // 跳过 task-notification（与管线 identify-turns 对齐）
        if (content.trim().startsWith('<task-notification>')) continue;
        if (content.trim()) {
          flushTurn();
          turnNum++;
          currentTurnParts.push(`## 第 ${turnNum} 轮\n\n### 用户输入\n${normalizeText(content)}`);
        }
      } else if (type === 'assistant' && msg?.content) {
        const rawContent = msg.content;
        const blocks: JsonlBlock[] = Array.isArray(rawContent) ? rawContent : [{ type: 'text', text: rawContent }];
        // 确保有「### 模型」小节头（每轮首次遇到 assistant 消息时）
        if (!currentTurnParts.some((p) => p.startsWith('### 模型'))) {
          currentTurnParts.push('### 模型');
        }
        for (const block of blocks) {
          if (block.type === 'thinking' && block.thinking) {
            currentReasoning.push(block.thinking);
          } else if (block.type === 'text' && block.text) {
            currentTurnParts.push(`[REPLY] ${normalizeText(block.text)}`);
          }
        }
      }
    } catch (parseErr) {
      console.error('JSONL 行解析失败:', sanitizeForLog(parseErr instanceof Error ? parseErr.message : String(parseErr)));
      // 跳过非法 JSON 行
    }
  }

  flushTurn();
  return turns;
}
