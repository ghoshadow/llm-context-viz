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

## 反模式

- 不使用 `require()` — 仅使用 ESM 导入。
- 不在已知形状的函数参数上使用 `any`。
- 不静默吞掉错误 — 至少 `console.error`。
- 不使用基于类的服务层 — 本项目使用模块级函数。
- 不在异步路由处理器中使用 `fs` 同步方法（`readFileSync`） — 使用 `fs/promises`。例外: 同步辅助函数中允许 `existsSync`。

## 桌面打包规范

### 路径解析双回退

打包后 `__dirname` 会偏移（esbuild 单文件 + Tauri `_up_/` 资源目录）。所有读取外部文件的代码必须用双路径回退：

```typescript
// ✅ 正确
const DEV_PATH = resolve(join(__dirname, '..', '..', 'scripts', 'tool.cjs'));
const BUNDLE_PATH = resolve(join(__dirname, 'scripts', 'tool.cjs'));
const script = existsSync(DEV_PATH) ? DEV_PATH : BUNDLE_PATH;
```

```typescript
// ❌ 错误 — 打包后 ../.. 指到错误位置
const script = join(__dirname, '..', '..', 'scripts', 'tool.cjs');
```

### 数据库路径

`DB_PATH` 不能硬编码为 `../data/`。生产环境通过 `LLM_CONTEXT_VIZ_DATA_DIR` 环境变量指定系统标准数据目录：

```typescript
const DATA_DIR = process.env.LLM_CONTEXT_VIZ_DATA_DIR 
  || path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'llm-context.db');
```

Rust 侧通过 `app.path().app_data_dir()` 传入：
```rust
let data_dir = app.path().app_data_dir().unwrap();
cmd.env("LLM_CONTEXT_VIZ_DATA_DIR", data_dir.to_string_lossy());
```

### esbuild 打包

`packages: 'external'` — 所有 node_modules 保持外部，只打包应用代码。`better-sqlite3` 和 `dotenv` 等含原生模块/CJS 的包必须 external。

### Express 5 通配符路由

Express 5 不再支持 `*`。使用 `{*splat}`：

```typescript
// ❌ Express 5 报错: Missing parameter name at index 1: *
app.get('*', handler);

// ✅ 正确
app.get('/{*splat}', handler);
```
