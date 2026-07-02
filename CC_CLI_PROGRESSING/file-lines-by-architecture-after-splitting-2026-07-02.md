# 大文件拆分后行数与功能架构快照

生成日期：2026-07-02

统计范围：
- 前端：`src/**/*.ts`、`src/**/*.tsx`
- 后端：`server/**/*.ts`、`server/**/*.tsx`
- 共享运行时：`shared/**/*.ts`

统计口径：使用 `wc -l` 统计物理行数，包含空行和注释。

本报告是 `CC_CLI_PROGRESSING/file-lines-by-architecture-2026-07-02.md` 的拆分后快照。原报告保留为拆分前基线。

总量：
- 前端 `src/`：16,249 行
- 后端 `server/`：11,044 行
- 共享 `shared/`：5,083 行

## 拆分结论

本次按计划拆分 7 个建议拆文件，目标是保持公开入口和运行行为不变，同时把内部逻辑按职责移到更小模块。

| 原文件 | 拆分前行数 | 拆分后入口行数 | 结果 |
|---|---:|---:|---|
| `shared/pipeline/codex-jsonl.ts` | 979 | 49 | 已拆为 parser、turns、segments、summary、types，入口只保留识别和编排。 |
| `server/llm/extract-ontology.ts` | 900 | 391 | 已拆为响应解析、分片采集、合并、置信度计算，入口保留主流程和公开类型。 |
| `src/components/ontology/OntologySelectedEntity.tsx` | 903 | 304 | 已拆为摘要 hook、Obsidian hook、证据/关系/摘要/Obsidian 展示区。 |
| `src/components/pages/turnInspectorPanels.tsx` | 838 | 5 | 已改为兼容 barrel，五个面板各自成文件。 |
| `src/components/ontology/OntologyGraph.tsx` | 673 | 365 | 已抽出纯布局与几何计算，并补充布局回归测试。 |
| `src/components/shared/MarkdownBlock.tsx` | 668 | 305 | 已拆出 inline、code block、diff file、table helpers；修复过拆分时引入的循环 import。 |
| `src/components/pages/CalibratePage.tsx` | 658 | 554 | 已抽出当前常量、自动校准任务、详情翻译三个 hook；页面仍保留编排和大量 JSX。 |

## 当前仍超过 500 行的文件

这些文件仍超过 500 行，但多数不属于本轮最高收益拆分对象。

| 行数 | 文件 | 当前判断 |
|---:|---|---|
| 829 | `shared/pipeline/compute-timeline.ts` | 可暂缓。仍是单一 timeline 计算核心，下一次改 timeline 时再拆 model/tool/metrics。 |
| 627 | `src/components/pages/TurnInspector.tsx` | 可暂缓。主要是页面数据加载、分页、选择和跳转编排；展示面板已外拆。 |
| 625 | `src/components/ontology/OntologyPage.tsx` | 可暂缓。页面状态较多，但拆 hook 需要小心状态依赖，建议等下一次改图谱页面时处理。 |
| 595 | `src/pipeline/codex-jsonl.test.ts` | 不建议按行数拆。测试长主要来自样例和行为覆盖，必要时只抽 fixture。 |
| 559 | `src/components/home/HomePage.tsx` | 可暂缓。首页可拆卡片/列表，但当前复杂度还可接受。 |
| 554 | `src/components/pages/CalibratePage.tsx` | 可继续小拆，但不建议为了行数立刻拆。剩余主要是页面布局、表单和结果展示编排。 |

## 共享运行时：Codex JSONL Pipeline

| 行数 | 文件 | 功能逻辑 |
|---:|---|---|
| 49 | `shared/pipeline/codex-jsonl.ts` | 公开入口，保留 `isCodexJsonl` 和 `runCodexPipeline` 编排。 |
| 47 | `shared/pipeline/codex-jsonl-types.ts` | Codex JSONL pipeline 内部类型，包括行、turn、token、工具调用和工具结果。 |
| 118 | `shared/pipeline/codex-jsonl-parser.ts` | 逐行解析 JSONL，提取 payload、文本、工具输入输出和时长。 |
| 79 | `shared/pipeline/codex-jsonl-turns.ts` | 将 Codex 行事件组装为 turn，并处理 turn 收尾状态。 |
| 399 | `shared/pipeline/codex-jsonl-segments.ts` | 构建 timeline segments，收集工具调用/结果，计算 token 指标和 segment 时长。 |
| 347 | `shared/pipeline/codex-jsonl-summary.ts` | 聚合 Codex session 摘要、context 组成、工具统计和 turn 输出。 |

## 后端：Ontology 提取

| 行数 | 文件 | 功能逻辑 |
|---:|---|---|
| 391 | `server/llm/extract-ontology.ts` | Ontology 提取公开入口，保留公开类型、prompt 组装和 `extractAndBuild` 主流程。 |
| 61 | `server/llm/ontology-response-parser.ts` | 从 agent 输出和 tool result 中提取 JSON，格式化 schema 校验错误，并转换 evidence。 |
| 182 | `server/llm/ontology-shard-collector.ts` | 调用 Agent SDK 处理分片，收集文本结果和分片错误。 |
| 133 | `server/llm/ontology-merge.ts` | 聚合分片节点/边，合并相似实体，并提供标签相似度计算。 |
| 149 | `server/llm/ontology-confidence.ts` | 证据权重、状态推断、证据归一化、置信度计算、标签去重和 snippet 质量检查。 |

## 前端：Turn 检查器面板

| 行数 | 文件 | 功能逻辑 |
|---:|---|---|
| 5 | `src/components/pages/turnInspectorPanels.tsx` | 兼容 barrel，继续向旧调用方导出五个面板组件。 |
| 203 | `src/components/pages/turn-inspector/TurnListItem.tsx` | Turn 列表单行渲染，展示 prompt 预览、token、状态和选中态。 |
| 161 | `src/components/pages/turn-inspector/ContextStructure.tsx` | 上下文结构面板，展示 context 组成、token 占比和分类树。 |
| 321 | `src/components/pages/turn-inspector/ExecutionTimeline.tsx` | 执行时间线面板，渲染 segment 条、选中 step 和 step 详情连接。 |
| 62 | `src/components/pages/turn-inspector/DeltaPanel.tsx` | 单 turn token delta 概览。 |
| 71 | `src/components/pages/turn-inspector/ToolUsagePanel.tsx` | 累计工具调用和工具结果 token 展示。 |

## 前端：Ontology 图谱

| 行数 | 文件 | 功能逻辑 |
|---:|---|---|
| 365 | `src/components/ontology/OntologyGraph.tsx` | 图谱 React 组件，负责交互状态、滚动聚焦、SVG 渲染和事件处理。 |
| 320 | `src/components/ontology/ontologyGraphLayout.ts` | 纯布局模块，负责节点排布、边路径、截断、端口和布局结果构建。 |
| 48 | `src/components/ontology/ontologyGraphLayout.test.ts` | 布局回归测试，验证可见节点和边输出。 |

## 前端：Ontology 选中实体详情

| 行数 | 文件 | 功能逻辑 |
|---:|---|---|
| 304 | `src/components/ontology/OntologySelectedEntity.tsx` | 选中实体详情容器，保留头部、基础 metadata、派生数据和 section 组合。 |
| 163 | `src/components/ontology/useEntitySummary.ts` | 实体摘要状态、生成、编辑、保存和轮询。 |
| 135 | `src/components/ontology/useObsidianCardSync.ts` | Obsidian 配置状态、配置保存、同步动作和错误状态。 |
| 208 | `src/components/ontology/EntitySummarySection.tsx` | 实体摘要展示、生成按钮、编辑表单和保存/取消控件。 |
| 103 | `src/components/ontology/EntityEvidenceSection.tsx` | 置信度说明和 evidence 列表渲染。 |
| 61 | `src/components/ontology/EntityRelationsSection.tsx` | 相关实体/关系列表，并连接节点选择回调。 |
| 170 | `src/components/ontology/ObsidianActionsSection.tsx` | Obsidian 配置表单、同步按钮、状态和错误提示。 |

## 前端：Markdown 渲染

| 行数 | 文件 | 功能逻辑 |
|---:|---|---|
| 305 | `src/components/shared/MarkdownBlock.tsx` | Markdown 块级渲染入口，保留主解析循环和公开导出。 |
| 62 | `src/components/shared/markdownInline.tsx` | 内联 markdown 渲染，处理 bold、inline code 和链接。 |
| 82 | `src/components/shared/MarkdownCodeBlock.tsx` | 语法高亮语言注册、代码块样式和 `CodeBlock`。 |
| 171 | `src/components/shared/MarkdownDiffFileBlock.tsx` | 统一 diff 文件的并排展示和 diff 行样式；通过 fallback renderer 避免循环 import。 |
| 68 | `src/components/shared/markdownTable.tsx` | Markdown 表格行识别、分隔符识别、对齐解析、单元格解析和表格样式。 |

## 前端：校准页面

| 行数 | 文件 | 功能逻辑 |
|---:|---|---|
| 554 | `src/components/pages/CalibratePage.tsx` | 校准页面容器，保留来源、prompt、target host、结果、应用、弹窗和页面 JSX 编排。 |
| 27 | `src/components/pages/useCurrentCalibrationConstants.ts` | 按 cwd/source 拉取当前校准常量，并暴露刷新用 setter。 |
| 112 | `src/components/pages/useAutoCalibrationJob.ts` | 自动校准启动、取消、轮询、运行状态和结果回调。 |
| 120 | `src/components/pages/useCalibrationDetailTranslation.ts` | 校准详情翻译缓存查询、手动翻译、复制状态和错误状态。 |

## 验证记录

本轮每个拆分任务均经过实现、规格检查和质量检查。最终需要以当前分支 head 再跑：

```bash
npm test
npm run build
```
