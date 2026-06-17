# 技术债务修复方案

> 基于 ARCHITECTURE_REPORT.md 中列出的 7 项已知债务

---

## 1. 重复 fmtK — 统一工具函数

**位置:** `src/components/charts/ToolDrilldown.tsx:223` (私有) + `src/utils/format.ts:25` (公共)

**方案:** 删除 ToolDrilldown.tsx 中的私有 `fmtK`（第 223-225 行），改为从 `../../utils/format` 导入。

ToolDrilldown.tsx 的私有版本在 `>= 100000` 时用 `Math.round(n/1000)+'K'`，公共版本用 `(n/1000).toFixed(1)+'K'`（带小数点）。公共版本更精确，统一使用。

**影响面:** ToolDrilldown.tsx 内部 3 处调用。无其他组件依赖私有版本。

**改动文件:** `src/components/charts/ToolDrilldown.tsx`（删 3 行 + 改 import 1 行）

---

## 2. 重复 fmtDate — 统一时间格式化

**位置:** `src/components/turn/ExecutionTimeline.tsx:165` (fmtTime) + `src/utils/format.ts:69` (fmtDate)

**方案:** 删除 ExecutionTimeline.tsx 中的 `fmtTime` 函数，改为从 `../../utils/format` 导入 `fmtDate`。

两个函数实现完全相同——ISO 转 `MM-DD HH:MM` 格式。公共版本使用手动 zero-padding（本地化无关），更鲁棒。

**影响面:** ExecutionTimeline.tsx 内部 1 处调用（第 583 行 `fmtTime(selectedSeg.ts)`）。

**改动文件:** `src/components/turn/ExecutionTimeline.tsx`（删 ~5 行 + 改 import 1 行 + 改调用名 1 处）

---

## 3. 样式重复 — 移除 CSS 文件中与 inline style 重复的类

**背景:** `global.css` 定义了 `.panel`, `.stat-card`, `.legend-row`, `.step-item` 等大量类，但组件中也用 `SEMANTIC` tokens 写了相同的 inline style，造成双维护。

**方案:** 分两步走——

**Phase A (本迭代):** 审计 `global.css`，删除**未被任何组件引用的** CSS 类。保留仍在使用的类（如 `.thin-scrollbar`, `.tl`, `.step-dot`, `@keyframes spin`）。移除纯重复类（`.panel`, `.stat-card`, `.legend-row` 等组件已完全用 inline style 替代的）。

**Phase B (后续):** 对仍使用 CSS 类的组件（如 TurnInspector 的 `.step-item`, `.content-block`, `.block-header`），逐步迁移到 inline style + theme tokens，最终移除所有组件级 CSS 类，`global.css` 只保留 reset、scrollbar、animations。

**影响面:** 仅影响视觉（删重复代码，不改变渲染结果）。Phase A 预计删除 ~150 行 CSS。

**改动文件:** `src/styles/global.css`

**验证:** Playwright 截图对比修复前后的峰值透视页和逐轮检查页，确保无差异。

---

## 4. hardcoded WINDOW=200K — 动态上下文窗口

**现状:** `WINDOW = 200000` 硬编码在 `src/styles/theme.ts:51`，多个组件直接引用。不同模型的窗口差异很大（Claude Sonnet=200K，DeepSeek v4=1M）。

**方案:**
1. `WINDOW` 常量保留为默认值 200K（向后兼容）
2. 在 `aggregate-session.ts` 中，尝试从 JSONL 的 `system` / `assistant` 事件中提取模型名，映射到已知窗口大小：
   ```typescript
   const MODEL_WINDOWS: Record<string, number> = {
     'claude-sonnet-4': 200000,
     'claude-opus-4': 200000,
     'deepseek-v4-pro': 1000000,  // 1M
     'deepseek-v4-flash': 1000000,
   };
   ```
3. 提取逻辑：匹配模型名前缀（`deepseek-v4` → 1M，`claude-` → 200K），未知模型用默认 200K
4. 将提取的 `contextLimit` 写入 `session.context_limit`（已有字段，目前硬编码 200K）
5. 前端各组件从 `session.context_limit` 读取，不再硬编码

**影响面:** aggregate-session.ts（加映射逻辑），session 数据（context_limit 可能变成其他值），前端各组件无需改动（已从 session 读取）。

**改动文件:** `src/pipeline/aggregate-session.ts`（+~15 行），`src/styles/theme.ts`（改注释说明是可覆盖默认值）

---

## 5. upload 路由缺 sub-agent enrichment

**现状:** `server/routes/sessions.ts` 的 POST /upload 没有调用 `enrichWithSubAgents`，因为上传没有源文件路径。

**方案:**
1. 上传时，将文件内容写入临时目录（`/tmp/llm-viz-upload-{uuid}.jsonl`）
2. 管线跑完后，用临时路径调用 `enrichWithSubAgents(turns, tmpDir)`
3. 成功后删除临时文件
4. 或者：不写入磁盘，直接在内存中解析 `content` 中的 `<task-notification>` 等事件来定位子代理信息（但这需要修改 pipeline）

**推荐方案 1（临时文件）**——改动最小，实现明确。

```typescript
// 在 runPipeline 之后
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
const tmpDir = mkdtempSync(join(tmpdir(), 'llm-viz-upload-'));
const tmpFile = join(tmpDir, sessionId + '.jsonl');
writeFileSync(tmpFile, content);
enrichWithSubAgents(turns, tmpDir);
rmSync(tmpDir, { recursive: true, force: true });
```

**影响面:** `server/routes/sessions.ts`（+8 行），依赖 `os.tmpdir()` + Node.js 内置 fs 模块。

**改动文件:** `server/routes/sessions.ts`

---

## 6. cumTools 冗余 — 统一数据格式

**现状:** 累计浮窗中有两个数据源 fallback：
```typescript
const ct = (currentTurn as any).cum_tools_json
  ? JSON.parse((currentTurn as any).cum_tools_json)
  : (currentTurn as any).cumTools ?? sessionStore.currentSession?.tools ?? [];
```

**方案:** 统一使用 `cum_tools_json`（DB 持久化的 JSON 字符串）。删除 `cumTools` fallback。

因为管线已将 cumTools 写入 `cum_tools_json` 列，API 返回的 `TurnDetail` 已包含解析后的字段。可以直接用 `currentTurn.cum_tools_json`。

但 `TurnSummary`（列表接口）不返回 `cum_tools_json`，只有 `TurnDetail`（详情接口）返回。累计浮窗用的是详情数据，所以直接用 `JSON.parse(currentTurn.cum_tools_json ?? '{}')` 即可。

**影响面:** `src/components/pages/TurnInspector.tsx`（改 ~3 行），删除多余的类型转换。

**改动文件:** `src/components/pages/TurnInspector.tsx`

---

## 7. PeakDataProps session 类型不安全

**现状:** `ContextAssembly.tsx` 中 `interface PeakDataProps { session: Record<string, any> }` 缺少类型约束。

**方案:** 定义一个内联接口 `PeakSessionData`，包含 ContextAssembly 实际读取的所有字段：

```typescript
interface PeakSessionData {
  model: string;
  version: string;
  cwd: string;
  total_requests: number;
  peak_index: number;
  peak_tokens: number;
  context_limit: number;
  peak_cache_hit?: number;
  peak_turn_idx?: number;
  peak_step?: number;
  total_output?: number;
  requests?: number;       // camelCase alias
  peakTokens?: number;     // camelCase alias
  peakIndex?: number;      // camelCase alias
  contextLimit?: number;   // camelCase alias
}
```

然后在 derived computation 开头做一次规范化，将 camelCase 映射到 snake_case，保证后续代码统一读取 snake_case 字段。

**改动文件:** `src/components/pages/ContextAssembly.tsx`（+~20 行接口定义 + 3 行规范化）

---

## 实施优先级

| 优先级 | 编号 | 说明 | 改动量 | 风险 |
|--------|------|------|--------|------|
| P0 | 1, 2 | 去重工具函数 | 2 文件，删 ~10 行 | 无 |
| P0 | 6 | cumTools 统一 | 1 文件，改 ~3 行 | 无 |
| P0 | 7 | 类型安全 | 1 文件，+~23 行 | 低 |
| P1 | 5 | upload enrichment | 1 文件，+~10 行 | 低 |
| P1 | 4 | 动态窗口 | 2 文件，+~20 行 | 中（需验证不同模型） |
| P2 | 3 | 样式去重 | 1 文件，改 ~150 行 | 中（需视觉回归测试） |
