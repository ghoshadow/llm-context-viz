# 质量规范

> 前端开发的代码质量标准。

---

## 测试

### 测试框架

`node:test` + `node:assert/strict` — 与后端相同。无 Jest、无 Vitest。

### 测试位置

测试文件与源文件同目录，使用 `.test.ts` 扩展名：

```
src/components/pages/
  calibrationAutoStart.test.ts
  calibrationCategories.test.ts
  calibrationDetailModal.test.ts
src/components/shared/
  contentRenderStrategy.test.ts
  MarkdownBlock.test.ts
src/utils/
  sse.test.ts
```

### 测试模式

前端测试聚焦于**从组件中提取的纯逻辑**，而非 DOM 渲染：

```typescript
// src/components/shared/contentRenderStrategy.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { decideRenderStrategy } from './contentRenderStrategy';

test('detects markdown content', () => {
  const result = decideRenderStrategy({ type: 'text', text: '# Heading' });
  assert.equal(result.kind, 'markdown');
});
```

没有 Playwright/ReactTestingLibrary 测试。组件逻辑通过提取纯函数进行测试。

## TypeScript 模式

### 类型导入

使用 `import type` 进行仅类型导入：

```typescript
import type { SessionDetail, TurnDetail } from '../../types/session';
```

### JSON 类型收窄

当解析来自 API 的未知 JSON 数据时：

```typescript
function parseJSON<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}
```

参考: `src/components/pages/TurnInspector.tsx`

## API 客户端

所有 HTTP 调用通过 `src/api/client.ts` 进行：

```typescript
import { get, post, put, del } from '../../api/client';

const data = await get<T>('/sessions');
const result = await post<T>('/sessions/import', { path });
await del('/sessions/123');
```

特性: AbortController 超时（默认 30s）、从 JSON 响应中提取错误信息、上传时支持 FormData。

### API 地址

前端统一使用 `/api` 相对路径。开发模式由 Vite proxy 转发到 Express，生产构建使用同源请求：

```typescript
// vite.config.ts
define: {
  __API_BASE__: JSON.stringify('/api'),
}

// src/api/client.ts
declare const __API_BASE__: string;
const BASE = typeof __API_BASE__ !== 'undefined' ? __API_BASE__ : '/api';
```

所有 HTTP 调用通过 `src/api/client.ts`，不要在组件或 store 中直接调用 `fetch()`。

## 代码组织

### 逻辑提取

将纯逻辑从组件中提取到单独文件中：

```
src/components/pages/
  CalibratePage.tsx               # UI + 状态
  calibrationAutoStart.ts         # 自动启动逻辑（无 JSX）
  calibrationCategories.ts        # 分类分组（无 JSX）
  calibrationDetailModal.ts       # 详情弹窗逻辑（无 JSX）
  calibrationSource.ts            # 来源类型逻辑（无 JSX）
```

这使组件专注于渲染，并允许对提取的逻辑进行单元测试。

### Pipeline 目录

`shared/pipeline/` 包含纯数据处理 — 无 React、无 JSX、无 DOM。`src/pipeline/` 只保留兼容 re-export：

```
shared/pipeline/
  parse-jsonl.ts          # JSONL 解析
  aggregate-session.ts    # 会话摘要计算
  compute-context.ts      # 上下文窗口分析
  calibration-types.ts    # 校准类型定义
  codex-jsonl.ts          # Codex 专用 JSONL 解析
```

```typescript
// src/pipeline/index.ts
export * from '../../shared/pipeline/index';
```

## 反模式

- 不要将业务逻辑放在 JSX 渲染函数中 — 提取为纯函数。
- 不要在 `shared/types/` 中存在类型定义时使用 `any`。
- 不要直接调用 `fetch()` — 使用 `src/api/client.ts`（`get`、`post`、`put`、`del`）。
- 不要在 `src/pipeline/` 中新增 pipeline 实现 — 新实现放在 `shared/pipeline/`，`src/pipeline/` 只做 re-export。
- 不要创建新的测试框架 — 使用 `node:test` + `node:assert/strict`。
- 不要使用 DOM 渲染测试 React 组件 — 提取并测试纯逻辑。
