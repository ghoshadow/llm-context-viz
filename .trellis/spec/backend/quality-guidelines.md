# 质量规范

> 后端开发的代码质量标准。

---

## TypeScript 使用

### 仅 ESM

`package.json` 中 `"type": "module"`。相对导入使用 `.js` 扩展名：

```typescript
import { sanitizeForLog } from '../utils/log-sanitizer.js';
import { getDb } from '../db';
```

### 数据库结果的类型断言

better-sqlite3 返回 `unknown` — 使用 `as` 转换：

```typescript
const row = db.prepare('SELECT ...').get(id) as Record<string, unknown> | undefined;
const rows = db.prepare('SELECT ...').all() as Array<Record<string, unknown>>;
```

对于解构的 JSON 列：

```typescript
const { categories_json, ...rest } = row as Record<string, unknown> & {
  categories_json?: string;
};
```

### 错误类型收窄

始终在访问 `.message` 前收窄 `unknown` 类型：

```typescript
catch (err) {
  const message = err instanceof Error ? err.message : String(err);
}
```

## 代码组织

### 路由文件结构

1. 导入
2. `const router = Router();`
3. 按 HTTP 方法分组的路由处理器，使用分隔横幅
4. `export default router;`

分隔横幅使用以下格式：
```typescript
// ============================================================================
// GET /:id
// ============================================================================
```

### 共享逻辑提取

当相同查询模式出现 3 次以上时，提取为模块级辅助函数：

```typescript
// server/routes/ontology.ts 第 61-86 行
function getOntologyData(sessionId: string): OntologyDataLike | null { ... }
async function getSessionRawJsonl(sessionId: string): Promise<string | null> { ... }
function saveOntology(sessionId: string, data: unknown, maxTurn: number): void { ... }
```

### 跨层共享契约

`server/` 不直接导入 `src/`。前后端共同使用的纯逻辑和类型位于 `shared/`：

```typescript
import { runPipeline } from '../../shared/pipeline/index';
import type { TurnData } from '../../shared/types/session';
import { getSessionSource } from '../../shared/session-source';
```

`src/pipeline/*` 和 `src/types/*` 是前端兼容 re-export 层，不是 server 依赖目标。

## 命名规范

| 范围 | 约定 | 示例 |
|-------|-----------|---------|
| 路由文件 | 资源名，kebab-case | `sessions.ts`、`scanner.ts` |
| 辅助函数 | camelCase，动词开头 | `findJsonlFile()`、`parseTurnListPagination()` |
| 数据库列 | snake_case | `session_id`、`turn_index` |
| SQL 表 | snake_case，复数 | `sessions`、`turns`、`ontology_shards` |
| 迁移函数 | camelCase，描述性命名 | `migrateTurnTranslationsV7()` |

## 请求/响应模式

### 分页

Turn 列表使用 offset/limit，配合 `parseTurnListPagination()` 辅助函数：

```typescript
// server/routes/pagination.ts
const page = parseTurnListPagination(req.query);
// 返回: { all: boolean, limit: number | null, offset: number }
```

默认: 200 个 turn。最大: 500。`?all=1` 跳过分页。

### SSE 流

长时间运行的操作使用 Server-Sent Events：

```typescript
// server/routes/ontology.ts POST /extract
res.writeHead(200, {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no',
});
// 事件: start、extracted、shard-start、shard-done、shard-error、complete、error
res.write(`id: ${eventId}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
```

长时间可能无业务事件的 SSE 必须发送注释 heartbeat，避免 Vite 代理、浏览器或中间层把空闲 chunked 响应断开：

```typescript
const stopHeartbeat = startSseHeartbeat(res);
try {
  // await long-running work
} finally {
  stopHeartbeat();
  if (!res.destroyed && !res.writableEnded) res.end();
}
```

测试点：使用 fake timers 断言 heartbeat 会写入 `: keepalive\n\n`，并且调用 cleanup 后不再写入。不要用业务 `event:` 作为 heartbeat，否则前端事件处理器会误以为有进度事件。

### Agent SDK tool-result 文件恢复

#### 1. Scope / Trigger

当 Claude Agent SDK 把大段子 Agent 输出落到 `.claude/projects/.../tool-results/call_*.json` 时，后端可以作为恢复路径读取该文件。触发场景是本体分片提取：子 Agent 已生成合法 JSON，但父 Agent 没有把完整 JSON 内联转述给 `collectShardTextResults()`。

#### 2. Signatures

```typescript
export function isAgentToolResultPath(filePath: string): boolean;
export async function readShardItemsFromAgentToolResultPath(filePath: string): Promise<unknown[]>;
```

#### 3. Contracts

- 只接受 basename 匹配 `call_*.json` 的文件。
- 父目录 basename 必须是 `tool-results`。
- 文件扩展名必须是 `.json`。
- 使用 `lstat()`，符号链接必须拒绝。
- 文件大小必须低于恢复函数定义的上限。
- 恢复出的对象仍必须经过业务 schema 校验，不能绕过 `SubmitExtractionSchema`。

#### 4. Validation & Error Matrix

| 条件 | 行为 |
|------|------|
| 非 `tool-results/call_*.json` | 返回空数组 |
| 符号链接 | 返回空数组 |
| 文件超过大小上限 | 返回空数组 |
| 文件不存在或读取失败 | 调用方捕获并记录脱敏错误 |
| JSON 包装为 `{ type: "text", text: "```json ...```" }` | 递归解包后交给 schema 校验 |

#### 5. Good/Base/Bad Cases

- Good: `.../tool-results/call_00_abc.json` 内含 text-wrapped shard JSON，恢复后触发原有 `shard-done`。
- Base: 普通内联 JSON 继续走 `tool_result` 文本解析。
- Bad: `/tmp/tool-results/secret.json`、`call_00_abc.txt`、symlink 到其他文件，都不读取。

#### 6. Tests Required

- 解析器测试：text-wrapped JSON 能被递归提取，普通内联 JSON 行为保持。
- 文件恢复测试：只接受安全路径，拒绝 symlink。
- collector 测试：模拟 `assistant.tool_use Read(file_path)` + `user.tool_result(tool_use_id)`，断言恢复后有 `shard-done`。

#### 7. Wrong vs Correct

Wrong:

```typescript
// 扩大权限，让父 Agent 用 Bash cat 文件。
allowedTools: ['Read', 'Task', 'Bash']
```

Correct:

```typescript
// 权限不变；后端只读取窄范围 tool-result JSON，并继续走 schema 校验。
allowedTools: ['Read', 'Task']
```

## 反模式

- 不使用 `require()` — 仅使用 ESM 导入。
- 不从 `server/` 导入 `../../src/*` — 使用 `shared/*`。
- 不在已知形状的函数参数上使用 `any`。
- 不静默吞掉错误 — 至少 `console.error`。
- 不使用基于类的服务层 — 本项目使用模块级函数。
- 不在异步路由处理器中使用 `fs` 同步方法（`readFileSync`） — 使用 `fs/promises`。例外: 同步辅助函数中允许 `existsSync`。

## 运行时路径

### 数据库路径

`DB_PATH` 不要在调用点重复拼接。统一通过 `server/db.ts` 的 `DB_DIR` 计算，默认使用项目本地 `data/`，需要时可用 `LLM_CONTEXT_VIZ_DATA_DIR` 覆盖：

```typescript
const DATA_DIR = process.env.LLM_CONTEXT_VIZ_DATA_DIR 
  || path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'llm-context.db');
```

### Express 5 通配符路由

Express 5 不再支持 `*`。使用 `{*splat}`：

```typescript
// ❌ Express 5 报错: Missing parameter name at index 1: *
app.get('*', handler);

// ✅ 正确
app.get('/{*splat}', handler);
```
