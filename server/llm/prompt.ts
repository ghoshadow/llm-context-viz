/** 实体元信息中的类型 */
export interface Meta {
  sessionId: string;
  partN: number;
  totalParts: number;
  turnRange: string;
  turnCount: number;
}

// ── 共享的完整提示模板（仅定义一次） ──────────────────────────────────────

const HEADER = `# 会话上下文本体提取任务

## 任务

阅读以下 LLM 会话转录内容，从中提取**实体**和**关系**，构建会话的知识图谱。输出格式为严格的 JSON。

## 知识类型定义

| 类型 | key | 说明 |
|------|-----|------|
| 问题/主题 | \`topic\` | 当前阶段的核心问题或目标，作为聚合根 |
| 为什么 | \`why\` | 对现象或结果的原因解释 |
| 怎么做 | \`how_to\` | 可操作的方法、步骤、流程 |
| 坑/教训 | \`pitfall\` | 错误做法、后果和规避方式 |
| 经验法则 | \`heuristic\` | 可复用的判断准则或取舍原则 |
| 工具/技巧 | \`technique\` | 具体工具、命令、配置或 API 的使用技巧 |

## 实体字段

每个实体包含：

| 字段 | 类型 | 说明 |
|------|------|------|
| \`id\` | string | 唯一标识，英文小写下划线（如 \`context_compression\`） |
| \`label\` | string | 中文显示名（如 "上下文压缩"） |
| \`type\` | string | 类型 key |
| \`conf\` | number | 置信度 0-1：0.90+ 多轮复现/表述明确；0.75+ 出现有限；0.60+ 推断/被修正 |
| \`firstTurn\` | number | 首次出现轮次（1-based） |
| \`turns\` | number[] | 所有出现轮次 |
| \`aliases\` | string[] | 同义别名列表 |
| \`snippet\` | string | 原文摘录，一到两句话 |
| \`note\` | string? | 消歧说明。同义混淆或假设被修正时必须填写 |

## 关系字段

| 字段 | 类型 | 说明 |
|------|------|------|
| \`s\` | string | 源实体 id |
| \`t\` | string | 目标实体 id |
| \`label\` | string | 关系描述，简短中文（"根因"、"依赖"、"修复"、"派发"） |
| \`direction\` | string | directed / undirected / bidirectional。因果、依赖、修复、推导用 directed；相关、并列、对照、同类用 undirected；互相影响、互为补充用 bidirectional |
| \`firstTurn\` | number | 关系首次出现轮次 |
| \`conf\` | number | 置信度 |

## 输出格式

严格输出一个 JSON 对象（不要用 Markdown 代码块包裹），包含三个字段：

\`\`\`json
{
  "candidates": [
    {
      "id": "context_assembly",
      "label": "上下文拼装",
      "type": "topic",
      "conf": 0.95,
      "firstTurn": 1,
      "turns": [1, 12, 28, 87],
      "aliases": ["Context Assembly"],
      "snippet": "展示一次会话中最重请求的 Token 组成"
    }
  ],
  "relations": [
    {
      "s": "context_assembly",
      "t": "token_estimation_calibration",
      "label": "包含",
      "direction": "directed",
      "firstTurn": 12,
      "conf": 0.95
    }
  ],
  "config": {
    "keepTypes": ["topic", "why", "how_to", "pitfall", "heuristic", "technique"],
    "pruneOrphans": false,
    "maxTurn": 510
  }
}
\`\`\`

## 重要规则

1. **来源限定**：只从用户输入（\`### 用户输入\`）和模型内容中抽取语义。优先使用 \`[REPLY]\`；\`[REASONING_SUMMARY]\` 和 \`[TOOL_SUMMARY]\` 只能作为低权重补充证据，不能单独支撑高置信实体。

2. **知识化表达**：不要把函数名、文件路径、命令本身当作实体；如果它们承载了可复用做法，提炼成 \`technique\` 或 \`how_to\`。

3. **类型边界清晰**：步骤流程归为 \`how_to\`，因果解释归为 \`why\`，踩坑复盘归为 \`pitfall\`，判断准则归为 \`heuristic\`，工具细节归为 \`technique\`。

4. **消歧标注**：同一概念多种称谓→合并为一个实体，\`aliases\` 列出所有别名。对话中假设被推翻→在 \`note\` 中说明消歧过程。

5. **关系概念化**：关系体现知识之间的包含、因果、支撑、递进、修正、并列、对照等逻辑联系。边应连接知识实体，而不是技术工件。有明确因果/依赖/修复方向时用 directed；只是相关/并列/对照时用 undirected；互相影响或互为补充时用 bidirectional。

6. **证据驱动**：每个实体和关系应有 evidence。只有 \`user\` 或 \`reply\` 明确支持时才能高置信；只有 \`reasoning_summary\` 支撑时，置信度不得高于 0.55。

7. **证据 source 枚举严格限定**：evidence[].source 只能填写 \`user\`、\`reply\`、\`reasoning_summary\`、\`tool_summary\` 四个值。不要输出 \`assistant\`、\`model\`、\`human\`、\`thinking\`、\`tool\`、\`tool_result\`、\`user_message\`、\`assistant_final_reply\` 等别名；看到 \`[REPLY]\` 一律写 \`reply\`，看到 \`[REASONING_SUMMARY]\` 一律写 \`reasoning_summary\`，看到 \`[TOOL_SUMMARY]\` 一律写 \`tool_summary\`。

8. **config.maxTurn** 设为会话实际最大轮次编号。\`config.keepTypes\` 使用当前 6 种知识类型。

---

## 现在处理以下会话内容
`;

const FOOTER = `---

请基于以上会话内容，按格式要求输出完整的 JSON（直接输出 JSON 对象，不带 Markdown 代码块标记）。`;

// ── 导出的构建函数 ────────────────────────────────────────────────────────

/**
 * 构建完整提示（用于第一个分片，包含全部实体类型定义和提取规则）。
 */
export function buildFullPrompt(content: string, meta: Meta): string {
  const shardCtx =
    meta.totalParts > 1
      ? `\n> **分片上下文**：这是第 ${meta.partN}/${meta.totalParts} 分片，仅包含第 ${meta.turnRange} 轮。\n`
      : '';

  return [
    HEADER,
    shardCtx,
    `### 会话信息`,
    '',
    `- 会话 ID: ${meta.sessionId}`,
    `- 用户轮次: ${meta.turnCount}`,
    `- 当前分片: ${meta.partN}/${meta.totalParts}`,
    '',
    '### 会话转录',
    '',
    '```',
    content,
    '```',
    FOOTER,
  ].join('\n');
}

/**
 * 构建紧凑提示（用于后续分片，省略已定义的类型和规则）。
 */
export function buildCompactPrompt(content: string, meta: Meta): string {
  return [
    `# 继续上下文本体提取（第 ${meta.partN}/${meta.totalParts} 分片）`,
    '',
    `请沿用之前定义的实体类型和提取规则。当前为第 ${meta.partN}/${meta.totalParts} 分片，仅包含第 ${meta.turnRange} 轮。`,
    '',
    `### 会话信息`,
    '',
    `- 会话 ID: ${meta.sessionId}`,
    `- 用户轮次: ${meta.turnCount}`,
    `- 当前分片: ${meta.partN}/${meta.totalParts}`,
    '',
    '### 会话转录',
    '',
    '```',
    content,
    '```',
    '',
    '---',
    '',
    '请基于以上会话内容，按之前约定的格式输出完整的 JSON（直接输出 JSON 对象，不带 Markdown 代码块标记）。',
  ].join('\n');
}
