# llm-context-viz 架构审查报告

> 审查时间：2026-07-01 | 审查人：架构审查专家
> 审查范围：全项目四层架构（前端 + API + 数据 + LLM）

---

## 总体评分：6.0/10

| 维度 | 得分 | 权重 | 评语 |
|------|------|------|------|
| 跨层数据流 | 4/10 | 高 | 类型分裂严重，server 直接 import src/ |
| 代码复用 | 5/10 | 高 | SessionSource 5 处定义、CWD 提取 2 份重复 |
| 项目结构 | 7/10 | 中 | 四层分离清晰，pipeline 位置尴尬 |
| 打包部署 | 6/10 | 中 | 仅保留 Web 构建与本地后端运行，发布流程仍需补充 |
| 依赖管理 | 8/10 | 中 | 精简无冗余，tsx 位置合理 |
| 安全性 | 5/10 | 高 | strict=false、CORS 全开放、无 rate limiting |

---

## 一、严重问题（P0 — 必须修复）

### 1. `SessionSource` 类型分裂 — 5 处独立定义

**违反规范：** cross-layer-thinking-guide.md「每个消费者都解析相同负载」反模式
**来源对照：** code-reuse-thinking-guide.md「重复的负载字段提取」

| 位置 | 名称 | 值 | 状态 |
|------|------|-----|------|
| `shared/types/calibration.ts:7` | `AgentSource` | `'claude' \| 'codex' \| 'opencode' \| 'openclaw'` | ✅ 完整 |
| `src/utils/sessionSource.ts:1` | `SessionSource` | 相同值 | ⚠️ 重复定义 |
| `server/routes/scanner.ts:20` | `SessionSource` | `'claude' \| 'codex'` **只有 2 个值** | 🔴 不完整 |
| `src/pipeline/calibration-types.ts:10` | 重导出 | 从 shared 透传 | ⚠️ 间接引用 |
| `src/components/pages/calibrationCategories.ts:1` | `AgentSource` | 再次独立定义 | ⚠️ 重复 |

**风险：** scanner.ts 的本地定义缺少 `'opencode'` 和 `'openclaw'`。如果在 scanner 逻辑中使用 `SessionSource` 做分支判断，openclaw 会话将被错误归类。参考 code-reuse-thinking-guide：
> "向 Literal 类型添加新值时，已有的 if/elif/else 链会静默落入 else 分支使用错误的默认值"

**修复：** 在 `shared/types/index.ts` 统一导出，删除所有本地定义。

---

### 2. `quickCwd` 与 `extractCwdFromJsonl` 逻辑完全重复

**违反规范：** code-reuse-thinking-guide.md「复制粘贴函数」反模式

```
server/routes/scanner.ts:95   → quickCwd(raw)
server/services/pipeline-service.ts:78 → extractCwdFromJsonl(jsonlContent?)
```

两函数都是：逐行 split → JSON.parse → 检查 cwd 字段 → 50 行限制 → 支持 Claude 和 Codex 两种格式。唯一区别是 `extractCwdFromJsonl` 额外处理了 `undefined` 输入，但调用方已保证非空。

**风险：** 修改 CWD 提取逻辑需要改两处，容易遗漏。

**修复：** scanner.ts 直接导入 `extractCwdFromJsonl`。

---

### 3. `server/` → `src/pipeline/` 跨层直接导入

**违反规范：** cross-layer-thinking-guide.md「每一层只知道其相邻层」

当前 server 通过 `../../src/pipeline/` 路径直接导入前端层的管道代码，共 15 处：

```
server/services/pipeline-service.ts → runPipeline, setMemoryChars, loadCalibratedConstants
server/routes/sessions.ts           → getSessionSource
server/services/calibration-job.ts  → extractConstants, extractCodexConstants
server/monitor/watcher.ts           → runPipeline
...等
```

`tsconfig.server.json` 通过 include `["server", "src", "shared"]` 三个目录来承载这种导入，使得前端管道代码必须适配 server 的模块解析。

**修复方向（推荐方案一）：**
1. **简单（推荐）：** 把 `src/pipeline/` 移到 `shared/pipeline/`，将 `src/types/session.ts` 和 `src/types/ontology.ts` 也移入 `shared/`
2. 中等：通过 npm workspace `/packages/pipeline` 独立引用
3. 长期：抽成独立 npm 包

---

## 二、警告问题（P1 — 建议修复）

### 4. `tsconfig.server.json` strict=false — 失去类型安全

```json
// tsconfig.json (前端) → strict: true, noUncheckedIndexedAccess: true
// tsconfig.server.json → strict: false  ← 无任何类型检查
```

**风险示例：** `row.categories_json` 可能是 `undefined`，但 `JSON.parse(categories_json)` 不会报编译错误，运行时直接崩溃。

**修复：** 渐进启用 — 先开 `strictNullChecks`，逐步消化类型错误后再开其他选项。

### 5. API 响应格式不统一

三种不同结构：

| 场景 | 格式 | 示例 |
|------|------|------|
| 单对象 | `{ ...fields }` 无包裹 | `GET /api/sessions/:id` |
| 分页 | `{ items, total, limit, offset, hasMore }` | `GET /:id/turns` |
| 操作 | `{ ok: true, turnCount }` | `POST /:id/refresh` |
| 翻译 | `{ translated: "..." }` | `POST /:id/translate` |

前端 `get<T>()` 泛型依赖人工保证类型正确，无编译器验证。

**修复：** 统一为 `{ ok: boolean; data?: T; error?: string }` 或定义 Zod response schema。

### 6. CORS 全开放

```typescript
// server/index.ts:52
res.header('Access-Control-Allow-Origin', '*');
```

本地工具场景可接受，但缺少安全假设注释。

### 7. 端口号分散硬编码

| 位置 | 硬编码 | 是否引用共享常量 |
|------|--------|-----------------|
| `shared/constants.ts` | `DEFAULT_SERVER_PORT = 4137` | 定义处 |
| `vite.config.ts` | `'4137'` | ❌ 未引用 |

---

## 三、跨层数据流详细分析

### 数据流向图

```
React 组件 → Zustand Store → API Client (src/api/client.ts)
                                    ↓ HTTP (JSON)
                            Express Router (server/routes/)
                                    ↓
                            Repository (server/repositories/)
                                    ↓
                            SQLite (better-sqlite3)
                                    ↑ 读取
                            Pipeline (src/pipeline/ ← shared/)
```

### 类型不同义

| 类型 | server (repository) | 前端 (src/types) | 不一致 |
|------|---------------------|-------------------|--------|
| `SessionListItem.cwd` | `string \| null` | `string \| null` | - |
| `SessionDetail.cwd` | `string \| null` | `string`（必填） | ⚠️ |

### shared/ 现状

```
shared/
├── constants.ts           ← 8 个常量 + resolveContextLimit()
└── types/
    ├── calibration.ts     ← 5 个类型 + CALIBRATION_DEFAULTS
    └── index.ts           ← 仅重导出
```

**shared/ 缺少：**
- `SessionSource` 统一类型（当前 5 份分散）
- API 请求/响应 Zod schema
- `extractCwdFromJsonl` 工具
- `errorMessage(err: unknown): string` 通用工具

---

## 四、代码重复清单

| 重复内容 | 出现次数 | 严重度 |
|---------|---------|--------|
| `SessionSource` / `AgentSource` 类型 | 5 | 🔴 严重 |
| CWD 提取逻辑 | 2 | 🔴 严重 |
| `err instanceof Error ? err.message : String(err)` | ~15 | 🟡 中等 |
| `JSON.parse() \|\| []/{}` 反序列化 | ~5 | 🟡 中等 |
| `'claude' \| 'codex' \| 'opencode' \| 'openclaw'` 字面量 | 6 | 🟡 中等 |
| `computeMemoryChars` / `computeMemoryCharsSync` | 2 个版本 | 🟢 轻微 |
| `runPipelineOnContent` / `runPipelineOnContentSync` | 2 个版本 | 🟢 轻微 |

---

## 五、项目结构

### 优点
- 四层分离清晰
- server/ 内部模块划分合理（routes/services/repositories/middleware/llm/utils）
- 测试文件 co-located
- 浏览器前端与 Express 后端边界清晰

### 待改进
- `src/pipeline/` 位置尴尬：不在前端也不在 server
- 无 `shared/utils/` 目录
- `server/routes/scanner.ts` 过重（405 行），包含扫描+元数据+导入
- `.claude/worktrees/` 下 19 个旧隔离工作区

---

## 六、打包和部署

### Web 构建与本地运行

```
npm run dev      → Vite dev server
npm run server   → Express API server
npm run build    → TypeScript check + Vite production build
```

**✅ 良好：** 开发路径简单，前端通过 `/api` 代理访问后端
**⚠️ 风险：** 尚未定义正式发布/部署流程，生产静态资源托管方式需要补充文档

---

## 七、安全性检查

| 检查项 | 状态 | 说明 |
|-------|------|------|
| `.env` gitignored | ✅ | 已忽略且未追踪 |
| `.env.example` 模板 | ✅ | 占位符正确 |
| CORS 限制 | ⚠️ | 允许所有来源 |
| 日志脱敏 | ✅ | `log-sanitizer.ts` 完善 |
| 环境变量隔离 | ✅ | `filterEnv()` 白名单保护 |
| SQL 注入 | ✅ | 全部 prepared statements |
| strict 模式 | ❌ | server 端关闭 |
| Rate limiting | ❌ | 无 |
| 进程错误处理 | ✅ | uncaughtException 兜底 |

---

## 八、改进优先级

| 优先级 | 项目 | 预计工时 |
|--------|------|---------|
| P0 | 统一 SessionSource 类型到 shared/ | 1h |
| P0 | 合并 quickCwd → extractCwdFromJsonl | 0.5h |
| P0 | 迁移 pipeline/ 到 shared/pipeline/ | 2h |
| P1 | 启用 tsconfig.server.json strict | 2h |
| P1 | 统一 API 响应格式 | 3h |
| P2 | 提取 errorMessage() 工具函数 | 0.5h |
| P2 | 清理 worktrees/ 旧目录 | 0.1h |
| **合计** | | **~10h** |
