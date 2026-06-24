/**
 * orchestrator-prompt.ts
 *
 * Agent SDK 编排器 prompt — 主 Agent 系统提示 + entity-extractor 子 Agent 定义。
 * 子 Agent 直接输出 JSON 文本，主 Agent 收集后合并。
 */

import type { ExtractionManifest } from '../content/extract-to-files.js';

// ── 实体类型定义（子 Agent 共享）─────────────────────────────────────────

const ENTITY_TYPE_DEFS = `## 知识类型定义

从会话中提取可复用的通用知识，分为 6 种类型：

| 类型 | key | 定义 |
|------|-----|------|
| 问题/主题 | topic | 该分片阶段的核心问题或讨论主题——作为聚合根，概括这段时间在解决什么 |
| 为什么 | why | 对现象/结果的深层原因解释——理解了就能举一反三 |
| 怎么做 | how_to | 可操作的方法、步骤、流程——照做就能复现结果 |
| 坑/教训 | pitfall | 做错了什么、踩了什么坑、以后怎么避开 |
| 经验法则 | heuristic | 不是严格步骤，但能指导决策的准则 |
| 工具/技巧 | technique | 特定工具、命令、配置的使用技巧 |

**topic 是聚合根**：每个分片必须提取恰好 1 个 topic 实体（label 与 phaseTheme 一致），其他实体通过关系连接到 topic。`;

const EXTRACTION_RULES = `## 提取规则

### 通用规则

1. **来源限定**：只从用户输入（### 用户输入）和模型内容（### 模型 中的 [THINK]、[REPLY]）中抽取语义。
2. **粒度适中**：每条知识应是一个可独立理解和复用的单元。不要过于宽泛（如"整个项目"）或过于琐碎（如"某行代码"）。
3. **通用性优先**：尽量剥离领域特定细节，提炼出可跨项目复用的知识。如果知识有明确适用场景，在 note 中注明。
4. **消歧标注**：同一知识点多种表述→合并为一个实体，aliases 列出别名。后续轮次推翻之前结论→在 note 中说明演变过程。
5. **关系概念化**：关系体现知识之间的因果、支撑、递进等逻辑联系。禁止纯技术依赖（如文件引用）关系。

### 各类型区分规则

**topic（问题/主题）**：每个分片必须有且仅有一个 topic 实体。它是该阶段讨论的核心问题或目标，作为聚合根连接所有其他实体。label 应与 phaseTheme 一致或更简洁。topic 的 turns 应覆盖整个分片轮次范围。

**how_to（怎么做）**：必须包含可执行步骤或操作序列。特征是"做了 A → 然后 B → 得到 C"。适合：调试流程、审计方法、配置步骤。不适合：笼统方向（那是 heuristic）、单个命令用法（那是 technique）。

**why（为什么）**：必须揭示因果链条或深层机制。特征是"因为 A → 所以 B → 因此 C"。适合：根因分析、现象解释、原理说明。不适合：描述现象本身（那是 pitfall）、操作步骤（那是 how_to）。

**pitfall（坑/教训）**：必须有"错误做法 → 后果 → 正确做法"的完整结构。特征是"以为 X → 做了 Y → 导致 Z → 应该 W"。适合：踩坑记录、认知纠正、反模式。不适合：纯粹的错误报错（没有教训提炼）。

**heuristic（经验法则）**：经过多轮验证或反复出现的判断准则。特征是"遇到 X 类情况时，优先考虑 Y，因为 Z"。适合：决策原则、优先级排序、取舍理由。不适合：具体操作步骤（那是 how_to）、单次事件。

**technique（工具/技巧）**：必须涉及具体工具、命令、配置或 API。特征是"用工具 X 的 Y 功能，参数 Z，达到 W"。适合：命令用法、配置技巧、API 使用。不适合：不涉具体工具的方法论（那是 how_to）。`;

const OUTPUT_FORMAT = `## 输出格式

必须输出纯 JSON 对象（不要用 Markdown 代码块包裹），包含三个字段：

{
  "shardIndex": 0,
  "phaseTheme": "上下文拼装可视化搭建与 token 估算基础校准",
  "candidates": [
    {
      "id": "context_assembly_calibration",
      "label": "上下文拼装与 token 估算校准",
      "type": "topic",
      "conf": 0.95,
      "firstTurn": 1,
      "turns": [1, 5, 12, 15, 28],
      "aliases": [],
      "snippet": "搭建上下文拼装可视化结构，并校准 token 估计算法的基础常量",
      "note": ""
    },
    {
      "id": "proxy_intercept_calibration",
      "label": "通过代理拦截获取真实常量值",
      "type": "how_to",
      "conf": 0.95,
      "firstTurn": 12,
      "turns": [12, 15, 28],
      "aliases": ["proxy capture", "API 拦截"],
      "snippet": "使用透明代理拦截 API 请求，直接从请求体中提取 system prompt 和 tools 的真实 token 数",
      "note": ""
    }
  ],
  "relations": [
    {
      "s": "context_assembly_calibration",
      "t": "proxy_intercept_calibration",
      "label": "包含",
      "firstTurn": 12,
      "conf": 0.95
    }
  ],
  "config": {
    "keepTypes": ["topic", "why", "how_to", "pitfall", "heuristic", "technique"],
    "maxTurn": 30
  }
}`;

// ── 子 Agent prompt ──────────────────────────────────────────────────────

const ENTITY_EXTRACTOR_PROMPT = `你是会话实体提取器。从给定的会话分片内容中提取实体和语义关系。

## 工作流程

1. 使用 Read 工具读取分片文件
2. 仔细阅读会话内容，识别实体和关系
3. 直接输出提取结果的 JSON 对象

${ENTITY_TYPE_DEFS}

## 实体字段

- **id**: 唯一标识，英文小写下划线（如 context_compression）
- **label**: 中文显示名（如 "上下文压缩"）
- **type**: 类型 key（topic/how_to/why/pitfall/heuristic/technique）
- **conf**: 置信度 0-1。0.90+ 多轮复现；0.75+ 有限出现；0.60+ 推断
- **firstTurn**: 首次出现轮次（1-based）
- **turns**: 所有出现轮次的数组
- **aliases**: 同义别名列表（可选）
- **snippet**: 原文摘录，一到两句话
- **note**: 消歧说明（可选）

## 关系字段

- **s**: 源实体 id
- **t**: 目标实体 id
- **label**: 关系描述，简短中文
- **firstTurn**: 关系首次出现轮次
- **conf**: 置信度

${EXTRACTION_RULES}

${OUTPUT_FORMAT}

## phaseTheme 字段

- 用一句话（15 字以内）概括该分片轮次区间的对话主题
- 例如："上下文拼装结构搭建"、"token 估算校准"、"子 Agent 匹配逻辑修复"
- 关注这段时间内用户在解决什么核心问题，而非罗列讨论过的所有话题

**重要**：你的最终回复必须只是 JSON 对象，不添加任何解释或包装文字。shardIndex 必须与分配给你的分片序号一致。

## 跨分片命名一致性

如果你提取的实体可能在前面分片中也出现过，请尽量使用一致的 id 命名。
若不确定是否同一实体，在 note 中标注"可能与分片 X 中的实体 Y 重复，待合并"。
id 命名规范：优先使用英文技术术语的小写下划线形式（如 pipeline_audit），中文概念使用拼音（如 shangxiawen_yasuo）。`;

// ── 主 Agent 编排 prompt ─────────────────────────────────────────────────

import type { ShardFile } from '../content/extract-to-files.js';

export function buildOrchestratorPrompt(manifest: ExtractionManifest, activeShards?: ShardFile[]): string {
  const shards = activeShards ?? manifest.shards;
  const shardList = shards
    .map((s) => `- 分片 ${s.index}: ${s.filename} (轮次 ${s.turnRange}, ${s.turnCount} 轮)`)
    .join('\n');

  const taskDescriptions = shards
    .map(
      (s) =>
        `   - 分片 ${s.index}: 描述 "提取分片 ${s.index} 的实体和关系，文件路径 ${s.path}，shardIndex=${s.index}，轮次范围 ${s.turnRange}"`,
    )
    .join('\n');

  return `你是本体提取编排器。协调 entity-extractor 子 Agent 并行处理所有分片。

## 当前会话

- 会话 ID: ${manifest.sessionId}
- 总轮次: ${manifest.totalTurns}
- 分片数: ${shards.length}

## 分片列表

${shardList}

## 执行步骤

1. 使用 Task 工具，**一次性启动以下所有分片的 entity-extractor 子 Agent**（并行执行）：
${taskDescriptions}

2. 每个子 Agent 会读取分片文件并输出 JSON 提取结果。

3. 等待所有子 Agent 完成后，将所有子 Agent 返回的 JSON 结果汇总为一个 JSON 数组：
\`\`\`json
[
  { "shardIndex": 0, "candidates": [...], "relations": [...], "config": {...} },
  { "shardIndex": 1, "candidates": [...], "relations": [...], "config": {...} }
]
\`\`\`

4. 最后输出这个汇总的 JSON 数组。不要遗漏任何分片。

**重要**：一次性启动所有子 Agent，不要逐个启动。`;
}

// ── 子 Agent 定义 ────────────────────────────────────────────────────────

import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';

export const entityExtractorDef: AgentDefinition = {
  description: '处理一个分片的会话转录内容，提取实体和关系，返回 JSON 格式的提取结果',
  tools: ['Read'],
  prompt: ENTITY_EXTRACTOR_PROMPT,
};
