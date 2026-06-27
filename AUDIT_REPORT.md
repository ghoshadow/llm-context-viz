# llm-context-viz 项目全维代码复盘报告

> 审计日期：2026-06-27 | 专家团队：6 人 | 发现 Issue 总数：114

---

## 一、审计总览

| 专家 | 垂直领域 | 🔴 严重 | 🟡 中等 | 🔵 建议 | 合计 |
|------|----------|---------|---------|---------|------|
| Agent A | Token与模型策略 | 4 | 5 | 4 | **13** |
| Agent B | 数据密集流与性能 | 5 | 9 | 4 | **18** |
| Agent C | 并发与异步调度 | 5 | 5 | 7 | **17** |
| Agent D | 可视化与前端渲染 | 7 | 8 | 8 | **23** |
| Agent E | 异常防御与鲁棒性 | 6 | 8 | 10 | **24** |
| Agent F | 工程规范与技术债 | 5 | 8 | 6 | **19** |
| **合计** | — | **32** | **43** | **39** | **114** |

---

## 二、跨领域关联分析

多名专家从不同角度指向了同一组根本性问题。以下是跨领域关联的核心发现：

### 🔗 关联簇 #1：Prompt 注入 + 环境变量泄露 → 全面安全危机

| 来源 | Issue |
|------|-------|
| **Agent A · Issue 9-10** | 用户数据的 evidence/label 未隔离拼入 prompt，Agent SDK 使用 `bypassPermissions` + `allowDangerouslySkipPermissions: true` |
| **Agent E · Issue 1-2** | `{ ...process.env }` 全量展开将 API Key、数据库凭据等所有环境变量注入 Agent SDK 子进程 |

> **联合风险**：攻击者通过被提取的实体文本注入 prompt 指令，让 Agent 执行 bash 命令；此时 Agent 进程拥有 `process.env` 中的所有密钥，攻击面极大。**这是全项目最危险的安全弱点。**

### 🔗 关联簇 #2：同步 I/O 全链路阻塞 → 生产可用性灾难

| 来源 | Issue |
|------|-------|
| **Agent B · Issue I-1, I-2, I-3** | `findJsonlFile`、`scanDir`、`readFileSync` 全部在 Express 请求处理中同步执行 |
| **Agent C · Issue 5** | `child.on('exit')` 回调中同步文件 I/O 阻塞 Event Loop |
| **Agent C · Issue 13-14** | scanner 路由和 refresh 路由中同步 I/O 阻塞 |

> **联合风险**：一个导入请求可能导致整个服务器 10-30 秒无响应。在生产环境并发请求下，所有 API 端点（会话列表、turns 分页、翻译）全部阻塞。

### 🔗 关联簇 #3：Token 计数系统性失准 → 分析数据可信度崩塌

| 来源 | Issue |
|------|-------|
| **Agent A · Issue 1** | 全项目 token 计数基于 `text.length / 3.0` 硬编码线性近似 |
| **Agent A · Issue 2** | `addPadding` 用全空格文本模拟已知字符数的 token |
| **Agent F · Issue 4** | 校准常量在 `compute-context.ts` 和 `calibration-constants.ts` 两处独立硬编码 |

> **联合风险**：模型版本升级后 tokenizer 行为改变，所有 token 数据失效。用户看到的「上下文占用分析」在数学基础上就有 50%+ 的误差。

### 🔗 关联簇 #4：异步 Unhandled Rejection + SSE 无重连 → 任务静默失败

| 来源 | Issue |
|------|-------|
| **Agent C · Issue 1** | `card-summary.ts` fire-and-forget 中 DB 写入 catch 内同步抛出 → 进程崩溃 |
| **Agent C · Issue 3-4** | Agent SDK stream 和前端 SSE 消费均无断线重连 |
| **Agent E · Issue 4** | `collectShardTextResults` 致命异常被静默吞掉，上游以为「只是少了几个分片」 |

> **联合风险**：一个子任务的崩溃可能升级为进程级故障；即使进程不崩溃，SSE 断线后用户也看不到任何恢复提示。

---

## 三、按文件分布的热力图（Top 15 风险文件）

| 风险排名 | 文件 | 🔴 | 🟡 | 🔵 | 合计 | 核心风险 |
|----------|------|----|----|----|------|----------|
| 1 | `server/llm/extract-ontology.ts` | 4 | 3 | 2 | **9** | 环境变量泄露、stream 无重连、异常吞掉 |
| 2 | `server/routes/scanner.ts` | 4 | 2 | 0 | **6** | 同步 I/O 阻塞、30+ 处 any 类型丢失 |
| 3 | `src/pipeline/compute-context.ts` | 0 | 4 | 1 | **5** | Token 估算失准、校准常量硬编码 |
| 4 | `server/services/card-summary.ts` | 2 | 0 | 0 | **2** | Unhandled Rejection + Prompt 注入 |
| 5 | `src/utils/sse.ts` | 1 | 0 | 2 | **3** | 无重连、buffer 内存增长 |
| 6 | `server/routes/sessions.ts` | 1 | 3 | 1 | **5** | 并发无互斥、同步 I/O、COUNT(*) 冗余 |
| 7 | `src/components/pages/TurnInspector.tsx` | 2 | 1 | 1 | **4** | 轮询竞态、as any、fmtDate NaN |
| 8 | `src/components/pages/ContextAssembly.tsx` | 3 | 2 | 1 | **6** | type any、Math 除零、useMemo 失效 |
| 9 | `server/llm/client.ts` | 2 | 0 | 1 | **3** | process.env 泄露、无超时控制 |
| 10 | `server/db.ts` | 1 | 0 | 1 | **2** | 初始化崩溃无保护 |
| 11 | `server/services/pipeline-service.ts` | 2 | 1 | 0 | **3** | 5 次 JSON.stringify + 同步 I/O |
| 12 | `src/pipeline/parse-jsonl.ts` | 1 | 1 | 1 | **3** | split 双倍内存、无内存回收 |
| 13 | `src/pipeline/index.ts` | 2 | 0 | 0 | **2** | as any 绕过类型检查 |
| 14 | `server/routes/shared.ts` | 1 | 0 | 0 | **1** | 同步目录遍历 |
| 15 | `server/llm/translation-client.ts` | 1 | 1 | 0 | **2** | 无超时、无指数退避重试 |

---

## 四、全局 Top 10 最危险问题（跨领域合并去重后）

| 排名 | 问题 | 严重度 | 涉及文件(行号) | 专家来源 |
|------|------|--------|----------------|----------|
| **#1** | **Prompt 注入 + process.env 全量泄露**：Agent SDK `bypassPermissions` 模式下用户数据直接作为 prompt 传入，子进程拥有所有环境变量（API Key、DB 凭据） | 🔴🔴 | `server/llm/client.ts:40-53`, `server/llm/extract-ontology.ts:150`, `server/services/card-summary.ts:101-123` | A+E |
| **#2** | **Express 全链路同步 I/O 阻塞**：`findJsonlFile`、`scanDir`、`readFileSync` 全部在请求线程中执行，一次 import 可达 10-30 秒无响应 | 🔴🔴 | `server/routes/shared.ts:9-34`, `server/routes/scanner.ts:36-66, 469`, `server/routes/sessions.ts:100-128` | B+C |
| **#3** | **全项目 Token 计数系统性失准**：基于 `text.length / 3.0` 硬编码，不同模型偏差 50%+，短文本因 Math.round 丢 token | 🔴 | `src/pipeline/utils.ts:17-18`, `src/pipeline/codex-jsonl.ts:676-678` | A |
| **#4** | **SSE 全链路无断线重连**：前端 `consumeSSE` 和后端 Agent SDK stream 均无重连机制，网络抖动直接丢失整个 extraction 任务 | 🔴 | `src/utils/sse.ts:52-178`, `server/llm/extract-ontology.ts:136-243` | C |
| **#5** | **Unhandled Rejection 可致进程崩溃**：`card-summary.ts` fire-and-forget 中 catch 块内同步 DB 操作可能绕过 rejection tracking | 🔴 | `server/services/card-summary.ts:211-231` | C |
| **#6** | **TurnData 接口与运行时数据不一致**：`cumCacheHit`、`cumTools`、`compressionReset` 三条关键字段需 20+ 处 `as any` 才能访问 | 🔴 | `src/pipeline/index.ts:172-174`, `src/components/pages/TurnInspector.tsx:1733-1801` | D+F |
| **#7** | **12 个核心服务端文件零测试**：`extract-ontology.ts`（816 行）、`extract-session.ts`（360 行）等 LLM 编排核心逻辑完全无自动验证 | 🔴 | 全部 `server/llm/`、`server/routes/`、`server/content/` 仍无测试的文件 | F |
| **#8** | **翻译 API 并发无互斥、无超时、无重试**：相同文本可被并发重复发送，api fetch 无 AbortSignal | 🔴 | `server/routes/sessions.ts:274-342`, `server/llm/translation-client.ts:46-95` | C+E |
| **#9** | **`persistTurns` 每条 turn 5 次 JSON.stringify + 逐条 INSERT**：500 轮会话 = 2500 次序列化 + 500 次同步 DB 调用 | 🔴 | `server/services/pipeline-service.ts:96-124` | B |
| **#10** | **前端 Math 运算无 NaN/Infinity 防护**：`OntologyGraph` Math.min/max 空数组、`PeakModal` 除零、`ContextAssembly` VMAX 除零均可能产生 NaN | 🔴 | `OntologyGraph.tsx:179-180`, `PeakModal.tsx:97`, `ContextAssembly.tsx:149` | D |

---

## 五、修复路线图建议

### 🚨 第一阶段：立即修复（安全 + 可用性，建议 1-2 周）

| 优先级 | 修复项 | 涉及问题 |
|--------|--------|----------|
| P0 | **停止 `process.env` 全量展开**：在 `extract-ontology.ts:150` 和 `client.ts:48-52` 处只传递必要环境变量，显式过滤 `*_KEY`、`*_SECRET`、`*_TOKEN` | E#1, E#2 |
| P0 | **Prompt 注入防护**：在 `card-summary.ts` 和 `orchestrator-prompt.ts` 中对用户来源数据使用 XML 标签包装；将 `callLLM` 改为结构化 `{ system, user }` 参数 | A#9, A#10, A#12 |
| P0 | **异步 I/O 改造**：将 Express 路由中的 `readFileSync`/`readdirSync`/`statSync` 全部切换为 `fs/promises` 异步版本 | B#I1-I3, C#13-14 |
| P0 | **添加 Unhandled Rejection 兜底**：`card-summary.ts:211` 的 fire-and-forget 最外层添加 try-catch-finally | C#1 |
| P1 | **SSE 重连机制**：在 `consumeSSE` 中添加指数退避重连 + `Last-Event-ID` 支持 | C#4 |
| P1 | **翻译 API 添加超时+互斥**：`translation-client.ts` 添加 `AbortSignal.timeout()`，`sessions.ts` 添加 in-flight promise map | C#2, C#8, E#20 |

### 🔧 第二阶段：稳定性修复（数据正确性，建议 2-4 周）

| 优先级 | 修复项 | 涉及问题 |
|--------|--------|----------|
| P2 | **Token 计数引入 tiktoken**：替换全项目 `chars/3.0` 估算，引入模型精确 tokenizer | A#1, A#2 |
| P2 | **校准常量去重**：统一 `compute-context.ts` 和 `calibration-constants.ts` 的硬编码常量 | F#4 |
| P2 | **前端 NaN/Infinity 防护**：所有 Math 运算添加 `Number.isFinite()` 守卫 | D#5, D#7, D#17, D#19 |
| P2 | **`persistTurns` 批量插入优化**：使用 better-sqlite3 WAL + 批量事务替代逐条 INSERT | B#1 |
| P2 | **parseJsonl 流式改造**：避免 `text.split('\n')` 全量数组，改为迭代器逐行消费 | B#M1-M2 |
| P3 | **类型安全修复**：消除 `enrichWithSubAgents` 中 30+ 处 `any`、`TurnInspector` 中 20+ 处 `as any` | F#1-F#5 |

### 📐 第三阶段：工程化提升（测试 + 规范，建议 4-8 周）

| 优先级 | 修复项 | 涉及问题 |
|--------|--------|----------|
| P4 | **核心模块测试补全**：优先覆盖 `extract-ontology.ts`、`extract-session.ts`、`scanner.ts` | F#3 |
| P4 | **冗余依赖清理**：移除 `zod-to-json-schema`，验证并移除 `d3`（如未使用） | F#2-F#3 |
| P4 | **统一的 LLM 配置管理**：创建 `config/llm-defaults.ts` 统一管理模型名、API URL、超时参数 | F#3 |
| P5 | **日期格式化统一**：统一 `fmtDate`/`fmtDateOnly`/`fmtDateShort` 的 locale 策略 | F#1 |
| P5 | **Magic Number 清理**：端口 `4137`、`BLOCK_WRAPPER_CHARS`、`CHARS_PER_TOKEN` 提取为命名常量 | F#2, F#5 |

---

## 六、测试覆盖现状

| 被测文件 | 测试文件 | 状态 |
|----------|----------|------|
| `server/db.ts` | `server/db.test.ts` | ✅ 有测试 |
| `server/content/extract-session.ts` | `server/content/extract-session.test.ts` | ✅ 有测试 |
| `server/llm/client.ts` | `server/llm/client.test.ts` | ✅ 有测试 |
| `server/llm/translation-client.ts` | `server/llm/translation-client.test.ts` | ✅ 有测试 |
| `server/obsidian/graph-config.ts` | `server/obsidian/graph-config.test.ts` | ✅ 有测试 |
| `server/obsidian/markdown.ts` | `server/obsidian/markdown.test.ts` | ✅ 有测试 |
| `server/routes/pagination.ts` | `server/routes/pagination.test.ts` | ✅ 有测试 |
| `server/routes/sessions-translate.ts` | `server/routes/sessions-translate.test.ts` | ✅ 有测试 |
| `server/services/calibration-constants.ts` | `server/services/calibration-constants.test.ts` | ✅ 有测试 |
| `server/services/calibration-job.ts` | `server/services/calibration-job.test.ts` | ✅ 有测试 |
| `server/services/calibration-launchers.ts` | `server/services/calibration-launchers.test.ts` | ✅ 有测试 |
| `server/services/claude-config.ts` | `server/services/claude-config.test.ts` | ✅ 有测试 |
| `server/services/codex-config.ts` | `server/services/codex-config.test.ts` | ✅ 有测试 |
| `src/pipeline/codex-jsonl.ts` | `src/pipeline/codex-jsonl.test.ts` | ✅ 有测试 |
| `src/pipeline/extract-constants.ts` | `src/pipeline/extract-constants.test.ts` | ✅ 有测试 |
| — | — | — |
| **`server/llm/extract-ontology.ts`** (816 行) | **无测试** | ❌ |
| **`server/routes/scanner.ts`** (500+ 行) | **无测试** | ❌ |
| **`server/routes/calibrate.ts`** | **无测试** | ❌ |
| **`server/routes/ontology.ts`** | **无测试** | ❌ |
| **`server/routes/obsidian.ts`** | **无测试** | ❌ |
| **`server/services/extraction-job.ts`** | **无测试** | ❌ |
| **`server/services/card-summary.ts`** | **无测试** | ❌ |
| **`server/content/extract-to-files.ts`** | **无测试** | ❌ |
| **`server/llm/orchestrator-prompt.ts`** | **无测试** | ❌ |

**测试覆盖率：约 15/28 核心源文件 = 54%（但按代码量计算约仅 31%，因为最大的几个文件都无测试）**

---

## 七、冗余依赖检测

| 依赖 | 在 package.json | 实际使用 | 建议 |
|------|-----------------|----------|------|
| `zod-to-json-schema` | `dependencies` | 未导入任何源文件 | **立即移除** |
| `d3` | `dependencies` | 未找到 `import from 'd3'` | **验证后移除** |
| `@types/d3` | `dependencies` | 同上 | **随 d3 移除或移至 devDeps** |
| `zod` | `dependencies` | 仅 `server/llm/schema.ts` 使用 | ✅ 保留 |

---

## 八、审计团队

| 代号 | 专家 | 专注领域 | 发现数 |
|------|------|----------|--------|
| Agent A | Token与模型策略专家 | Tiktoken/HuggingFace 计数、Chunking 边界、Prompt 注入 | 13 |
| Agent B | 数据密集流与性能专家 | 内存大户、序列化效率、文件 I/O 阻塞 | 18 |
| Agent C | 并发与异步调度专家 | 线程安全、Rate Limit、Streaming 重连 | 17 |
| Agent D | 可视化与前端渲染专家 | 数据 Schema、组件生命周期、渲染崩溃 | 23 |
| Agent E | 异常防御与鲁棒性专家 | Exception 边界、敏感日志、SDK 降级 | 24 |
| Agent F | 工程规范与技术债专家 | 类型提示、魔术常量、测试盲区、冗余依赖 | 19 |

---

> 📋 **报告生成方式**：6 位专家在完全独立的上下文中并行审计项目全局代码，仅在自己的垂直领域内列出 Issue 清单，严禁职责交叉。全部完成后由 Lead（主会话）汇总、去重、交叉关联后输出本报告。
> 
> 🤖 Generated with [Claude Code](https://claude.com/claude-code)
