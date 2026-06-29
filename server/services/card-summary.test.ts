/**
 * card-summary.test.ts — 卡片摘要生成服务测试
 *
 * 覆盖：
 * - ontologyTypeLabel() 类型标签查找
 * - buildKnowledgeCardSummaryPrompt() prompt 构建
 * - getOntologyCardNodes() 节点关联逻辑（通过 aggregate / edges）
 * - 正常路径、边界条件、错误处理
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ontologyTypeLabel,
  buildKnowledgeCardSummaryPrompt,
} from '../services/card-summary.js';
import type {
  ObsidianNodeLike,
  ObsidianEdgeLike,
  ObsidianOntologyDataLike,
} from '../obsidian/card-context.js';

// ── 固定测试数据 ────────────────────────────────────────────────────────

const TOPIC_NODE: ObsidianNodeLike = {
  id: 'foo_debug',
  label: 'Foo 调试问题',
  type: 'topic',
  firstTurn: 1,
  turns: [1, 5, 12],
  aggregateId: 'agg_1',
  claim: 'Foo 框架在异步环境下存在竞态条件',
  snippet: '在生产环境发现 Foo 框架的 race condition',
  evidence: [
    { turn: 1, source: 'user', text: 'Foo 在生产环境偶发崩溃', weight: 1.0 },
    { turn: 5, source: 'reply', text: '确认是异步竞态条件导致', weight: 0.95 },
  ],
};

const WHY_NODE: ObsidianNodeLike = {
  id: 'foo_race_why',
  label: 'Foo 竞态根因',
  type: 'why',
  firstTurn: 3,
  turns: [3, 5, 7],
  aggregateId: 'agg_1',
  claim: 'Foo 的 Promise 链未正确处理取消信号',
  snippet: 'Promise 链在组件卸载后仍继续执行',
  evidence: [
    { turn: 3, source: 'reply', text: '分析发现是 Promise 未取消导致的', weight: 0.9 },
  ],
};

const HOW_TO_NODE: ObsidianNodeLike = {
  id: 'foo_fix_how',
  label: '修复 Foo 竞态条件',
  type: 'how_to',
  firstTurn: 5,
  turns: [5, 8, 10],
  aggregateId: 'agg_1',
  claim: '使用 AbortController 在组件卸载时取消异步操作',
  snippet: '引入 AbortController 统一管理取消信号',
  evidence: [
    { turn: 5, source: 'reply', text: '推荐使用 AbortController 模式', weight: 0.95 },
  ],
};

const PITFALL_NODE: ObsidianNodeLike = {
  id: 'foo_pitfall',
  label: 'Foo 异步陷阱',
  type: 'pitfall',
  firstTurn: 7,
  turns: [7, 9],
  claim: '在 useEffect 中使用 async 函数但不处理清理',
  snippet: '常见误区：直接在 useEffect 中写 async 回调',
  evidence: [
    { turn: 7, source: 'user', text: '我之前一直在 useEffect 里用 async', weight: 0.8 },
  ],
};

const EDGE_BETWEEN_TOPIC_AND_WHY: ObsidianEdgeLike = {
  s: 'foo_debug',
  t: 'foo_race_why',
  label: '根因分析',
  direction: 'directed',
  firstTurn: 3,
  conf: 0.95,
  evidence: [
    { turn: 3, source: 'reply', text: '竞态条件是崩溃的根因', weight: 0.95 },
  ],
};

const EDGE_BETWEEN_WHY_AND_HOW: ObsidianEdgeLike = {
  s: 'foo_race_why',
  t: 'foo_fix_how',
  label: '解决',
  direction: 'directed',
  firstTurn: 5,
  conf: 0.95,
  evidence: [
    { turn: 5, source: 'reply', text: '修复方案针对根因设计', weight: 0.9 },
  ],
};

function makeData(overrides?: Partial<ObsidianOntologyDataLike>): ObsidianOntologyDataLike {
  return {
    nodes: [TOPIC_NODE, WHY_NODE, HOW_TO_NODE, PITFALL_NODE],
    edges: [EDGE_BETWEEN_TOPIC_AND_WHY, EDGE_BETWEEN_WHY_AND_HOW],
    aggregates: [
      {
        id: 'agg_1',
        label: 'Foo 调试与修复',
        startTurn: 1,
        endTurn: 12,
        nodeIds: ['foo_debug', 'foo_race_why', 'foo_fix_how', 'foo_pitfall'],
      },
    ],
    types: [
      { key: 'topic', label: '问题/主题' },
      { key: 'why', label: '为什么' },
      { key: 'how_to', label: '怎么做' },
      { key: 'pitfall', label: '坑/教训' },
    ],
    ...overrides,
  };
}

// ── ontologyTypeLabel 测试 ───────────────────────────────────────────────

test('ontologyTypeLabel 返回正确的中文标签', () => {
  const data = makeData();
  assert.equal(ontologyTypeLabel(data, 'topic'), '问题/主题');
  assert.equal(ontologyTypeLabel(data, 'why'), '为什么');
  assert.equal(ontologyTypeLabel(data, 'how_to'), '怎么做');
  assert.equal(ontologyTypeLabel(data, 'pitfall'), '坑/教训');
});

test('ontologyTypeLabel 对未知类型返回 key 本身', () => {
  const data = makeData();
  assert.equal(ontologyTypeLabel(data, 'unknown_type'), 'unknown_type');
});

test('ontologyTypeLabel 处理空 types 数组', () => {
  const data = makeData({ types: [] });
  assert.equal(ontologyTypeLabel(data, 'topic'), 'topic');
});

// ── buildKnowledgeCardSummaryPrompt 测试 ────────────────────────────────

test('buildKnowledgeCardSummaryPrompt 成功构建 prompt', () => {
  const data = makeData();
  const prompt = buildKnowledgeCardSummaryPrompt(data, 'foo_debug');

  assert.ok(typeof prompt === 'string', '应返回字符串');
  assert.ok(prompt.length > 0, 'prompt 不应为空');
});

test('buildKnowledgeCardSummaryPrompt 包含主题节点信息', () => {
  const data = makeData();
  const prompt = buildKnowledgeCardSummaryPrompt(data, 'foo_debug');

  assert.ok(prompt.includes('Foo 调试问题'), '应包含 topic 节点的 label');
  assert.ok(prompt.includes('foo_debug'), '应包含 topic 节点的 id');
});

test('buildKnowledgeCardSummaryPrompt 包含关联节点', () => {
  const data = makeData();
  const prompt = buildKnowledgeCardSummaryPrompt(data, 'foo_debug');

  // 通过 edges 直接连接到 topic 的 why 节点应出现
  assert.ok(prompt.includes('foo_race_why'), '应包含通过 edge 直接连接的 why 节点');
  // 注意：getOntologyCardNodes 只遍历与 topic 直接相邻的 edge
  // how_to 通过 why 间接连接，不会自动包含在 prompt 中
  // 如果 topic 有 aggregateId 且 node 在该 aggregate 的 nodeIds 中，则通过 aggregate 路径匹配
});

test('buildKnowledgeCardSummaryPrompt 包含知识类型标签', () => {
  const data = makeData();
  const prompt = buildKnowledgeCardSummaryPrompt(data, 'foo_debug');

  assert.ok(prompt.includes('[问题/主题]'), '应包含类型中文标签');
  assert.ok(prompt.includes('[为什么]'), '应包含类型中文标签');
});

test('buildKnowledgeCardSummaryPrompt 包含用户信息隔离', () => {
  const data = makeData();
  const prompt = buildKnowledgeCardSummaryPrompt(data, 'foo_debug');

  assert.ok(prompt.includes('<user_card_data>'), '应使用 user_card_data 标签隔离');
  assert.ok(prompt.includes('</user_card_data>'), '应有闭合标签');
});

test('buildKnowledgeCardSummaryPrompt 包含首现轮次信息', () => {
  const data = makeData();
  const prompt = buildKnowledgeCardSummaryPrompt(data, 'foo_debug');

  assert.ok(prompt.includes('第1轮'), '应包含 topic 首现轮次');
});

// ── 边界条件 ─────────────────────────────────────────────────────────────

test('buildKnowledgeCardSummaryPrompt 对不存在的 topicId 抛出异常', () => {
  const data = makeData();
  assert.throws(
    () => buildKnowledgeCardSummaryPrompt(data, 'nonexistent'),
    /主题节点不存在/,
    '不存在的 topicId 应抛出异常',
  );
});

test('buildKnowledgeCardSummaryPrompt 对非 topic 类型节点抛出异常', () => {
  const data = makeData();
  assert.throws(
    () => buildKnowledgeCardSummaryPrompt(data, 'foo_race_why'),
    /只有问题\/主题节点/,
    '非 topic 类型节点应抛出异常',
  );
});

test('buildKnowledgeCardSummaryPrompt 处理无关系的孤立 topic', () => {
  const isolatedTopic: ObsidianNodeLike = {
    id: 'isolated',
    label: '孤立话题',
    type: 'topic',
    firstTurn: 1,
    turns: [1],
    claim: '没有任何关系连接的 topic',
    snippet: '一个孤立话题',
    evidence: [],
  };
  const data = makeData({
    nodes: [isolatedTopic],
    edges: [],
    aggregates: [],
  });
  const prompt = buildKnowledgeCardSummaryPrompt(data, 'isolated');

  assert.ok(typeof prompt === 'string', '应正常返回 prompt');
  assert.ok(prompt.includes('孤立话题'), '应包含 topic label');
  assert.ok(prompt.includes('无显式关系') || !prompt.includes('-->'), '无关系时应标注');
});

test('buildKnowledgeCardSummaryPrompt 处理带 aggregate 的 topic', () => {
  const data = makeData();
  const prompt = buildKnowledgeCardSummaryPrompt(data, 'foo_debug');

  // aggregate 的 label 应在 card_title 中
  assert.ok(prompt.includes('Foo 调试与修复'), '应使用 aggregate label 作为标题');
  assert.ok(prompt.includes('第1-12轮'), '应使用 aggregate 的轮次范围');
});

test('buildKnowledgeCardSummaryPrompt 处理无 aggregate 但有 turns 的 topic', () => {
  const topicNoAgg: ObsidianNodeLike = {
    id: 'no_agg_topic',
    label: '无聚合根话题',
    type: 'topic',
    firstTurn: 5,
    turns: [5, 8],
    claim: '没有 aggregate 但有 turns',
    snippet: '无聚合根话题内容',
    evidence: [{ turn: 5, source: 'user', text: '提出问题', weight: 1.0 }],
  };
  const data = makeData({
    nodes: [topicNoAgg],
    edges: [],
    aggregates: [],
  });
  const prompt = buildKnowledgeCardSummaryPrompt(data, 'no_agg_topic');

  assert.ok(prompt.includes('无聚合根话题'), '应 fallback 到 topic label');
  assert.ok(prompt.includes('第5轮'), '应 fallback 到 firstTurn');
});

// ── XML 转义测试 ─────────────────────────────────────────────────────────

test('buildKnowledgeCardSummaryPrompt 转义 card_title 中的 XML 特殊字符', () => {
  const topicWithXml: ObsidianNodeLike = {
    id: 'xml_topic',
    label: '测试 & " \' < > 标签',
    type: 'topic',
    firstTurn: 1,
    turns: [1],
    claim: '含特殊字符的 claim',
    snippet: 'snippet with special chars',
    evidence: [{ turn: 1, source: 'user', text: '带有特殊字符的输入', weight: 1.0 }],
  };
  const data = makeData({
    nodes: [topicWithXml],
    edges: [],
    aggregates: [],
  });
  const prompt = buildKnowledgeCardSummaryPrompt(data, 'xml_topic');

  // card_title 应使用 escapeXml 转义特殊字符
  const titleMatch = prompt.match(/<card_title>([^<]+)<\/card_title>/);
  assert.ok(titleMatch !== null, '应包含 card_title');
  const title = titleMatch![1]!;
  // XML escape 已将特殊字符转义
  assert.ok(title.includes('&amp;'), '& 应转义为 &amp;');
  assert.ok(title.includes('&quot;'), '" 应转义为 &quot;');
  assert.ok(title.includes('&apos;'), 'single quote should be escaped as &apos;');
  assert.ok(title.includes('&lt;'), '< 应转义为 &lt;');
  assert.ok(title.includes('&gt;'), '> 应转义为 &gt;');
});
