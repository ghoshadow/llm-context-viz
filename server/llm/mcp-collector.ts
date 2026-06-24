/**
 * mcp-collector.ts
 *
 * In-process MCP Server — Agent SDK 子 Agent 通过调用 submit_extraction 工具
 * 将结构化提取结果提交到服务端内存。Agent SDK 自动用 Zod schema 验证参数。
 *
 * 使用方式：
 *   import { collectorServer, clearCollected, getCollected } from './mcp-collector';
 *   clearCollected();
 *   // 在 query() 的 mcpServers 中注入 collectorServer
 *   // 子 Agent 调用 mcp__collector__submit_extraction
 *   const results = getCollected();
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { CandidateSchema, RelationSchema, ConfigSchema } from './schema';

// 显式类型标注以兼容 Zod v4 的 createSdkMcpServer 泛型约束
const SubmitArgs = z.object({
  shardIndex: z.number().int(),
  phaseTheme: z.string(),
  candidates: CandidateSchema,
  relations: RelationSchema,
  config: ConfigSchema,
});

// ── 内存存储 ──────────────────────────────────────────────────────────────

interface ShardEntry {
  shardIndex: number;
  phaseTheme: string;
  candidates: Array<z.infer<typeof CandidateSchema>>;
  relations: Array<z.infer<typeof RelationSchema>>;
  config?: z.infer<typeof ConfigSchema>;
}

const collected: ShardEntry[] = [];

// ── MCP Server ────────────────────────────────────────────────────────────

export const collectorServer = createSdkMcpServer({
  name: 'collector',
  version: '1.0.0',
  tools: [
    tool(
      'submit_extraction',
      '提交一个分片的实体和关系提取结果。每个分片处理完成后必须调用此工具提交结果。',
      SubmitArgs.shape,
      async (args) => {
        collected.push({
          shardIndex: args.shardIndex,
          phaseTheme: args.phaseTheme,
          candidates: args.candidates as Array<z.infer<typeof CandidateSchema>>,
          relations: args.relations as Array<z.infer<typeof RelationSchema>>,
          config: args.config as z.infer<typeof ConfigSchema> | undefined,
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: `✓ 分片 ${args.shardIndex} 已提交: ${(args.candidates as unknown[]).length} 实体, ${(args.relations as unknown[]).length} 关系`,
            },
          ],
        };
      },
    ),
  ],
});

// ── 收集器操作 ────────────────────────────────────────────────────────────

export function clearCollected(): void {
  collected.length = 0;
}

export function getCollected(): ShardEntry[] {
  return [...collected];
}
