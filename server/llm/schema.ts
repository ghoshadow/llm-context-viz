/**
 * schema.ts
 *
 * Zod schema 定义 — 候选实体、关系和分片输出格式。
 * 被 mcp-collector.ts（MCP tool 参数验证）和 build-ontology.ts（类型引用）共用。
 */

import { z } from 'zod';

// ── 实体 ──────────────────────────────────────────────────────────────────

export const CandidateSchema = z.object({
  id: z.string().describe('唯一标识，英文小写下划线（如 context_compression）'),
  label: z.string().describe('中文显示名（如 "上下文压缩"）'),
  type: z.enum(['topic', 'how_to', 'why', 'pitfall', 'heuristic', 'technique']).describe('实体类型 key'),
  conf: z.number().min(0).max(1).describe('置信度 0-1：0.90+ 多轮复现；0.75+ 出现有限；0.60+ 推断'),
  firstTurn: z.number().int().describe('首次出现轮次（1-based）'),
  turns: z.array(z.number().int()).describe('所有出现轮次'),
  aliases: z.array(z.string()).optional().describe('同义别名列表'),
  snippet: z.string().describe('原文摘录，一到两句话'),
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
