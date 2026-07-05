# LLM Context Viz

[![Node.js](https://img.shields.io/badge/node-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![React](https://img.shields.io/badge/react-19-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/typescript-5.6-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Version](https://img.shields.io/badge/version-1.0.0-111827)](package.json)
[![License](https://img.shields.io/badge/license-AGPL--3.0-16a34a)](LICENSE)

> LLM 对话上下文可视化工具——扫描本地 Claude Code / Codex 会话记录，以交互式 UI 展示 token 分布、turn 结构与上下文演变。

<br>

LLM Context Viz 是一个基于 **Express + React** 构建的本地工具，支持将 LLM 会话 JSONL 文件导入 SQLite 数据库，并提供多维度的可视化分析。核心特性：

- **会话扫描** — 递归扫描 `~/.claude/projects/`、`~/.codex/sessions/` 和 `~/.codex/archived_sessions/`，SHA256 去重，增量导入。支持 Claude Code（Anthropic SDK 格式）和 Codex（OpenAI 兼容格式）两种 JSONL 来源
- **处理管道** — 五阶段同步管道（解析 → Turn 分组 → Token 计算 → 时间线拆解 → 摘要聚合），核心逻辑集中在 `shared/pipeline/`，前后端零依赖共享
- **Turn 检查器** — 按 turn 粒度拆解 token 分布（模型 / 子代理 / 工具 / 系统 / 用户），支持执行时间线、token 增量面板、工具使用统计
- **上下文组装视图** — 柱状图展示 context window 内 token 占用，按类别（system prompt、tool call、content block）拆解，含增长趋势折线图
- **LLM 翻译** — 对 tool call 参数 / 结果进行中文翻译（Chat Completions 兼容端点），支持项目常量缓存翻译
- **本体提取** — 从会话内容中自动提取概念节点和关系边，分片并发、置信度评分、缓存复用、失败分片重跑，SSE 流式返回并保持长连接
- **校准系统** — 校准 LLM 分析参数（手动 + 自动检测），按来源（claude/codex）独立维护，用于分类器微调和 token 估算
- **模型配置** — 管理 `LLM_API_KEY`、自定义端点、模型选择，支持 `~/.llm-context-viz/.env`、项目 `.env` 和环境变量

<br>

## 服务架构

```mermaid
flowchart LR
    Browser["Browser"] --> Vite["Vite Dev Server"]
    Browser --> Express["Express 5 API Server"]

    subgraph Frontend["前端层"]
        React["React 19"]
        Zustand["Zustand Store"]
        Pages["TurnInspector / ContextAssembly / Ontology / Calibrate"]
    end

    subgraph Shared["共享层（零依赖）"]
        Pipeline["Pipeline 核心 shared/pipeline/"]
        Types["跨层类型 shared/types/"]
    end

    subgraph Backend["后端层"]
        Routes["Routes /sessions(+ontology) /scanner /calibrate /obsidian /monitor /config"]
        Services["Services pipeline / calibration / card-summary / extraction"]
        LLM["LLM Client translation / ontology-extraction (分片+置信度+合并)"]
        Monitor["File Monitor watcher"]
    end

    subgraph Data["数据层"]
        SQLite["SQLite (WAL)"]
        JSONL["JSONL 文件扫描"]
    end

    Vite --> React
    React --> Zustand
    Zustand --> Pages

    Pages --> Pipeline
    React --> Pipeline
    Express --> Routes
    Routes --> Services
    Services --> Pipeline
    Services --> LLM
    Services --> SQLite
    Monitor --> JSONL
    Monitor --> Services
```

<br>

## 快速开始

### 本地开发

```bash
git clone https://github.com/ghoshadow/llm-context-viz.git
cd llm-context-viz
npm install

# 开发模式（两个终端分别启动前端和后端）
npm run dev          # Vite dev server（前端，端口 5173）
npm run server       # Express API server（后端，端口 4137）
```

生产模式由 Express 托管构建后的前端：

```bash
npm run build
NODE_ENV=production npm run server
```

当前项目是 Web 本地工具，近期已移除 Tauri/桌面打包脚本。

### 首次启动

1. （可选）配置 LLM API 密钥以启用翻译和本体提取功能
2. 打开前端页面，点击「扫描会话」导入本地 JSONL 文件
3. 选择会话进入 Turn 检查器或上下文组装视图

<br>

## WebUI 页面

| 页面 | 路由 | 说明 |
| :-- | :-- | :-- |
| 首页 | `#home` | 会话列表、扫描入口、模型配置 |
| Turn 检查器 | `#inspector` | 单次对话 turn 的 token 分布详情 |
| 上下文组装 | `#assembly` | 柱状图展示 context window token 占用 |
| 本体图谱 | `#ontology` | 概念节点和关系边的可视化 |
| 校准面板 | `#calibrate` | LLM 分析参数校准与管理 |
| 扫描弹窗 | 全局 | 选择会话来源、预览、导入 |

<br>

## 环境变量

| 变量 | 说明 | 默认值 |
| :-- | :-- | :-- |
| `PORT` | 服务器端口 | `4137` |
| `VITE_PORT` | Vite 开发服务器端口 | `5173` |
| `LLM_BASE_URL` | 本体提取 / 卡片总结端点（Anthropic 兼容） | `https://api.deepseek.com/anthropic` |
| `LLM_API_KEY` | LLM API 密钥；运行时会安全映射给 Claude Agent SDK 子进程 | — |
| `LLM_MODEL` | 本体提取 / 卡片总结模型 | `deepseek-v4-pro` |
| `TRANSLATION_BASE_URL` | 翻译端点（Chat Completions 兼容） | `https://api.deepseek.com/chat/completions` |
| `TRANSLATION_MODEL` | 翻译模型 | `deepseek-v4-flash` |
| `TRANSLATION_MAX_TOKENS` | 翻译请求最大输出 token（可选） | — |
| `NODE_ENV` | 运行环境 | `development` |
| `LLM_CONTEXT_VIZ_DATA_DIR` | 数据目录覆盖 | `./data` |

<br>

## API 一览

所有 API 前缀为 `/api`，默认监听 `http://localhost:4137`。

| 接口 | 方法 | 说明 |
| :-- | :-- | :-- |
| `/api/health` | `GET` | 健康检查，返回服务状态和数据目录 |
| `/api/sessions` | `GET` | 获取全部会话列表 |
| `/api/sessions/:id` | `GET` | 获取单个会话详情 |
| `/api/sessions/:id` | `DELETE` | 删除会话及其关联数据 |
| `/api/sessions/:id/refresh` | `POST` | 重新解析原始 JSONL 并刷新 turn 数据 |
| `/api/sessions/:id/turns` | `GET` | 获取会话 turn 列表（分页） |
| `/api/sessions/:id/turns/:turnIndex` | `GET` | 获取指定 turn 的完整数据 |
| `/api/sessions/:id/translate` | `POST` | 翻译会话中 tool call 内容 |
| `/api/sessions/:id/translations/:turnIndex` | `GET` | 获取 turn 翻译缓存，可带 `constantSections` |
| `/api/sessions/:id/ontology` | `GET` / `POST` / `DELETE` | 读取、保存或删除本体数据 |
| `/api/sessions/:id/ontology/extract` | `POST` | 触发本体提取任务（SSE） |
| `/api/sessions/:id/ontology/extract/status` | `GET` | 查询本体提取任务状态 |
| `/api/sessions/:id/ontology/content-status` | `GET` | 查询会话内容文件拆分状态 |
| `/api/sessions/:id/ontology/content-extract` | `POST` | 将会话内容拆分导出到文件 |
| `/api/sessions/:id/ontology/summarize-card` | `POST` | 启动主题知识卡片总结任务 |
| `/api/sessions/:id/ontology/summarize-card/:topicId` | `GET` / `PUT` | 获取或手动保存主题总结 |
| `/api/sessions/:id/ontology/obsidian-card/:topicId` | `GET` / `POST` | 查询或同步 Obsidian 知识卡片 |
| `/api/scanner/scan` | `GET` | 扫描默认或指定目录下的 JSONL 文件 |
| `/api/scanner/import` | `POST` | 导入选中的 JSONL 文件 |
| `/api/calibrate/current` | `GET` | 读取当前项目和来源的校准常量 |
| `/api/calibrate/apply` | `PUT` | 应用校准常量 |
| `/api/calibrate/auto/start` | `POST` | 启动自动校准任务 |
| `/api/calibrate/auto/:jobId` | `GET` | 查询自动校准任务状态 |
| `/api/calibrate/auto/:jobId/cancel` | `POST` | 取消自动校准任务 |
| `/api/obsidian/config` | `GET` / `PUT` | 读写 Obsidian 集成配置 |
| `/api/config/model` | `GET` / `PUT` | 读写模型配置 |
| `/api/config/home` | `GET` | 获取用户 home 目录路径 |
| `/api/monitor/snapshot` | `GET` | 获取活跃会话上下文快照 |

<details>
<summary><code>GET /api/sessions</code> — 获取会话列表</summary>
<br>

```bash
curl http://localhost:4137/api/sessions
```

响应示例：

```json
[
  {
    "id": "abc123",
    "source": "claude",
    "cwd": "/Users/link/my-project",
    "title": "my-project",
    "turnCount": 42,
    "createdAt": "2026-06-15T10:30:00.000Z"
  }
]
```

<br>
</details>

<details>
<summary><code>GET /api/sessions/:id/turns</code> — 获取 turn 列表</summary>
<br>

```bash
curl "http://localhost:4137/api/sessions/abc123/turns?limit=50&offset=0"
```

| 参数 | 说明 |
| :-- | :-- |
| `limit` | 每页条数，默认 200，最大 500 |
| `offset` | 偏移量 |

<br>
</details>

<details>
<summary><code>GET /api/scanner/scan</code> — 扫描 JSONL 文件</summary>
<br>

```bash
curl "http://localhost:4137/api/scanner/scan?paths=/Users/me/.claude/projects,/Users/me/.codex/sessions&depth=3&force=1"
```

| 参数 | 说明 |
| :-- | :-- |
| `paths` | 要扫描的目录列表，逗号分隔；省略时使用默认 Claude/Codex 会话目录 |
| `depth` | 最大递归深度，默认 `3` |
| `force` | 设为 `1` 时清空扫描缓存并重新计算文件 hash |

<br>
</details>

<details>
<summary><code>POST /api/sessions/:id/translate</code> — 翻译 tool call</summary>
<br>

```bash
curl -X POST http://localhost:4137/api/sessions/abc123/translate \
  -H "Content-Type: application/json" \
  -d '{"text":"hello","turnIndex":3,"stepIndex":1,"sectionIndex":0}'
```

| 字段 | 说明 |
| :-- | :-- |
| `text` | 要翻译的文本 |
| `turnIndex` | Turn 序号（从 0 开始） |
| `stepIndex` | Step 序号 |
| `sectionIndex` | 同一 step 内的文本段序号 |
| `force` | 设为 `true` 时跳过缓存重新翻译 |

<br>
</details>

<details>
<summary><code>POST /api/sessions/:id/ontology/extract</code> — 本体提取（SSE 流式）</summary>
<br>

```bash
curl -N -X POST http://localhost:4137/api/sessions/abc123/ontology/extract \
  -H "Content-Type: application/json" \
  -d '{"shardSize":30,"maxShardChars":45000,"incremental":true,"extractionDepth":"refined"}'
```

响应为 SSE 事件流，空闲时会发送 keepalive；`data` 字段包含提取进度、分片状态和最终统计。

| 字段 | 说明 |
| :-- | :-- |
| `shardSize` | 每个分片的 turn 数，默认 `30` |
| `maxShardChars` | 单个分片最大字符数，默认 `45000` |
| `force` | 忽略缓存重新提取 |
| `incremental` | 与已有本体结果增量合并 |
| `retryFailedOnly` | 只重跑失败分片 |
| `extractionDepth` | `refined` 或 `deep` |

<br>
</details>

<br>

## 配置体系

### 配置分层

| 位置 | 用途 | 生效时机 |
| :-- | :-- | :-- |
| `~/.llm-context-viz/.env` | 前端模型配置写入位置 | 保存后即时生效 |
| 项目 `.env` | 启动前配置（端口、数据目录等） | 服务启动时 |
| `data/llm-context.db` | 运行时数据（会话、校准、Obsidian 配置） | 保存后即时生效 |
| 前端 ModelConfig | `LLM_*` 和 `TRANSLATION_*` 配置 | 即时生效 |

### 模型配置项

通过前端 ModelConfig 弹窗或 `PUT /api/config/model` 接口配置：

| 配置项 | 说明 |
| :-- | :-- |
| `LLM_API_KEY` | 本体提取、知识卡片总结和翻译共用的 API Key |
| `LLM_BASE_URL` | 本体提取 / 卡片总结使用的 Anthropic 兼容端点 |
| `LLM_MODEL` | 本体提取 / 卡片总结模型 |
| `TRANSLATION_BASE_URL` | 可选翻译端点，不填时使用默认 Chat Completions 地址 |
| `TRANSLATION_MODEL` | 可选翻译模型，不填时使用默认翻译模型 |

### 校准配置项

通过校准面板或 API 管理，存储在 `calibration_constants` 表中：

| 分组 | 关键项 |
| :-- | :-- |
| 分类阈值 | `tool_call_threshold`、`thinking_threshold`、`content_threshold` |
| Token 估算 | `chars_per_token`、`overhead_per_turn` |
| 来源适配 | 按 `claude` / `codex` 来源分别维护独立常量集 |

<br>

## 项目结构

```
llm-context-viz/
├── server/                    Express 5 API
│   ├── routes/                路由层
│   │   ├── sessions.ts        会话 CRUD、turn 查询、翻译触发
│   │   ├── scanner.ts         JSONL 扫描与增量导入
│   │   ├── calibrate.ts       校准常量提取、应用、任务状态
│   │   ├── ontology.ts        本体提取作业、SSE 流式返回
│   │   ├── obsidian.ts        Obsidian 集成配置
│   │   ├── config.ts          模型配置与 home 目录
│   │   └── shared.ts          跨路由共享工具（JSONL 文件查找）
│   ├── services/              业务逻辑层
│   │   ├── pipeline-service.ts      管道调度（解析 → 聚合 → 持久化）
│   │   ├── calibration-job.ts       校准提取作业管理
│   │   ├── calibration-constants.ts  校准常量读写
│   │   ├── extraction-job.ts        本体提取作业管理
│   │   ├── card-summary.ts          Obsidian 卡片摘要生成
│   │   ├── claude-config.ts         Claude Code 配置解析
│   │   ├── codex-config.ts          Codex 配置解析
│   │   ├── env-file.ts              .env 文件读写
│   │   └── sub-agent-enricher.ts    子代理调用详情富化
│   ├── repositories/          SQLite 数据访问层
│   │   ├── session-repository.ts    会话 & turn 存储
│   │   └── ontology-repository.ts   本体实体 & 边存储
│   ├── llm/                   LLM 客户端模块
│   │   ├── client.ts               Anthropic SDK 封装
│   │   ├── translation-client.ts   OpenAI 兼容端点翻译
│   │   ├── config.ts               API 密钥与端点管理
│   │   ├── schema.ts               Zod schema（翻译回复校验）
│   │   ├── extract-ontology.ts     本体提取入口
│   │   ├── ontology-confidence.ts  置信度评分
│   │   ├── ontology-merge.ts       分片结果合并
│   │   ├── ontology-response-parser.ts   LLM 回复解析
│   │   ├── ontology-shard-collector.ts   分片收集器
│   │   └── orchestrator-prompt.ts       编排器 prompt 模板
│   ├── monitor/               文件系统监控（目录监听 + 路由）
│   ├── obsidian/              Obsidian 集成（卡片 Markdown 生成、同步、图配置）
│   ├── content/               会话内容提取与文件导出
│   ├── middleware/            请求校验（Zod validateBody 中间件工厂）
│   └── utils/                 日志脱敏等工具
├── src/                       React 19 前端
│   ├── components/
│   │   ├── pages/             主要页面
│   │   │   ├── TurnInspector.tsx           Turn 检查器主组件
│   │   │   ├── turnInspectorLogic.ts       纯逻辑层（数据聚合、翻译状态）
│   │   │   ├── turnInspectorPanels.tsx     面板组合
│   │   │   ├── TurnStepDetailPanel.tsx     Step 详情面板
│   │   │   ├── turn-inspector/            Turn 子面板
│   │   │   │   ├── ContextStructure.tsx    上下文结构面板
│   │   │   │   ├── DeltaPanel.tsx          Token 增量面板
│   │   │   │   ├── ExecutionTimeline.tsx   执行时间线
│   │   │   │   ├── ToolUsagePanel.tsx      工具使用面板
│   │   │   │   └── TurnListItem.tsx        Turn 列表项
│   │   │   ├── ContextAssembly.tsx         上下文组装主组件
│   │   │   ├── ContextAssemblyBreakdown.tsx Token 分类拆解
│   │   │   ├── ContextAssemblyOverview.tsx 概览卡片
│   │   │   ├── ContextAssemblyTools.tsx    工具栏与排序
│   │   │   ├── ContextAssemblyGrowthSection.tsx 增长趋势区
│   │   │   ├── ContextGrowthChart.tsx      上下文增长折线图
│   │   │   ├── contextAssemblyData.ts      数据转换纯逻辑
│   │   │   ├── CalibratePage.tsx           校准面板
│   │   │   ├── calibrationPagePanels.tsx   面板布局
│   │   │   ├── calibrationAutoStart.ts     自动检测触发
│   │   │   ├── calibrationCategories.ts    分类常量管理
│   │   │   ├── calibrationSource.ts        来源适配逻辑
│   │   │   ├── calibrationDetailModal.ts   详情编辑弹窗
│   │   │   ├── calibrationFailureNotice.ts 失败通知组件
│   │   │   ├── useAutoCalibrationJob.ts    自动校准 hook
│   │   │   ├── useCalibrationDetailTranslation.ts 翻译详情 hook
│   │   │   ├── useCurrentCalibrationConstants.ts  常量查询 hook
│   │   │   └── ModelConfigModal.tsx         模型配置弹窗
│   │   ├── home/              首页（会话列表、标题、路径展示）
│   │   ├── ontology/          本体图谱
│   │   │   ├── OntologyPage.tsx           图谱主页
│   │   │   ├── OntologyGraph.tsx          力导向布局图
│   │   │   ├── ontologyGraphLayout.ts     图布局纯逻辑
│   │   │   ├── OntologySelectedEntity.tsx 选中实体详情
│   │   │   ├── ontologyDetailLogic.ts     详情数据处理
│   │   │   ├── OntologyDetailPanel.tsx    详情面板
│   │   │   ├── EntitySummarySection.tsx   实体摘要
│   │   │   ├── EntityEvidenceSection.tsx  证据展示
│   │   │   ├── EntityRelationsSection.tsx 关系列表
│   │   │   ├── ObsidianActionsSection.tsx Obsidian 操作
│   │   │   ├── OntologyEmptyState.tsx     空状态
│   │   │   ├── OntologyToolbar.tsx        工具栏
│   │   │   ├── typeOrder.ts              类型排序常量
│   │   │   ├── useEntitySummary.ts        实体摘要 hook
│   │   │   └── useObsidianCardSync.ts     Obsidian 卡片同步 hook
│   │   ├── shared/            可复用 UI 组件
│   │   │   ├── ContentRenderer.tsx         内容渲染入口
│   │   │   ├── contentRenderStrategy.ts    渲染策略分发
│   │   │   ├── MarkdownBlock.tsx           Markdown 容器
│   │   │   ├── MarkdownCodeBlock.tsx       代码块渲染
│   │   │   ├── MarkdownDiffFileBlock.tsx   文件差异块
│   │   │   ├── markdownDiffTable.ts        差异表渲染
│   │   │   ├── markdownInline.tsx          行内元素
│   │   │   ├── markdownTable.tsx           表格渲染
│   │   │   ├── markdownToolOutput.ts       Tool 输出渲染
│   │   │   ├── StructuredTextBlock.tsx     结构化文本块
│   │   │   ├── structuredText.ts           结构化文本解析
│   │   │   ├── commandMessage.ts           /command 消息渲染
│   │   │   ├── unifiedDiff.ts              Unified diff 解析
│   │   │   ├── ProgressBar.tsx             进度条
│   │   │   └── DiffView.tsx                文本差异比较
│   │   └── upload/            扫描弹窗（Scanner 文件选择、预览导入）
│   ├── store/                 Zustand store（sessionStore, uiStore）
│   ├── api/                   HTTP 客户端（fetch + AbortController）
│   ├── pipeline/              管道层（re-export stubs → shared/pipeline/，仅保留测试）
│   ├── styles/                设计 token（oklch 颜色、CSS 变量）
│   ├── types/                 前端类型定义（ontology.ts, session.ts）
│   └── utils/                 格式化、SSE 客户端、几何工具、来源判断
├── shared/                    跨层共享（前端 + 后端零依赖引用）
│   ├── constants.ts           应用常量
│   ├── session-source.ts      会话来源工具
│   ├── pipeline/              ⭐ 管道核心逻辑（纯 TS，无 Node/Browser 依赖）
│   │   ├── index.ts               管道编排器（5 阶段同步运行）
│   │   ├── parse-jsonl.ts         JSONL 解析
│   │   ├── identify-turns.ts      Turn 识别分组
│   │   ├── compute-context.ts     上下文 token 计算（含校准常量加载）
│   │   ├── compute-timeline.ts    执行时间线拆解
│   │   ├── aggregate-session.ts   会话摘要聚合
│   │   ├── build-ontology.ts      本地本体构建
│   │   ├── calibration-types.ts   校准类型定义与规范化
│   │   ├── constants.ts           管道常量
│   │   ├── extract-constants.ts   常量提取
│   │   ├── extract-codex-constants.ts Codex 常量提取
│   │   ├── utils.ts               token 估算、工具判断
│   │   ├── codex-jsonl.ts          Codex JSONL 入口（re-export）
│   │   ├── codex-jsonl-types.ts    Codex 类型定义
│   │   ├── codex-jsonl-parser.ts   Codex 行解析器
│   │   ├── codex-jsonl-turns.ts    Codex Turn 分组
│   │   ├── codex-jsonl-segments.ts Codex 时间线拆解
│   │   └── codex-jsonl-summary.ts  Codex 摘要聚合
│   └── types/                 跨层类型定义
│       ├── index.ts               barrel export
│       ├── session.ts             会话 & turn 类型
│       ├── ontology.ts            本体实体 & 关系类型
│       └── calibration.ts         校准常量类型
├── data/                      SQLite 数据库 + 配置（运行时生成）
└── dist/                      Vite 构建输出
```

> **架构要点**：`shared/pipeline/` 是管道核心的单一事实源，所有实现代码集中于此。`src/pipeline/` 仅保留 re-export 桩文件（`export * from '../../shared/pipeline/...'`）和测试用例，以保证前端消费方无需修改导入路径。`shared/` 目录下的代码不依赖 Node.js 或浏览器特定 API，可被前后端零依赖引用。

<br>

## 技术栈

| 层 | 技术 |
| :-- | :-- |
| 前端 | React 19 + Zustand 5 + Vite 6 + oklch 设计系统 |
| 后端 | Express 5 + better-sqlite3 (WAL) + Zod 4 校验 |
| LLM | Anthropic SDK（Claude Agent SDK）+ OpenAI 兼容端点 |
| 构建 | TypeScript 5.6 + Vite 6 |
| 测试 | `node:test` + `node:assert/strict`（内存 SQLite） |

<br>

## 测试

```bash
npm test          # 运行全部 server/src 下 .test.ts 文件
```

测试使用内存 SQLite（`:memory:`），不依赖外部数据库。测试文件与源文件同目录（`.test.ts` 命名）。管道核心逻辑的测试位于 `src/pipeline/*.test.ts`，通过 re-export 桩引用 `shared/pipeline/` 的实现代码。

<br>

## 许可证

本项目基于 **GNU Affero General Public License v3.0 (AGPL-3.0)** 许可证开源。详见 [LICENSE](LICENSE) 文件。

> [!NOTE]
> 本项目仅供学习与研究交流。使用 LLM API 功能时请务必遵循相关服务的使用条款及当地法律法规。
