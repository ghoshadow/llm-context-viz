# LLM Context Viz

可视化 LLM 对话上下文的本地工具——扫描 Claude Code / Codex 的 JSONL 会话文件，以交互式 UI 展示 token 分布、turn 结构与上下文演变。

## 技术栈

| 层 | 技术 |
|---|------|
| 前端 | React 19 + Zustand + Vite 6 + oklch 内联样式 |
| 后端 | Express 5 + better-sqlite3 (WAL) |
| 桌面 | Tauri 2（可选，macOS `.app`）|
| 测试 | `node:test` + `node:assert/strict` |
| 类型 | TypeScript 5.6，严格模式 |

## 快速开始

```bash
# 安装依赖
pnpm install

# 开发模式（前端 + 后端同时启动）
pnpm dev          # Vite dev server（前端）
pnpm server       # Express API server（端口 4137）

# 桌面应用
pnpm tauri:dev    # Tauri 开发模式
pnpm tauri:build  # 生产构建 macOS .app
```

## 核心功能

- **会话扫描** — 扫描 `~/.claude/projects/` 和 `~/.codex/` 目录下的 JSONL 文件，SHA256 去重，增量导入
- **Turn 检查器** — 查看单次对话 turn 的 token 分布（模型/子代理/工具/系统/用户），支持分页
- **上下文组装视图** — 柱状图展示 context window 内 token 占用，按类别（system prompt、tool call、content block）拆解
- **LLM 翻译** — 对 tool call 参数/结果进行中文翻译（Anthropic API / 兼容端点）
- **本体提取** — 从会话内容中自动提取概念节点和关系边，SSE 流式返回
- **Obsidian 集成** — 导出知识卡片到 Obsidian vault 的 `LLM知识卡片/` 目录
- **校准系统** — 校准 LLM 分析参数（手动 + 自动检测），用于分类器微调
- **模型配置** — 管理 Anthropic API key、自定义端点、模型选择
- **桌面打包** — Tauri 2 封装为 macOS 原生应用，带系统托盘

## 项目结构

```
server/           Express 5 API——路由、服务、LLM 客户端、数据库
src/              React 19 前端——组件、store、工具、类型
  components/
    pages/        主要页面（TurnInspector, ContextAssembly, CalibratePage）
    shared/       可复用 UI（ContentRenderer, MarkdownBlock, DiffView）
    home/         首页
  store/          Zustand store（sessionStore, uiStore）
  styles/         设计 token（oklch 颜色）
  utils/          格式化、SSE 客户端、sessionSource
  api/            HTTP 客户端（fetch + AbortController）
  types/          共享 TypeScript 类型
  pipeline/       会话数据处理管道（纯逻辑，无 JSX）
src-tauri/        Tauri 2 桌面壳（Rust）
data/             SQLite 数据库 + 配置（运行时生成）
```

## 数据库

单文件 SQLite (`data/llm-context.db`)，通过 `PRAGMA user_version` 管理迁移版本。核心表：`sessions`、`turns`、`steps`、`translations`、`ontology_nodes/edges`、`calibration_constants`、`obsidian_config`。

## 测试

```bash
pnpm test          # 运行全部 server/src 下 .test.ts 文件
```

测试使用内存 SQLite（`:memory:`），不依赖外部数据库。测试文件与源文件同目录（`.test.ts` 命名）。

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 服务器端口 | `4137` |
| `ANTHROPIC_API_KEY` | Anthropic API 密钥 | — |
| `ANTHROPIC_BASE_URL` | 自定义 API 端点 | `https://api.anthropic.com` |
| `ANTHROPIC_MODEL` | 默认模型 | `claude-sonnet-4-6` |
| `NODE_ENV` | 运行环境 | `development` |
| `DATA_DIR` | 数据目录 | `./data` |

## 桌面应用

Tauri 2 桌面包运行内嵌 Express server + Vite 前端，通过 ATS 例外支持 localhost HTTP 请求。打包前会检测 `ANTHROPIC_API_KEY` 地址类型（公网/内网/本机）以避免网络阻断。
