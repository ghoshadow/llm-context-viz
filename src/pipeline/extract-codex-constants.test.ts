import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractCodexConstants, parseResponsesSseUsage } from './extract-codex-constants';

test('parses usage from Responses API SSE body', () => {
  const usage = parseResponsesSseUsage([
    'event: response.completed',
    'data: {"response":{"usage":{"input_tokens":1200,"input_tokens_details":{"cached_tokens":300},"output_tokens":40,"output_tokens_details":{"reasoning_tokens":12}}}}',
    '',
  ].join('\n'));

  assert.equal(usage.firstRequestInputTokens, 1200);
  assert.equal(usage.firstRequestCachedTokens, 300);
  assert.equal(usage.firstRequestOutputTokens, 40);
  assert.equal(usage.firstRequestReasoningTokens, 12);
});

test('extracts normalized constants from Codex /responses capture', () => {
  const dir = mkdtempSync(join(tmpdir(), 'extract-codex-'));
  const logPath = join(dir, 'codex-api-log.jsonl');
  try {
    const entry = {
      request: {
        method: 'POST',
        url: 'http://127.0.0.1:9090/responses',
        headers: {
          'user-agent': 'codex-cli/0.142.2',
        },
        body: {
          model: 'gpt-5.5',
          instructions: 'You are Codex.',
          input: [
            {
              role: 'developer',
              content: [{ type: 'input_text', text: '<permissions instructions>runtime</permissions instructions>' }],
            },
            {
              role: 'developer',
              content: [{ type: 'input_text', text: '<skills_instructions>skills here</skills_instructions>' }],
            },
            {
              role: 'developer',
              content: [{ type: 'input_text', text: '<plugins_instructions>plugins here</plugins_instructions>' }],
            },
            {
              role: 'user',
              content: [{ type: 'input_text', text: 'hi' }],
            },
          ],
          tools: [{ type: 'function', name: 'exec_command', description: 'Run command' }],
        },
      },
      response: {
        status_code: 200,
        headers: { 'content-type': 'text/event-stream' },
        body: [
          'event: response.completed',
          'data: {"response":{"usage":{"input_tokens":2000,"input_tokens_details":{"cached_tokens":1000},"output_tokens":50,"output_tokens_details":{"reasoning_tokens":20}}}}',
          '',
        ].join('\n'),
      },
    };
    writeFileSync(logPath, JSON.stringify(entry) + '\n');

    const extracted = extractCodexConstants(logPath);

    assert.equal(extracted?.source, 'codex');
    assert.equal(extracted?.wireApi, 'responses');
    assert.equal(extracted?.cliVersion, '0.142.2');
    assert.equal(extracted?.model, 'gpt-5.5');
    assert.equal(extracted?.summary.categories.sysPrompt?.chars, 'You are Codex.'.length);
    assert.equal(extracted?.summary.categories.tool_defs?.chars, JSON.stringify(entry.request.body.tools).length);
    assert.equal(extracted?.summary.categories.reminders?.chars, '<permissions instructions>runtime</permissions instructions>'.length);
    assert.equal(extracted?.summary.categories.skills?.chars, '<skills_instructions>skills here</skills_instructions>'.length);
    assert.equal(extracted?.summary.categories.mcp?.chars, '<plugins_instructions>plugins here</plugins_instructions>'.length);
    assert.equal(extracted?.summary.usage?.firstRequestInputTokens, 2000);
    assert.equal(extracted?.summary.usage?.firstRequestCachedTokens, 1000);
    assert.equal(extracted?.summary.usage?.firstRequestOutputTokens, 50);
    assert.equal(extracted?.summary.usage?.firstRequestReasoningTokens, 20);
    assert.deepEqual(extracted?.summary.toolNames, ['exec_command']);
    assert.match(extracted?.summary.hashes?.instructions ?? '', /^[a-f0-9]{64}$/);
    assert.match(extracted?.details?.['codex.tools'] ?? '', /"name": "exec_command"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
