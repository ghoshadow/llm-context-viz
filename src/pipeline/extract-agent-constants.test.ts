import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractOpenCodeConstants } from './extract-opencode-constants';
import { extractOpenClawConstants } from './extract-openclaw-constants';
import { extractPiConstants } from './extract-pi-constants';

function withLog(entry: unknown, fn: (logPath: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'extract-agent-'));
  const logPath = join(dir, 'api-log.jsonl');
  try {
    writeFileSync(logPath, JSON.stringify(entry) + '\n');
    fn(logPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('extracts OpenCode constants from Responses API captures', () => {
  const entry = {
    request: {
      method: 'POST',
      url: 'http://127.0.0.1:9090/responses',
      headers: { 'user-agent': 'opencode/1.2.3' },
      body: {
        model: 'gpt-5.5',
        instructions: 'OpenCode system prompt',
        input: [
          { role: 'developer', content: [{ type: 'input_text', text: '<skills_instructions>skills</skills_instructions>' }] },
          { role: 'developer', content: [{ type: 'input_text', text: '<plugins_instructions>plugins</plugins_instructions>' }] },
          { role: 'developer', content: [{ type: 'input_text', text: '<permissions instructions>runtime</permissions instructions>' }] },
        ],
        tools: [{ type: 'function', name: 'bash' }],
      },
    },
    response: {
      body: 'data: {"response":{"usage":{"input_tokens":111,"output_tokens":22}}}\n\n',
    },
  };

  withLog(entry, (logPath) => {
    const extracted = extractOpenCodeConstants(logPath);
    assert.equal(extracted?.source, 'opencode');
    assert.equal(extracted?.wireApi, 'responses');
    assert.equal(extracted?.cliVersion, '1.2.3');
    assert.equal(extracted?.summary.categories.sysPrompt?.chars, 'OpenCode system prompt'.length);
    assert.equal(extracted?.summary.categories.tool_defs?.chars, JSON.stringify(entry.request.body.tools).length);
    assert.equal(extracted?.summary.categories.skills?.chars, '<skills_instructions>skills</skills_instructions>'.length);
    assert.equal(extracted?.summary.categories.mcp?.chars, '<plugins_instructions>plugins</plugins_instructions>'.length);
    assert.equal(extracted?.summary.categories.reminders?.chars, '<permissions instructions>runtime</permissions instructions>'.length);
    assert.equal(extracted?.summary.usage?.firstRequestInputTokens, 111);
    assert.deepEqual(extracted?.summary.toolNames, ['bash']);
    assert.match(extracted?.details?.['opencode.tools'] ?? '', /"name": "bash"/);
  });
});

test('extracts Pi constants from Chat Completions captures', () => {
  const entry = {
    request: {
      method: 'POST',
      url: 'https://api.openai.com/v1/chat/completions',
      headers: { 'user-agent': 'pi/0.9.0' },
      body: {
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'Pi system prompt' },
          { role: 'developer', content: '<skills_instructions>pi skills</skills_instructions>' },
          { role: 'developer', content: '<plugins_instructions>pi plugins</plugins_instructions>' },
          { role: 'developer', content: '<app-context>pi runtime</app-context>' },
          { role: 'user', content: 'hi' },
        ],
        tools: [{ type: 'function', function: { name: 'read' } }],
      },
    },
    response: {
      body: { usage: { prompt_tokens: 222, completion_tokens: 33 } },
    },
  };

  withLog(entry, (logPath) => {
    const extracted = extractPiConstants(logPath);
    assert.equal(extracted?.source, 'pi');
    assert.equal(extracted?.wireApi, 'chat.completions');
    assert.equal(extracted?.cliVersion, '0.9.0');
    assert.equal(extracted?.summary.categories.sysPrompt?.chars, 'Pi system prompt'.length);
    assert.equal(extracted?.summary.categories.tool_defs?.chars, JSON.stringify(entry.request.body.tools).length);
    assert.equal(extracted?.summary.categories.skills?.chars, '<skills_instructions>pi skills</skills_instructions>'.length);
    assert.equal(extracted?.summary.categories.mcp?.chars, '<plugins_instructions>pi plugins</plugins_instructions>'.length);
    assert.equal(extracted?.summary.categories.reminders?.chars, '<app-context>pi runtime</app-context>'.length);
    assert.equal(extracted?.summary.usage?.firstRequestInputTokens, 222);
    assert.deepEqual(extracted?.summary.toolNames, ['read']);
  });
});

test('extracts OpenClaw constants from Anthropic Messages captures without changing source', () => {
  const entry = {
    request: {
      method: 'POST',
      url: 'https://api.anthropic.com/v1/messages',
      headers: { 'user-agent': 'openclaw/5.0.0' },
      body: {
        model: 'claude-sonnet-4',
        system: [{ text: 'OpenClaw system prompt' }],
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        tools: [{ name: 'grep', input_schema: { type: 'object' } }],
      },
    },
    response: {
      body: { usage: { input_tokens: 333, output_tokens: 44 } },
    },
  };

  withLog(entry, (logPath) => {
    const extracted = extractOpenClawConstants(logPath);
    assert.equal(extracted?.source, 'openclaw');
    assert.equal(extracted?.wireApi, 'anthropic.messages');
    assert.equal(extracted?.cliVersion, '5.0.0');
    assert.equal(extracted?.summary.categories.sysPrompt?.chars, 'OpenClaw system prompt'.length);
    assert.equal(extracted?.summary.categories.tool_defs?.chars, JSON.stringify(entry.request.body.tools).length);
    assert.equal(extracted?.summary.usage?.firstRequestInputTokens, 333);
    assert.deepEqual(extracted?.summary.toolNames, ['grep']);
  });
});
