/**
 * orchestrator-prompt.ts
 *
 * Agent SDK 编排器 prompt — 主 Agent 系统提示 + entity-extractor 子 Agent 定义。
 * 子 Agent 直接输出 JSON 文本，主 Agent 收集后合并。
 */

import type { ExtractionManifest } from '../content/extract-to-files.js';

export type ExtractionDepth = 'refined' | 'deep';

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

1. **来源限定**：只从用户输入（### 用户输入）和模型内容中抽取语义。优先使用 [REPLY]；[REASONING_SUMMARY] 和 [TOOL_SUMMARY] 只能作为低权重补充证据，不能单独支撑高置信实体。
2. **粒度适中**：每条知识应是一个可独立理解和复用的单元。不要过于宽泛（如"整个项目"）或过于琐碎（如"某行代码"）。
3. **通用性优先**：尽量剥离领域特定细节，提炼出可跨项目复用的知识。如果知识有明确适用场景，在 note 中注明。
4. **消歧标注**：同一知识点多种表述→合并为一个实体，aliases 列出别名。后续轮次推翻之前结论→在 note 中说明演变过程。
5. **关系概念化**：关系体现知识之间的因果、支撑、递进等逻辑联系。禁止纯技术依赖（如文件引用）关系。
6. **证据驱动**：每个实体和关系必须填写 evidence。优先引用用户输入和 [REPLY]。如果只有 [REASONING_SUMMARY] 支撑，status 必须是 needs_confirmation，conf 不得高于 0.55。
7. **过滤执行噪音**：不要把临时执行计划、文件路径、函数名、命令、报错文本本身当实体；只有它们被提炼成可复用知识时才保留。
8. **证据 source 枚举严格限定**：evidence[].source 只能填写 user、reply、reasoning_summary、tool_summary 四个值。不要输出 assistant、model、human、thinking、tool、tool_result、user_message、assistant_final_reply 等别名；看到 [REPLY] 一律写 reply，看到 [REASONING_SUMMARY] 一律写 reasoning_summary，看到 [TOOL_SUMMARY] 一律写 tool_summary。

### 各类型区分规则

**topic（问题/主题）**：每个分片必须有且仅有一个 topic 实体。它是该阶段讨论的核心问题或目标，作为聚合根连接所有其他实体。label 应与 phaseTheme 一致或更简洁。topic 的 turns 应覆盖整个分片轮次范围。

**how_to（怎么做）**：必须包含可执行步骤或操作序列。特征是"做了 A → 然后 B → 得到 C"。适合：调试流程、审计方法、配置步骤。不适合：笼统方向（那是 heuristic）、单个命令用法（那是 technique）。

**why（为什么）**：必须揭示因果链条或深层机制。特征是"因为 A → 所以 B → 因此 C"。适合：根因分析、现象解释、原理说明。不适合：描述现象本身（那是 pitfall）、操作步骤（那是 how_to）。

**pitfall（坑/教训）**：必须有"错误做法 → 后果 → 正确做法"的完整结构。特征是"以为 X → 做了 Y → 导致 Z → 应该 W"。适合：踩坑记录、认知纠正、反模式。不适合：纯粹的错误报错（没有教训提炼）。

**heuristic（经验法则）**：经过多轮验证或反复出现的判断准则。特征是"遇到 X 类情况时，优先考虑 Y，因为 Z"。适合：决策原则、优先级排序、取舍理由。不适合：具体操作步骤（那是 how_to）、单次事件。

**technique（工具/技巧）**：必须涉及具体工具、命令、配置或 API。特征是"用工具 X 的 Y 功能，参数 Z，达到 W"。适合：命令用法、配置技巧、API 使用。不适合：不涉具体工具的方法论（那是 how_to）。`;

const DEPTH_RULES: Record<ExtractionDepth, string> = {
  refined: `## 抽取密度：精炼模式

- 目标是高信号复盘卡片，而不是穷尽索引。
- 每个分片建议输出 8-16 个实体、10-25 条关系。
- 优先保留明确、可复用、可迁移的知识点；相近表述合并为一个实体。
- 允许舍弃一次性执行细节、过窄代码点、重复确认和低价值中间过程。`,

  deep: `## 抽取密度：深挖模式

- 目标是充分沉淀知识内容，不只保留最高层摘要。
- 每个分片目标输出 24-40 个实体、35-80 条关系；如果分片内容非常稀疏，可以低于目标，但不能因为概括而主动压缩到十几个。
- 类型覆盖建议：topic 恰好 1 个；why 3-6 个；how_to 5-9 个；pitfall 3-7 个；heuristic 3-7 个；technique 4-10 个。
- 保留中等重要但可复用的知识点，例如调试判断、验证方法、失败原因、交互取舍、命令/API 使用方式、前后假设修正。
- 将复合知识拆成多个实体：原因、做法、坑、经验法则、工具技巧应分别建模，再用关系连接。
- 关系要足够密集：除 topic 连接到各知识点外，还应补充因果、修正、依赖、验证、规避、包含、前置条件、适用场景等语义边。
- 不要把每条日志或每个文件路径当实体；但当它们承载可复用技巧或教训时，应抽象成 technique/pitfall/how_to。`,
};

function depthLabel(depth: ExtractionDepth): string {
  return depth === 'deep' ? '深挖模式' : '精炼模式';
}

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
      "claim": "上下文拼装可视化需要同时呈现组成结构和 token 估算校准逻辑",
      "snippet": "搭建上下文拼装可视化结构，并校准 token 估计算法的基础常量",
      "evidence": [
        { "turn": 1, "source": "user", "text": "用户要求搭建上下文拼装可视化结构", "weight": 1.0 },
        { "turn": 12, "source": "reply", "text": "模型回复确认已加入 token 估算校准", "weight": 0.9 }
      ],
      "status": "confirmed",
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
      "claim": "通过代理拦截可以获得真实请求体，从而校准 system prompt 和 tools 的 token 常量",
      "snippet": "使用透明代理拦截 API 请求，直接从请求体中提取 system prompt 和 tools 的真实 token 数",
      "evidence": [
        { "turn": 12, "source": "reply", "text": "使用透明代理拦截 API 请求，直接从请求体中提取真实 token 数", "weight": 0.9 }
      ],
      "status": "confirmed",
      "note": ""
    }
  ],
  "relations": [
    {
      "s": "context_assembly_calibration",
      "t": "proxy_intercept_calibration",
      "label": "包含",
      "firstTurn": 12,
      "conf": 0.95,
      "evidence": [
        { "turn": 12, "source": "reply", "text": "上下文拼装校准包含代理拦截获取真实常量", "weight": 0.9 }
      ]
    }
  ],
  "config": {
    "keepTypes": ["topic", "why", "how_to", "pitfall", "heuristic", "technique"],
    "maxTurn": 30
  }
}`;

// ── 子 Agent prompt ──────────────────────────────────────────────────────

function buildEntityExtractorPrompt(depth: ExtractionDepth): string {
  return `你是会话实体提取器。从给定的会话分片内容中提取实体和语义关系。

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
- **claim**: 一句话说明这个实体沉淀的可复用知识主张
- **snippet**: 原文摘录，一到两句话
- **evidence**: 支撑该实体的证据数组。source 只能是 user/reply/reasoning_summary/tool_summary，禁止使用任何别名
- **status**: confirmed/inferred/needs_confirmation。只有用户或 reply 明确支持时才能 confirmed
- **note**: 消歧说明（可选）

## 关系字段

- **s**: 源实体 id
- **t**: 目标实体 id
- **label**: 关系描述，简短中文
- **firstTurn**: 关系首次出现轮次
- **conf**: 置信度
- **evidence**: 支撑该关系的证据数组

${EXTRACTION_RULES}

${DEPTH_RULES[depth]}

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
}

// ── 主 Agent 编排 prompt ─────────────────────────────────────────────────

import type { ShardFile } from '../content/extract-to-files.js';

export function buildOrchestratorPrompt(manifest: ExtractionManifest, activeShards?: ShardFile[], depth: ExtractionDepth = 'refined'): string {
  const shards = activeShards ?? manifest.shards;
  const shardList = shards
    .map((s) => `- 分片 ${s.index}: ${s.filename} (轮次 ${s.turnRange}, ${s.turnCount} 轮)`)
    .join('\n');

  const taskDescriptions = shards
    .map(
      (s) =>
        `   - 分片 ${s.index}: 描述 "以${depthLabel(depth)}提取分片 ${s.index} 的实体和关系，文件路径 ${s.path}，shardIndex=${s.index}，轮次范围 ${s.turnRange}"`,
    )
    .join('\n');

  return `你是本体提取编排器。协调 entity-extractor 子 Agent 并行处理所有分片。

## 当前会话

- 会话 ID: ${manifest.sessionId}
- 总轮次: ${manifest.totalTurns}
- 分片数: ${shards.length}
- 抽取密度: ${depthLabel(depth)}

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

export function buildEntityExtractorDef(depth: ExtractionDepth): AgentDefinition {
  return {
    description: `处理一个分片的会话转录内容，以${depthLabel(depth)}提取实体和关系，返回 JSON 格式的提取结果`,
    tools: ['Read'],
    prompt: buildEntityExtractorPrompt(depth),
  };
}

export const entityExtractorDef: AgentDefinition = buildEntityExtractorDef('refined');
