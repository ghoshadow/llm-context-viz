import assert from 'node:assert/strict';
import test from 'node:test';
import type { KnowledgeCardContext } from './card-context';
import { mergeManagedFrontmatter, renderManagedFrontmatter } from './markdown';

const context: KnowledgeCardContext = {
  topic: {
    id: 'topic_1',
    label: '角色扮演训练方法论',
    type: 'topic',
    firstTurn: 1,
    claim: '围绕张大仙数字分身项目，系统提取角色扮演模型训练的方法论知识。',
    snippet: '张大仙 AI 数字分身需要模仿主播说话风格、语气和情感。',
  },
  aggregate: {
    id: 'agg_1',
    label: '角色扮演训练方法论',
    startTurn: 1,
    endTurn: 18,
  },
  nodes: [],
  edges: [],
  evidence: [],
  types: [
    { key: 'topic', label: '问题/主题', color: 'oklch(0.80 0.12 0)' },
  ],
  title: '角色扮演训练方法论',
  startTurn: 1,
  endTurn: 18,
};

const agentContext: KnowledgeCardContext = {
  topic: {
    id: 'topic_2',
    label: '大型代码库分析处理过程',
    type: 'topic',
    firstTurn: 1,
    claim: '分析智能体在大型代码库中读取项目结构、委派子代理、执行工具调用和总结源码架构的流程。',
    snippet: '主 Agent 通过 subagent 调度完成代码库分析，重点关注代码执行分析和项目结构理解。',
  },
  aggregate: {
    id: 'agg_2',
    label: '大型代码库分析处理过程',
    startTurn: 1,
    endTurn: 8,
  },
  nodes: [],
  edges: [],
  evidence: [],
  types: [
    { key: 'topic', label: '问题/主题', color: 'oklch(0.80 0.12 0)' },
  ],
  title: '大型代码库分析处理过程',
  startTurn: 1,
  endTurn: 8,
};

function managedFrontmatter(): string {
  return renderManagedFrontmatter({
    sessionId: 'session_1',
    topicId: 'topic_1',
    context,
    syncedAt: '2026-06-24T00:00:00.000Z',
  });
}

function managedFrontmatterFor(nextContext: KnowledgeCardContext): string {
  return renderManagedFrontmatter({
    sessionId: 'session_1',
    topicId: nextContext.topic.id,
    context: nextContext,
    syncedAt: '2026-06-24T00:00:00.000Z',
  });
}

test('renders only the shared 类型 tag for synced Obsidian cards', () => {
  const markdown = managedFrontmatter();

  assert.match(markdown, /  - 类型\/本体卡片/);
  assert.match(markdown, /  - 类型\/模型上下文总结/);
  assert.match(markdown, /  - 领域\/数字分身/);
  assert.match(markdown, /  - 主题\/角色扮演训练/);
  assert.match(markdown, /  - 主题\/模型训练/);
  assert.doesNotMatch(markdown, /  - 领域\/软件工程/);
  assert.doesNotMatch(markdown, /  - 领域\/知识管理/);
  assert.doesNotMatch(markdown, /来源\/大模型上下文/);
  assert.doesNotMatch(markdown, /本体颜色\/主题/);
  assert.doesNotMatch(markdown, /  - llm-context/);
  assert.doesNotMatch(markdown, /  - ontology-card/);
  assert.doesNotMatch(markdown, /ontology-color\/topic/);
  assert.doesNotMatch(markdown, /  - 类型\/对话总结/);
  assert.doesNotMatch(markdown, /color_group/);
});

test('does not infer software engineering from data reconstruction in model training content', () => {
  const trainingContext: KnowledgeCardContext = {
    ...context,
    topic: {
      ...context.topic,
      claim: '训练数据中游戏内容占比过高，需要重构数据减少通用场景下的游戏内容。',
      snippet: '张大仙数字分身模型训练要处理数据分布、标签均衡、超参调优和角色风格保持。',
    },
    title: '角色扮演模型训练经验',
  };

  const markdown = managedFrontmatterFor(trainingContext);

  assert.match(markdown, /  - 领域\/数字分身/);
  assert.match(markdown, /  - 主题\/模型训练/);
  assert.doesNotMatch(markdown, /  - 领域\/软件工程/);
});

test('merges managed frontmatter without removing user curated tags', () => {
  const existing = `---
source: llm-context-viz
session_id: "old_session"
tags:
  - llm-context
  - ontology-card
  - ontology-color/topic
  - 来源/大模型上下文
  - 本体颜色/主题
  - 类型/对话总结
  - 领域/软件工程
  - 主题/代码库分析
  - 领域/数字分身
  - 主题/角色扮演训练
custom_field: keep-me
---

# 角色扮演训练方法论

<!-- llm-context-viz:start -->
old managed block
<!-- llm-context-viz:end -->

## 我的补充

人工补充内容
`;

  const merged = mergeManagedFrontmatter(existing, managedFrontmatter());

  assert.match(merged, /  - 类型\/本体卡片/);
  assert.match(merged, /  - 类型\/模型上下文总结/);
  assert.doesNotMatch(merged, /  - 类型\/对话总结/);
  assert.match(merged, /  - 领域\/数字分身/);
  assert.match(merged, /  - 主题\/角色扮演训练/);
  assert.match(merged, /  - 主题\/模型训练/);
  assert.doesNotMatch(merged, /  - 领域\/软件工程/);
  assert.doesNotMatch(merged, /  - 主题\/代码库分析/);
  assert.match(merged, /custom_field: keep-me/);
  assert.match(merged, /人工补充内容/);
  assert.doesNotMatch(merged, /来源\/大模型上下文/);
  assert.doesNotMatch(merged, /本体颜色\/主题/);
  assert.doesNotMatch(merged, /  - llm-context/);
  assert.doesNotMatch(merged, /  - ontology-card/);
  assert.doesNotMatch(merged, /ontology-color\/topic/);
});

test('rebuilds domain and topic tags when a previous sync already removed them', () => {
  const existing = `---
source: llm-context-viz
session_id: "old_session"
tags:
  - 类型/本体卡片
---

# 角色扮演训练方法论

<!-- llm-context-viz:start -->
old managed block
<!-- llm-context-viz:end -->
`;

  const merged = mergeManagedFrontmatter(existing, managedFrontmatter());

  assert.match(merged, /  - 类型\/本体卡片/);
  assert.match(merged, /  - 类型\/模型上下文总结/);
  assert.match(merged, /  - 领域\/数字分身/);
  assert.match(merged, /  - 主题\/角色扮演训练/);
  assert.match(merged, /  - 主题\/模型训练/);
});

test('infers domain and topic tags from non-digital-human content', () => {
  const markdown = managedFrontmatterFor(agentContext);

  assert.match(markdown, /  - 类型\/本体卡片/);
  assert.match(markdown, /  - 类型\/模型上下文总结/);
  assert.match(markdown, /  - 领域\/智能体/);
  assert.match(markdown, /  - 领域\/软件工程/);
  assert.match(markdown, /  - 主题\/代码执行分析/);
  assert.match(markdown, /  - 主题\/代码库分析/);
  assert.doesNotMatch(markdown, /  - 领域\/数字分身/);
  assert.doesNotMatch(markdown, /  - 主题\/角色扮演训练/);
  assert.doesNotMatch(markdown, /  - 主题\/模型训练/);
});
