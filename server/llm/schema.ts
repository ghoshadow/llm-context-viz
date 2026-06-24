/**
 * schema.ts
 *
 * Zod schema 定义 — 候选实体、关系和分片输出格式。
 * 被 mcp-collector.ts（MCP tool 参数验证）和 build-ontology.ts（类型引用）共用。
 */

import { z } from 'zod';

// ── 证据 ──────────────────────────────────────────────────────────────────

const EVIDENCE_SOURCES = ['user', 'reply', 'reasoning_summary', 'tool_summary'] as const;

function normalizeEvidenceSource(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const raw = value.trim();
  const key = raw
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/^#+\s*/, '')
    .replace(/[\s-]+/g, '_');

  if ((EVIDENCE_SOURCES as readonly string[]).includes(key)) return key;

  if ([
    'human',
    'user_input',
    'user_message',
    '用户',
    '用户输入',
  ].includes(key)) {
    return 'user';
  }

  if ([
    'assistant',
    'assistant_reply',
    'assistant_final_reply',
    'model',
    'model_reply',
    'llm',
    'reply_text',
    '模型',
    '模型回复',
    '回复',
  ].includes(key)) {
    return 'reply';
  }

  if ([
    'reasoning',
    'reasoning_text',
    'think',
    'thinking',
    'assistant_thinking',
    'thinking_summary',
    'reasoning_summary_text',
    '思考',
    '推理',
    '推理摘要',
    '思考摘要',
  ].includes(key)) {
    return 'reasoning_summary';
  }

  if ([
    'tool',
    'tool_result',
    'tool_results',
    'tool_use',
    'tool_output',
    'tool_summary_text',
    '工具',
    '工具结果',
    '工具摘要',
  ].includes(key)) {
    return 'tool_summary';
  }

  // 未知来源按低权重辅助证据处理，避免单个格式别名拖垮整个分片。
  return 'reasoning_summary';
}

export const EvidenceSchema = z.object({
  turn: z.number().int().describe('证据所在轮次（1-based）'),
  source: z.preprocess(
    normalizeEvidenceSource,
    z.enum(EVIDENCE_SOURCES),
  ).describe('证据来源'),
  text: z.string().describe('支持该知识点的一小段原文或蒸馏摘要'),
  weight: z.number().min(0).max(1).describe('证据权重：user 1.0, reply 0.9, tool_summary 0.55, reasoning_summary 0.45'),
});

export type Evidence = z.infer<typeof EvidenceSchema>;

// ── 实体 ──────────────────────────────────────────────────────────────────

export const CandidateSchema = z.object({
  id: z.string().describe('唯一标识，英文小写下划线（如 context_compression）'),
  label: z.string().describe('中文显示名（如 "上下文压缩"）'),
  type: z.enum(['topic', 'how_to', 'why', 'pitfall', 'heuristic', 'technique']).describe('实体类型 key'),
  conf: z.number().min(0).max(1).describe('置信度 0-1：0.90+ 多轮复现；0.75+ 出现有限；0.60+ 推断'),
  firstTurn: z.number().int().describe('首次出现轮次（1-based）'),
  turns: z.array(z.number().int()).describe('所有出现轮次'),
  aliases: z.array(z.string()).optional().describe('同义别名列表'),
  claim: z.string().optional().describe('一句话说明该实体沉淀的可复用知识主张'),
  snippet: z.string().describe('原文摘录，一到两句话'),
  evidence: z.array(EvidenceSchema).default([]).describe('支撑该实体的证据列表'),
  status: z.enum(['confirmed', 'inferred', 'needs_confirmation']).default('inferred').describe('证据状态'),
  note: z.string().optional().describe('消歧说明。同义混淆或假设被修正时必须填写'),
});

export type Candidate = z.infer<typeof CandidateSchema>;

// ── 关系 ──────────────────────────────────────────────────────────────────

export const RelationSchema = z.object({
  s: z.string().describe('源实体 id'),
  t: z.string().describe('目标实体 id'),
  label: z.string().describe('关系描述，简短中文（"根因"、"依赖"、"修复"、"派发"）'),
  firstTurn: z.number().int().describe('关系首次出现轮次'),
  conf: z.number().min(0).max(1).describe('置信度'),
  evidence: z.array(EvidenceSchema).default([]).describe('支撑该关系的证据列表'),
});

export type Relation = z.infer<typeof RelationSchema>;

// ── 配置 ──────────────────────────────────────────────────────────────────

export const ConfigSchema = z.object({
  keepTypes: z.array(z.string()).optional().describe('保留的实体类型'),
  reclassify: z.record(z.string(), z.string()).optional().describe('实体类型重映射，key 为实体 id，value 为新的类型 key'),
  pruneOrphans: z.boolean().optional().describe('是否剪枝孤立节点'),
  maxTurn: z.number().int().optional().describe('最大轮次编号'),
}).optional();

// ── 分片提交（MCP tool 参数）──────────────────────────────────────────────

export const SubmitExtractionSchema = z.object({
  shardIndex: z.number().int().describe('分片序号（0-based）'),
  phaseTheme: z.string().describe('该分片轮次区间的阶段主题，用一句话概括这30轮对话主要在讨论什么'),
  candidates: z.array(CandidateSchema).describe('提取的候选实体列表'),
  relations: z.array(RelationSchema).describe('提取的语义关系列表'),
  config: ConfigSchema.describe('构建配置（可选）'),
});

export type SubmitExtraction = z.infer<typeof SubmitExtractionSchema>;
