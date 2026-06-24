/**
 * extract-session.ts
 *
 * 从 JSONL 会话转录中提取自然语言内容（用户消息、模型回复、思考过程），
 * 无截断，用于喂给 LLM 做本体提取。
 *
 * 本模块从 scripts/extract-session-content.ts 提取核心逻辑。
 */

/** 单个 turn 的结构化内容 */
export interface TurnContent {
  /** turn 编号（从 1 开始） */
  turnNum: number;
  /** 该 turn 的格式化文本：## 第 N 轮\n### 用户输入\n...\n### 模型\n[THINK] ...\n[REPLY] ... */
  content: string;
}

interface JsonlBlock {
  type: string;
  text?: string;
  thinking?: string;
}

interface JsonlMessage {
  role: string;
  content: string | JsonlBlock[];
}

interface JsonlLine {
  type: string;
  message?: JsonlMessage;
}

/**
 * 从原始 JSONL 字符串中提取全部自然语言内容，返回格式化文本。
 *
 * 提取规则：
 * - 用户消息：跳过纯 tool_result 的 content；否则开启新 turn，提取 text block
 * - 助手消息：统一归入 ### 模型，thinking block 标记 [THINK]，text block 标记 [REPLY]
 * - 无截断，全部提取
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
 * 包含 turn 标记、用户消息、思考过程和助手回复。
 */
export function extractContentWithTurns(rawJsonl: string): TurnContent[] {
  const lines = rawJsonl.trim().split('\n').filter(Boolean);
  let turnNum = 0;
  const turns: TurnContent[] = [];
  let currentTurnParts: string[] = [];

  function flushTurn(): void {
    if (currentTurnParts.length > 0 && turnNum > 0) {
      turns.push({ turnNum, content: currentTurnParts.join('\n') });
    }
    currentTurnParts = [];
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
          if (msg.content.every((b) => b.type === 'tool_result')) continue;
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
          currentTurnParts.push(`## 第 ${turnNum} 轮\n\n### 用户输入\n${content}`);
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
            currentTurnParts.push(`[THINK] ${block.thinking}`);
          } else if (block.type === 'text' && block.text) {
            currentTurnParts.push(`[REPLY] ${block.text}`);
          }
        }
      }
    } catch {
      // 跳过非法 JSON 行
    }
  }

  flushTurn();
  return turns;
}
