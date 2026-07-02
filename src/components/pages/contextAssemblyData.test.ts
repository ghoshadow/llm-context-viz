import assert from 'node:assert/strict';
import test from 'node:test';
import type { ContextCategory, ToolAggregation, SeriesPoint } from '../../types/session';
import { buildContextAssemblyData, type PeakSessionData } from './contextAssemblyData';

test('builds context assembly display data from session aggregates', () => {
  const session: PeakSessionData = {
    model: 'codex-test',
    version: '1.2.3',
    cwd: '/tmp/project',
    total_requests: 42,
    peak_index: 7,
    peak_tokens: 30_000,
    context_limit: 100_000,
    peak_cache_hit: 12_345,
    peak_turn_idx: 3,
    peak_step: 2,
  };
  const categories: ContextCategory[] = [
    category('toolResults', '工具结果', 'io', 20_000),
    category('subagent', '子 Agent', 'io', 5_000),
    category('userMsgs', '用户消息', 'convo', 15_000),
    category('sysPrompt', '系统提示词', 'core', 10_000),
  ];
  const tools: ToolAggregation[] = [
    { name: 'Task', calls: 2, resultTokens: 2_000, task: true },
    { name: 'Read', calls: 4, resultTokens: 1_000, task: false },
  ];
  const series: SeriesPoint[] = [
    { i: 0, assembled: 10_000, input: 1_000, output: 100 },
    { i: 7, assembled: 50_000, input: 30_000, output: 500 },
  ];

  const data = buildContextAssemblyData({
    session,
    categories,
    tools,
    series,
    hoveredCategory: 'subagent',
    setHoveredCategory: () => {},
  });

  assert.equal(data.CATSUM, 50_000);
  assert.equal(data.windowPctFmt, '50.00%');
  assert.equal(data.freeTokensFmt, '50,000');
  assert.equal(data.contextLimitFmt, '100K');
  assert.equal(data.legendRows[0]?.pctFmt, '40.00%');
  assert.equal(data.legendRows[0]?.op, 0.26);
  assert.equal(data.legendRows[1]?.op, 1);
  assert.equal(data.groups.find((group) => group.key === 'io')?.tokensFmt, '25,000 tok');
  assert.equal(data.toolRows[0]?.taskTag, ' · 子 Agent');
  assert.equal(data.toolRows[0]?.resultFmt, '6,000 chars');
  assert.equal(data.subAgentPctFmt, '10.00%');
  assert.equal(data.subAgentTokFmt, '5,000');
  assert.equal(data.series, series);
});

function category(
  key: string,
  label: string,
  group: ContextCategory['group'],
  tokens: number,
): ContextCategory {
  return {
    key,
    label,
    group,
    tokens,
    raw: tokens * 4,
    estimated: false,
  };
}
