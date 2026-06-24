#!/bin/bash
# ============================================================================
# extract-ontology.sh — 从 JSONL 会话转录中自动提取上下文本体
#
# 用法：
#   1. 生成 Prompt：
#        ./scripts/extract-ontology.sh <session-id>
#
#   2. 将输出的 .md 文件喂给 LLM（Claude / GPT / 本地模型），拿到 JSON 输出
#
#   3. 构建本体（POST 到构建管线）：
#        curl -X POST localhost:4137/api/sessions/<id>/ontology/build \
#          -H 'Content-Type: application/json' -d @llm-output.json
#
#   4. 或在页面「本体建模」→「通过构建管线生成」中粘贴 LLM 输出
#
# 数据来源：extract-session-content.ts 自动处理（raw_jsonl → 磁盘文件 → API）
# ============================================================================
set -euo pipefail

SESSION_ID="${1:-}"
API_BASE="${API_BASE:-http://localhost:4137}"

if [ -z "$SESSION_ID" ]; then
  echo "用法: $0 <session-id>"
  echo "示例: $0 35dc6727845f418e"
  exit 1
fi

OUT_DIR="${OUT_DIR:-.}"
PROMPT_FILE="$OUT_DIR/ontology-prompt-${SESSION_ID}.md"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# ── Step 1: 提取会话内容（完整，不截断，写到临时文件）─────────────────

echo ">>> 提取会话内容 (session: $SESSION_ID)..."

TEMP_CONTENT=$(mktemp /tmp/ontology-content-XXXXXX.txt)

# 支持 session-id 或直接文件路径
if [ -f "$SESSION_ID" ] && [[ "$SESSION_ID" == *.jsonl ]]; then
  npx --prefix "$PROJECT_DIR" tsx "$PROJECT_DIR/scripts/extract-session-content.ts" "$SESSION_ID" > "$TEMP_CONTENT" 2>/tmp/extract-err.log || {
    cat /tmp/extract-err.log
    rm -f "$TEMP_CONTENT"
    exit 1
  }
else
  npx --prefix "$PROJECT_DIR" tsx "$PROJECT_DIR/scripts/extract-session-content.ts" "$SESSION_ID" > "$TEMP_CONTENT" 2>/tmp/extract-err.log || {
    cat /tmp/extract-err.log
    rm -f "$TEMP_CONTENT"
    exit 1
  }
fi

TURN_COUNT=$(grep -c "^=== TURN" "$TEMP_CONTENT" || echo "0")
THINK_COUNT=$(grep -c "^\[THINK\]" "$TEMP_CONTENT" || echo "0")
REPLY_COUNT=$(grep -c "^\[REPLY\]" "$TEMP_CONTENT" || echo "0")
CONTENT_SIZE=$(wc -c < "$TEMP_CONTENT" | tr -d ' ')

echo "   提取了 $TURN_COUNT 个用户轮次, $THINK_COUNT 段思考, $REPLY_COUNT 段回复, 共 $CONTENT_SIZE 字符"

# ── Step 2: 生成 Markdown Prompt ─────────────────────────────────────────

cat > "$PROMPT_FILE" << 'PROMPT_HEADER'
# 会话上下文本体提取任务

## 任务

阅读以下 LLM 会话转录内容，从中提取**实体**和**关系**，构建会话的知识图谱。输出格式为严格的 JSON。

## 知识类型定义

| 类型 | key | 说明 |
|------|-----|------|
| 问题/主题 | `topic` | 当前阶段的核心问题或目标，作为聚合根 |
| 怎么做 | `how_to` | 可操作的方法、步骤、流程 |
| 为什么 | `why` | 对现象或结果的原因解释 |
| 坑/教训 | `pitfall` | 错误做法、后果和规避方式 |
| 经验法则 | `heuristic` | 可复用的判断准则或取舍原则 |
| 工具/技巧 | `technique` | 具体工具、命令、配置或 API 的使用技巧 |

## 实体字段

每个实体包含：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 唯一标识，英文小写下划线（如 `context_compression`） |
| `label` | string | 中文显示名（如 "上下文压缩"） |
| `type` | string | 类型 key |
| `conf` | number | 置信度 0-1：0.90+ 多轮复现/表述明确；0.75+ 出现有限；0.60+ 推断/被修正 |
| `firstTurn` | number | 首次出现轮次（1-based） |
| `turns` | number[] | 所有出现轮次 |
| `aliases` | string[] | 同义别名列表 |
| `snippet` | string | 原文摘录，一到两句话 |
| `note` | string? | 消歧说明。同义混淆或假设被修正时必须填写 |

## 关系字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `s` | string | 源实体 id |
| `t` | string | 目标实体 id |
| `label` | string | 关系描述，简短中文（"根因"、"依赖"、"修复"、"派发"） |
| `firstTurn` | number | 关系首次出现轮次 |
| `conf` | number | 置信度 |

## 输出格式

严格输出一个 JSON 对象（不要用 Markdown 代码块包裹），包含三个字段：

```json
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
      "firstTurn": 12,
      "conf": 0.95
    }
  ],
  "config": {
    "keepTypes": ["topic", "how_to", "why", "pitfall", "heuristic", "technique"],
    "pruneOrphans": false,
    "maxTurn": 510
  }
}
```

## 重要规则

1. **来源限定**：只从用户消息（`=== TURN N (USER) ===`）、模型文本回复（`[REPLY]`）、模型思考过程（`[THINK]`）中抽取语义。不从工具结果的结构化数据中提取。

2. **知识化表达**：不要把函数名、文件路径、命令本身当作实体；如果它们承载了可复用做法，提炼成 `technique` 或 `how_to`。

3. **类型边界清晰**：步骤流程归为 `how_to`，因果解释归为 `why`，踩坑复盘归为 `pitfall`，判断准则归为 `heuristic`，工具细节归为 `technique`。

4. **消歧标注**：同一概念多种称谓→合并为一个实体，`aliases` 列出所有别名。对话中假设被推翻→在 `note` 中说明消歧过程。

5. **关系概念化**：关系体现知识之间的包含、因果、支撑、递进、修正等逻辑联系。边应连接知识实体，而不是技术工件。

6. **config.maxTurn** 设为会话实际最大轮次编号。`config.keepTypes` 使用当前 6 种知识类型。

---

## 现在处理以下会话内容

PROMPT_HEADER

# ── Step 3: 拼入会话内容 ─────────────────────────────────────────────────

{
  echo ""
  echo "### 会话信息"
  echo ""
  echo "- 会话 ID: $SESSION_ID"
  echo "- 用户轮次: $TURN_COUNT"
  echo "- 内容长度: $CONTENT_SIZE 字符"
  echo ""
  echo "### 会话转录"
  echo ""
  echo '```'
  cat "$TEMP_CONTENT"
  echo '```'
  echo ""
  echo "---"
  echo ""
  echo "请基于以上会话内容，按格式要求输出完整的 JSON（直接输出 JSON 对象，不带 Markdown 代码块标记）。"
} >> "$PROMPT_FILE"

rm -f "$TEMP_CONTENT"

# ── 完成 ──────────────────────────────────────────────────────────────────

PROMPT_SIZE=$(wc -c < "$PROMPT_FILE" | tr -d ' ')
echo ""
echo "---"
echo "✓ Prompt 已生成: $PROMPT_FILE ($PROMPT_SIZE bytes)"
echo ""
echo "完整链路："
echo "  $PROMPT_FILE   →   喂给 LLM   →   拿到 JSON   →   POST /api/sessions/$SESSION_ID/ontology/build"
echo "  或直接在页面粘贴: http://localhost:5173 → 本体建模 → 构建管线"
