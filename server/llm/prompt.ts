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

## 实体类型定义

候选实体分为 7 种类型。**最终图谱中只保留前 3 种**（机制·概念 / Agent / 系统），后 4 种由管线自动过滤：

### 保留类型（自然语义实体）

| 类型 | key | 说明 |
|------|-----|------|
| 机制·概念 | \`mechanism\` | 对话中讨论的架构概念、算法、设计模式、问题现象、解决方案 |
| Agent | \`agent\` | 对话中的 AI 参与者（主 Agent、子 Agent、编排器） |
| 系统 | \`system\` | 工具、框架、服务器、数据库、文件格式等外部系统 |

### 过滤类型（技术工件，管线自动丢弃，但标注有益于理解对话）

| 类型 | key | 说明 |
|------|-----|------|
| 错误·现象 | \`error\` | 报错信息、异常表现。若该错误是对话讨论的**核心主题**，在 config.reclassify 中提升为 mechanism |
| 函数·API | \`func\` | 代码中的函数名、方法名 |
| 代码·文件 | \`code\` | 源代码文件路径 |
| 命令 | \`command\` | 终端命令 |

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
      "type": "mechanism",
      "conf": 0.95,
      "firstTurn": 1,
      "turns": [1, 12, 28, 87],
      "aliases": ["Context Assembly"],
      "snippet": "展示一次会话中最重请求的 Token 组成"
    }
  ],
  "relations": [
    {
      "s": "claude_code",
      "t": "llm_context_viz",
      "label": "构建",
      "firstTurn": 12,
      "conf": 0.95
    }
  ],
  "config": {
    "keepTypes": ["mechanism", "agent", "system"],
    "reclassify": {
      "cumulative_jump": "mechanism"
    },
    "pruneOrphans": true,
    "maxTurn": 510
  }
}
\`\`\`

## 重要规则

1. **来源限定**：只从用户消息（\`=== TURN N (USER) ===\`）、模型文本回复（\`[REPLY]\`）、模型思考过程（\`[THINK]\`）中抽取语义。不从工具结果的结构化数据中提取。

2. **技术工件大胆标注**：函数名、文件名、命令等标注为 \`func\`/\`code\`/\`command\`，**无需担心过多**——管线自动过滤。

3. **错误→概念提升**：如果某个 "错误现象" 是对话讨论的核心主题（而非偶发报错），类型标为 \`error\`，然后在 \`config.reclassify\` 中映射为 \`"mechanism"\`。

4. **消歧标注**：同一概念多种称谓→合并为一个实体，\`aliases\` 列出所有别名。对话中假设被推翻→在 \`note\` 中说明消歧过程。

5. **关系概念化**：边两端必须是保留类型（或将被 reclassify 的类型）。禁止 \`func→func\` 或 \`code→code\` 的边——应重写为概念间关系。

6. **config.maxTurn** 设为会话实际最大轮次编号。\`config.reclassify\` 列出所有 \`error→mechanism\` 提升的实体 id。

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
