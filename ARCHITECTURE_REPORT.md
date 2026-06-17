# LLM Context Visualizer — 系统架构审查报告

> 生成日期: 2026-06-16
> 项目路径: `/Users/link/Documents/Anaconda/llm-context-viz`
> 总文件数: 50+ (不含 node_modules)

---

## 1. 系统架构总览

```
┌─────────────────────────────────────────────────────────┐
│                    Browser (React SPA)                   │
│  ┌──────────┐ ┌───────────┐ ┌────────────┐              │
│  │ HomePage │ │ ContextAsm│ │TurnInspector│              │
│  └────┬─────┘ └─────┬─────┘ └──────┬─────┘              │
│       │              │              │                    │
│  ┌────┴──────────────┴──────────────┴────┐               │
│  │        Zustand Stores                 │               │
│  │  sessionStore ──── uiStore            │               │
│  └───────────────────┬───────────────────┘               │
│                      │ fetch()                          │
├──────────────────────┼──────────────────────────────────┤
│                      ▼                                   │
│              Express Server (:4137)                      │
│  ┌──────────────┐  ┌──────────────────┐                 │
│  │ /api/sessions│  │ /api/scanner     │                 │
│  │  CRUD + Upload│  │  Scan + Import  │                 │
│  └──────┬───────┘  └────────┬─────────┘                 │
│         │                   │                            │
│  ┌──────┴───────────────────┴──────┐                    │
│  │        SQLite (better-sqlite3)  │                    │
│  │  sessions / turns / scanned_files│                   │
│  └─────────────────────────────────┘                    │
│         │                                               │
│  ┌──────┴──────────────────────────┐                    │
│  │     Data Pipeline (shared)       │                    │
│  │  parse → turns → context →      │                    │
│  │  deltas → timeline → aggregate   │                    │
│  └─────────────────────────────────┘                    │
└─────────────────────────────────────────────────────────┘
```

### 进程模型

| 进程 | 端口 | 职责 |
|------|------|------|
| Express (tsx) | 4137 | API 服务 + 静态文件 (生产) |
| Vite dev server | 5173 | 前端 HMR 开发 + API 代理 |

---

## 2. 模块依赖图

### 2.1 管线层 (Pipeline)

```
parse-jsonl.ts ─────────────────────────────────────────────┐
    │ (SessionLine[])                                        │
    ▼                                                       │
identify-turns.ts ──────────────────────────────────────────┤
    │ (TurnGroup[])                                          │
    ├──────────────┬──────────────────────┐                  │
    ▼              ▼                      ▼                  │
compute-context  compute-timeline    calibrateEstimator     │
    │ (composition) │ (segments)         (TokenEstimator)    │
    ▼              │                      │                  │
compute-deltas    │                      │                  │
    │ (delta)      │                      │                  │
    └──────┬───────┘                      │                  │
           ▼                              ▼                  │
      aggregate-session ◄─────────────────┘                  │
           │ (SessionSummary + TurnData[])                   │
           ▼                                                │
      index.ts (runPipeline 编排器)                          │
```

### 2.2 服务端层 (Server)

```
server/index.ts
    ├── db.ts (SQLite singleton + schema)
    ├── routes/sessions.ts
    │     ├── POST /upload (multer → runPipeline → INSERT)
    │     ├── GET / (list)
    │     ├── GET /:id (detail + JSON parse)
    │     ├── GET /:id/turns (summary)
    │     ├── GET /:id/turns/:idx (detail + JSON parse)
    │     └── DELETE /:id (CASCADE)
    └── routes/scanner.ts
          ├── GET /scan (recursive fs scan + cache)
          ├── POST /import (readFile → runPipeline → INSERT + enrichSubAgents)
          └── helpers: scanDir, quickMeta, extractSessionTitle, enrichWithSubAgents
```

### 2.3 前端层 (Frontend)

```
App.tsx (page router + modal overlays)
    ├── HomePage
    │     ├── SessionCard[] (grid)
    │     ├── UploadModal (drag-drop)
    │     └── ScannerModal (local scan + import)
    ├── ContextAssembly (peak view)
    │     ├── WindowBar (context window bar)
    │     ├── Treemap (squarify)
    │     ├── LegendRow[] (module breakdown)
    │     ├── CategoryGroups (3 donuts)
    │     ├── ToolDrilldown (tool I/O)
    │     ├── GrowthChart (inline SVG)
    │     └── Footer
    ├── TurnInspector (per-turn view)
    │     ├── TurnList (left sidebar)
    │     ├── ContextStructure (stacked bar)
    │     ├── ExecutionTimeline (Gantt + steps + detail)
    │     ├── DeltaPanel (new content)
    │     ├── ToolUsagePanel (tool counts)
    │     └── PeakModal ×2 (peak + cumulative modals)
    ├── PeakModal (embeds ContextAssembly with synthetic data)
    └── ScannerModal (file scan + import)
```

---

## 3. 数据结构设计

### 3.1 核心类型 (src/types/session.ts)

```
层次结构:
  SessionLine (基类)
    ├── AssistantLine (message.content[], message.usage)
    ├── UserLine (message.content: string | ContentBlock[])
    └── SystemLine (subtype, message)

  管线中间产物:
    TurnGroup { userLine, asstLines[], toolResultLines[], systemLines[], startTs, endTs }
    TurnContextComposition { [categoryKey]: number }  // 12 categories
    TimelineSegment { k: 'm'|'t'|'s'|'i', n, ms, ts, det }
    TurnDelta { [categoryKey]: number }

  管线最终产物:
    SessionSummary { session, categories[], series[], tools[] }
    TurnData (= TimelineResult) { i, prompt, comp, delta, segs, cumTotal, ... }

  API 响应:
    SessionListItem { id, filename, model, ai_title, total_requests, peak_tokens, turn_count }
    SessionDetail extends SessionListItem { cwd, peak_index, categories[], tools[], series[] }
    TurnSummary { turn_index, prompt, max_input, out_tok, cum_total, dur_ms, ... }
    TurnDetail extends TurnSummary { comp, delta, tools, segs, longest, cum_cache_hit, ... }
```

### 3.2 数据库表 (SQLite)

**sessions 表 (20+ 列):**
```
id (TEXT PK = SHA256[:16])
file_hash (TEXT UNIQUE)
model, version, ai_title, cwd
total_requests, peak_index, peak_tokens, peak_cache_hit, peak_turn_idx, peak_step
total_output, context_limit (DEFAULT 200000), turn_count, raw_size
categories_json, tools_json, series_json (TEXT/JSON)
raw_jsonl (TEXT, nullable — only stored for uploads)
created_at, updated_at
```

**turns 表 (25+ 列):**
```
id (TEXT PK = "{session_id}_{turn_index}")
session_id (FK → sessions.id, CASCADE)
turn_index, prompt, timestamp
asst_reqs, max_input, max_cache_hit, max_req_idx, max_req_step
out_tok, cum_total, cum_cache_hit
dur_ms, model_ms, tool_ms, sub_ms, step_count
comp_json, delta_json, tools_json, segs_json, longest_json (TEXT/JSON)
cum_tools_json (TEXT/JSON — cumulative tool aggregation)
```

**scanned_files 表:**
```
path (TEXT PK), name, size, modified, hash
title, model, requests, peak_tokens, turn_count
last_seen
```

---

## 4. 接口封装设计

### 4.1 REST API

| Method | Path | 请求 | 响应 |
|--------|------|------|------|
| POST | `/api/sessions/upload` | multipart(file) | `{ id, filename, model, total_requests, peak_tokens, turn_count }` |
| GET | `/api/sessions` | — | `SessionListItem[]` |
| GET | `/api/sessions/:id` | — | `SessionDetail` (含已解析 JSON 数组) |
| GET | `/api/sessions/:id/turns` | — | `TurnSummary[]` (不含 JSON 大字段) |
| GET | `/api/sessions/:id/turns/:idx` | — | `TurnDetail` (含已解析 JSON 字段) |
| DELETE | `/api/sessions/:id` | — | `204` / `404` |
| POST | `/api/scanner/import` | `{ path: string }` | `{ imported, sessionId, model, total_requests, peak_tokens, turn_count }` |
| GET | `/api/scanner/scan` | `?paths=...&depth=3&force=0` | `{ scannedDirs, totalFiles, importedCount, cached, scanned, files[] }` |
| GET | `/api/health` | — | `{ status, db }` |

### 4.2 前端 API 封装 (src/api/client.ts)

```typescript
const BASE = '/api'
get<T>(path): Promise<T>     // GET BASE+path, throws on !ok
post<T>(path, body?): Promise<T>  // POST, auto FormData vs JSON
del(path): Promise<void>     // DELETE
```

### 4.3 状态管理 (Zustand)

**sessionStore:** 会话 CRUD、上传、扫描、轮次数据、modal 开关
- `sessions[]`, `currentSession`, `turns[]`, `currentTurn`
- `uploadOpen`, `scannerOpen`, `scanFiles[]`, `scanStatus`
- Actions: fetch/select/upload/delete + open/close modal

**uiStore:** 跨组件 UI 状态
- `page: 'home' | 'assembly' | 'inspector'`
- `hoveredCategory`: treemap/bar/legend 联动 hover
- `chartHover`: 图表悬浮 tooltip 数据
- `selectedStepIndex`: 步骤详情面板选中项

---

## 5. 关键算法

### 5.1 Token 估算

```
默认: estimateTokens(text) = text.length / 4
校准: calibrateRatio(usageTokens, rawChars) = rawChars / usageTokens
管线实际: calibrateEstimator(groups)
  → systemChars (26327) + firstUserMsgChars
  → 除以第一个请求的 input_tokens
  → 得到会话专属 chars-per-token 比率 (~0.76 for DeepSeek v4)
```

### 5.2 累计拼装 (cumTotal)

```
computeContextInfo(segments, comp, group):
  取最后一个 assistant 的 usage
  cumTotal = input_tokens + cache_read_input_tokens
  cumCacheHit = cache_read_input_tokens
  兜底: sum(Object.values(comp))
```

### 5.3 峰值输入 (peakTokens)

```
aggregateSession:
  遍历所有 assistantLines
  peakTokens = max(usage.input_tokens)   ← 单请求计费峰值
  peakCacheHit = 对应 cache_read
  peakTurnIdx, peakStep: 记录所属轮次和步骤
```

### 5.4 步骤时长分配

```
assignDurations:
  第一遍: seg.ms = msBetween(seg.ts, nextDiffTs)
    末尾段: 若 gap > 30s, 用 outTok / 30 * 1000 估算
  第二遍: 同时间戳段按 token 权重拆分
    weight = thinkTok + textTok + Σ(call.tok) + 1
    每段 ms = totalDur * (weight / totalWeight)
```

### 5.5 请求分组 (步骤列表)

```
分组规则: s.k === 'm' && prev.k !== 'm' → 新组开始
  模型+工具+子代理属于同一请求组
  首步: 上拐角连线  |  中间: 竖线  |  末步: 下拐角连线
  竖线用 top:-2/bottom:-2 跨越 gap:4px
```

### 5.6 Treemap (Bruls-Huizing-van Wijk)

```
squarify(cells, 100, 100):
  过滤零值 → 按 value 降序排列
  缩放: area = value * (10000 / total)
  贪心行增长: 短边优先, 添加条目不恶化 worstRatio
  worstRatio = max(side²·maxArea/sum², sum²/side²·minArea)
  padding 自适应: tiny(<6%)→1/2px, big(>16%&>16%)→9/10px, else 4/5px
```

### 5.7 子代理分类

```
isSubAgentTool(name):
  name === 'Agent' || name === 'Workflow' || name.startsWith('Task')
→ k = 's' (橙色，与普通工具 't' 的琥珀色区分)
```

### 5.8 轮间空闲检测

```
computeTimeline:
  若 i > 0: gap = msBetween(prevTurn.endTs, currentTurn.startTs)
  若 gap > 1000ms: 在 segments 开头插入 k='i' 步骤
  颜色: 灰色 (oklch(0.62 0.03 265))
```

---

## 6. 数据流全景

```
┌── JSONL 文件 (本地 / 上传) ──┐
│                              │
│  scanner/import  POST        │  sessions/upload  POST
│  readFileSync → SHA256       │  multer → buffer
│         │                    │       │
│         └────────┬───────────┘       │
│                  ▼                   │
│           runPipeline(content, filename)
│                  │
│    ┌─────────────┼─────────────┐
│    ▼             ▼             ▼
│  parse       identify      calibrate
│  JSONL       turns         estimator
│    │             │             │
│    └──────┬──────┘             │
│           ▼                   │
│      computeContext ←─────────┘
│           │
│           ▼
│      computeDeltas ──→ computeTimeline
│           │                  │
│           └────────┬─────────┘
│                    ▼
│            aggregateSession
│                    │
│     ┌──────────────┼──────────────┐
│     ▼              ▼              ▼
│  summary      turns[]        errors[]
│     │              │
│     └──────┬───────┘
│            ▼
│     INSERT sessions + turns (SQLite)
│            │
│     ┌──────┴──────┐
│     ▼             ▼
│  enrichWithSubAgents (scanner only)
│  读取 subagents/ 目录 → 嵌入 seg.det.subAgents
│            │
│            ▼
│     API Response → Frontend Store → Component Render
└──────────────────────────────────────────────────────┘
```
