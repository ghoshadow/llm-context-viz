import assert from 'node:assert/strict';
import test from 'node:test';
import { isCodexJsonl, runCodexPipeline } from './codex-jsonl';

const codexSample = [
  {
    timestamp: '2026-06-26T01:00:00.000Z',
    type: 'session_meta',
    payload: {
      session_id: 'sess_1',
      id: 'thread_1',
      cwd: '/repo',
      cli_version: '0.99.0',
      base_instructions: 'You are Codex.',
      dynamic_tools: [{ name: 'exec_command' }],
    },
  },
  {
    timestamp: '2026-06-26T01:00:01.000Z',
    type: 'event_msg',
    payload: {
      type: 'task_started',
      turn_id: 'turn_1',
      model_context_window: 258400,
    },
  },
  {
    timestamp: '2026-06-26T01:00:01.100Z',
    type: 'turn_context',
    payload: {
      turn_id: 'turn_1',
      cwd: '/repo',
      model: 'gpt-5.5',
    },
  },
  {
    timestamp: '2026-06-26T01:00:01.200Z',
    type: 'event_msg',
    payload: {
      type: 'user_message',
      message: '实现 Codex 日志解析',
    },
  },
  {
    timestamp: '2026-06-26T01:00:03.000Z',
    type: 'response_item',
    payload: {
      type: 'reasoning',
      id: 'rs_1',
      summary: [],
      encrypted_content: 'encrypted',
      internal_chat_message_metadata_passthrough: { turn_id: 'turn_1' },
    },
  },
  {
    timestamp: '2026-06-26T01:00:04.000Z',
    type: 'event_msg',
    payload: {
      type: 'agent_message',
      message: '我先看一下结构。',
      phase: 'commentary',
    },
  },
  {
    timestamp: '2026-06-26T01:00:04.001Z',
    type: 'response_item',
    payload: {
      type: 'message',
      id: 'msg_1',
      role: 'assistant',
      content: [{ type: 'output_text', text: '我先看一下结构。' }],
      phase: 'commentary',
      internal_chat_message_metadata_passthrough: { turn_id: 'turn_1' },
    },
  },
  {
    timestamp: '2026-06-26T01:00:05.000Z',
    type: 'response_item',
    payload: {
      type: 'function_call',
      id: 'fc_1',
      name: 'exec_command',
      arguments: '{"cmd":"rg parse-jsonl src"}',
      call_id: 'call_1',
      internal_chat_message_metadata_passthrough: { turn_id: 'turn_1' },
    },
  },
  {
    timestamp: '2026-06-26T01:00:06.000Z',
    type: 'response_item',
    payload: {
      type: 'function_call_output',
      call_id: 'call_1',
      output: 'src/pipeline/parse-jsonl.ts',
    },
  },
  {
    timestamp: '2026-06-26T01:00:06.100Z',
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        last_token_usage: {
          input_tokens: 12345,
          cached_input_tokens: 1000,
          output_tokens: 55,
          reasoning_output_tokens: 12,
          total_tokens: 12400,
        },
        model_context_window: 258400,
      },
    },
  },
  {
    timestamp: '2026-06-26T01:00:07.000Z',
    type: 'event_msg',
    payload: {
      type: 'task_complete',
      turn_id: 'turn_1',
      duration_ms: 6000,
      last_agent_message: '结构看完了。',
    },
  },
].map((line) => JSON.stringify(line)).join('\n');

test('detects Codex JSONL transcripts', () => {
  assert.equal(isCodexJsonl(codexSample), true);
  assert.equal(isCodexJsonl('{"type":"user","uuid":"u1","timestamp":"2026-06-26T00:00:00Z"}'), false);
});

test('parses Codex turns into the data required by the turn inspector', () => {
  const { summary, turns } = runCodexPipeline(codexSample, 'rollout-test.jsonl');
  const turn = turns[0]!;

  assert.equal(summary.session.model, 'gpt-5.5');
  assert.equal(summary.session.cwd, '/repo');
  assert.equal(summary.session.requests, 1);
  assert.equal(summary.session.peakTokens, 12345);
  assert.equal(summary.session.peakCacheHit, 1000);
  assert.equal(summary.session.contextLimit, 258400);
  assert.equal(summary.session.aiTitle, '实现 Codex 日志解析');
  assert.equal(turns.length, 1);

  assert.equal(turn.prompt, '实现 Codex 日志解析');
  assert.equal(turn.asstReqs, 1);
  assert.equal(turn.maxInput, 12345);
  assert.equal(turn.maxCacheHit, 1000);
  assert.equal(turn.outTok, 55);
  assert.equal(turn.cumTotal, 12345);
  assert.equal(turn.tools.exec_command, 1);
  assert.ok((turn.comp.userMsgs ?? 0) > 0);
  assert.ok((turn.comp.asstText ?? 0) > 0);
  assert.ok((turn.comp.toolCalls ?? 0) > 0);
  assert.ok((turn.comp.toolResults ?? 0) > 0);

  const thinking = turn.segs.find((seg) => seg.k === 'm' && seg.det.think);
  assert.match(thinking?.det.think ?? '', /Codex 推理内容已加密/);
  assert.equal(thinking?.det.thinkTok, 12);

  const reply = turn.segs.find((seg) => seg.k === 'm' && seg.det.text);
  assert.equal(reply?.det.text, '我先看一下结构。');
  assert.equal(turn.segs.filter((seg) => seg.k === 'm' && seg.det.text === '我先看一下结构。').length, 1);

  const callStep = turn.segs.find((seg) => seg.k === 'm' && seg.det.calls?.[0]?.name === 'exec_command');
  assert.equal(callStep?.det.calls?.[0]?.input, '{"cmd":"rg parse-jsonl src"}');

  const resultStep = turn.segs.find((seg) => seg.k === 't' && seg.n === 'exec_command');
  assert.equal(resultStep?.det.result, 'src/pipeline/parse-jsonl.ts');
  assert.equal(resultStep?.det.isError, false);
  assert.equal(resultStep?.det.stepTools?.exec_command?.calls, 1);
  assert.ok((resultStep?.det.stepTools?.exec_command?.resultTokens ?? 0) > 0);
  assert.equal((turn as any).cumTools.exec_command.calls, 1);
});

test('seeds Codex core context from recorded session metadata', () => {
  const metadataSample = [
    {
      timestamp: '2026-06-26T01:00:00.000Z',
      type: 'session_meta',
      payload: {
        session_id: 'sess_1',
        cwd: '/repo',
        cli_version: '0.99.0',
        base_instructions: { text: 'System instruction text for Codex.' },
        dynamic_tools: [
          {
            type: 'mcp',
            name: 'codex_app',
            description: 'Desktop integration tools.',
            tools: [{ name: 'exec_command', description: 'Run a command.' }],
          },
        ],
      },
    },
    {
      timestamp: '2026-06-26T01:00:01.000Z',
      type: 'event_msg',
      payload: { type: 'task_started', turn_id: 'turn_1' },
    },
    {
      timestamp: '2026-06-26T01:00:01.010Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'developer',
        content: [
          { type: 'input_text', text: '<permissions instructions>filesystem access</permissions instructions>' },
          { type: 'input_text', text: '<skills_instructions>available skills</skills_instructions>' },
          { type: 'input_text', text: '<plugins_instructions>installed plugins</plugins_instructions>' },
        ],
      },
    },
    {
      timestamp: '2026-06-26T01:00:01.100Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: '检查 Codex 常量' },
    },
    {
      timestamp: '2026-06-26T01:00:02.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          last_token_usage: {
            input_tokens: 500,
            output_tokens: 20,
          },
        },
      },
    },
  ].map((line) => JSON.stringify(line)).join('\n');

  const { summary, turns } = runCodexPipeline(metadataSample, 'metadata.jsonl');
  const turn = turns[0]!;

  assert.ok((turn.comp.sysPrompt ?? 0) > 0);
  assert.ok((turn.comp.tool_defs ?? 0) > 0);
  assert.ok((turn.comp.skills ?? 0) > 0);
  assert.ok((turn.comp.mcp ?? 0) > 0);
  assert.ok((turn.comp.reminders ?? 0) > 0);
  assert.equal(summary.categories.find((cat) => cat.key === 'sysPrompt')?.tokens, turn.comp.sysPrompt);
});

test('uses readable Codex reasoning summaries when present', () => {
  const summarySample = [
    {
      timestamp: '2026-06-26T01:00:00.000Z',
      type: 'event_msg',
      payload: { type: 'task_started', turn_id: 'turn_1' },
    },
    {
      timestamp: '2026-06-26T01:00:00.100Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: '检查 summary' },
    },
    {
      timestamp: '2026-06-26T01:00:01.000Z',
      type: 'response_item',
      payload: {
        type: 'reasoning',
        id: 'rs_1',
        summary: [
          { type: 'summary_text', text: '我会先定位配置来源。' },
          { type: 'summary_text', text: '然后验证日志里是否写入摘要。' },
        ],
        encrypted_content: 'encrypted',
      },
    },
    {
      timestamp: '2026-06-26T01:00:02.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          last_token_usage: {
            input_tokens: 100,
            output_tokens: 20,
            reasoning_output_tokens: 8,
          },
        },
      },
    },
  ].map((line) => JSON.stringify(line)).join('\n');

  const { turns } = runCodexPipeline(summarySample, 'summary.jsonl');
  const thinking = turns[0]!.segs.find((seg) => seg.k === 'm' && seg.det.think);

  assert.equal(thinking?.det.think, '我会先定位配置来源。\n\n然后验证日志里是否写入摘要。');
  assert.equal(thinking?.det.thinkTok, 8);
});

test('keeps unmatched Codex tool calls visible with a missing-result marker', () => {
  const missingResultSample = [
    {
      timestamp: '2026-06-26T01:00:00.000Z',
      type: 'event_msg',
      payload: { type: 'task_started', turn_id: 'turn_1' },
    },
    {
      timestamp: '2026-06-26T01:00:00.100Z',
      type: 'turn_context',
      payload: { turn_id: 'turn_1', model: 'gpt-5.5' },
    },
    {
      timestamp: '2026-06-26T01:00:00.200Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: '跑一个命令' },
    },
    {
      timestamp: '2026-06-26T01:00:01.000Z',
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'exec_command',
        arguments: '{"cmd":"false"}',
        call_id: 'call_missing',
      },
    },
    {
      timestamp: '2026-06-26T01:00:02.000Z',
      type: 'event_msg',
      payload: { type: 'turn_aborted', turn_id: 'turn_1', reason: 'interrupted', duration_ms: 2000 },
    },
  ].map((line) => JSON.stringify(line)).join('\n');

  const { turns } = runCodexPipeline(missingResultSample, 'missing.jsonl');
  const toolStep = turns[0]!.segs.find((seg) => seg.k === 't' && seg.n === 'exec_command');

  assert.match(toolStep?.det.result ?? '', /未发现匹配的 Codex 工具结果/);
  assert.equal(toolStep?.det.isError, true);
});

test('marks Codex turns that only have token usage but no readable events', () => {
  const tokenOnlySample = [
    {
      timestamp: '2026-06-26T01:00:00.000Z',
      type: 'event_msg',
      payload: { type: 'task_started', turn_id: 'turn_1' },
    },
    {
      timestamp: '2026-06-26T01:00:00.100Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: '只记录了 token' },
    },
    {
      timestamp: '2026-06-26T01:00:01.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          last_token_usage: { input_tokens: 200, cached_input_tokens: 50, output_tokens: 10 },
          model_context_window: 1000,
        },
      },
    },
    {
      timestamp: '2026-06-26T01:00:02.000Z',
      type: 'event_msg',
      payload: { type: 'task_complete', turn_id: 'turn_1', duration_ms: 2000 },
    },
  ].map((line) => JSON.stringify(line)).join('\n');

  const { turns } = runCodexPipeline(tokenOnlySample, 'token-only.jsonl');

  assert.equal(turns[0]!.asstReqs, 1);
  assert.equal(turns[0]!.segs.length, 1);
  assert.match(turns[0]!.segs[0]!.det.text ?? '', /Codex 日志记录了 token_count/);
  assert.equal(turns[0]!.segs[0]!.det.inTok, 200);
  assert.equal(turns[0]!.segs[0]!.det.outTok, 10);
});

test('shows Codex compaction events in step details', () => {
  const compactedSample = [
    {
      timestamp: '2026-06-26T01:00:00.000Z',
      type: 'event_msg',
      payload: { type: 'task_started', turn_id: 'turn_1' },
    },
    {
      timestamp: '2026-06-26T01:00:00.100Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: '继续' },
    },
    {
      timestamp: '2026-06-26T01:00:01.000Z',
      type: 'event_msg',
      payload: { type: 'agent_message', message: '压缩前回复', phase: 'commentary' },
    },
    {
      timestamp: '2026-06-26T01:00:02.000Z',
      type: 'compacted',
      payload: { message: '', window_number: 1 },
    },
    {
      timestamp: '2026-06-26T01:00:02.010Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: { last_token_usage: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, total_tokens: 16000 } },
      },
    },
    {
      timestamp: '2026-06-26T01:00:02.020Z',
      type: 'event_msg',
      payload: { type: 'context_compacted' },
    },
    {
      timestamp: '2026-06-26T01:00:03.000Z',
      type: 'event_msg',
      payload: { type: 'agent_message', message: '压缩后继续', phase: 'commentary' },
    },
    {
      timestamp: '2026-06-26T01:00:04.000Z',
      type: 'event_msg',
      payload: { type: 'task_complete', turn_id: 'turn_1', duration_ms: 4000 },
    },
  ].map((line) => JSON.stringify(line)).join('\n');

  const { turns } = runCodexPipeline(compactedSample, 'compacted.jsonl');
  const compactedStep = turns[0]!.segs.find((seg) => seg.k === 'i' && seg.n === '上下文压缩');

  assert.equal(compactedStep?.det.text, 'Codex 在本轮执行中触发上下文压缩，后续步骤基于压缩后的新窗口继续。');
  assert.equal(turns[0]!.compressionReset, true);
});

test('marks Codex turns that have no readable assistant events at all', () => {
  const emptyTurnSample = [
    {
      timestamp: '2026-06-26T01:00:00.000Z',
      type: 'event_msg',
      payload: { type: 'task_started', turn_id: 'turn_1' },
    },
    {
      timestamp: '2026-06-26T01:00:00.100Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: '继续' },
    },
    {
      timestamp: '2026-06-26T01:00:02.000Z',
      type: 'event_msg',
      payload: { type: 'task_complete', turn_id: 'turn_1', duration_ms: 2000 },
    },
  ].map((line) => JSON.stringify(line)).join('\n');

  const { turns } = runCodexPipeline(emptyTurnSample, 'empty-turn.jsonl');

  assert.equal(turns[0]!.asstReqs, 0);
  assert.equal(turns[0]!.segs.length, 1);
  assert.match(turns[0]!.segs[0]!.det.text ?? '', /未记录可读的 assistant 事件/);
});

test('fills missing Codex core categories from normalized calibration constants', () => {
  const sample = [
    {
      timestamp: '2026-06-26T01:00:00.000Z',
      type: 'session_meta',
      payload: {
        session_id: 'sess_1',
        cwd: '/repo',
        cli_version: '0.99.0',
      },
    },
    {
      timestamp: '2026-06-26T01:00:01.000Z',
      type: 'event_msg',
      payload: { type: 'task_started', turn_id: 'turn_1' },
    },
    {
      timestamp: '2026-06-26T01:00:01.100Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: '检查 Codex 常量' },
    },
    {
      timestamp: '2026-06-26T01:00:02.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          last_token_usage: { input_tokens: 500, output_tokens: 20 },
        },
      },
    },
  ].map((line) => JSON.stringify(line)).join('\n');

  const { turns } = runCodexPipeline(sample, 'metadata.jsonl', {
    schemaVersion: 1,
    source: 'codex',
    categories: {
      sysPrompt: { chars: 30 },
      tool_defs: { chars: 60 },
      skills: { chars: 90 },
      mcp: { chars: 120 },
      reminders: { chars: 150 },
    },
  });

  const turn = turns[0]!;
  assert.ok((turn.comp.sysPrompt ?? 0) > 0);
  assert.ok((turn.comp.tool_defs ?? 0) > 0);
  assert.ok((turn.comp.skills ?? 0) > 0);
  assert.ok((turn.comp.mcp ?? 0) > 0);
  assert.ok((turn.comp.reminders ?? 0) > 0);
});
