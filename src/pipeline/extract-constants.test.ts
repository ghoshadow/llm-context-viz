import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractConstants } from './extract-constants';

test('extracts markdown-viewable details for calibrated constants', () => {
  const dir = mkdtempSync(join(tmpdir(), 'extract-constants-'));
  const logPath = join(dir, 'api-log.jsonl');
  try {
    const entry = {
      request: {
        method: 'POST',
        headers: { 'user-agent': 'claude-cli/2.1.170' },
        body: {
          model: 'deepseek-v4-pro',
          system: [
            { text: 'billing-header cc_version=2.1.170' },
            { text: 'You are a Claude agent' },
            { text: ['Harness prompt text', '```json', '{"example":true}', '```', 'after fence'].join('\n') },
          ],
          tools: [{ name: 'Read', input_schema: { type: 'object' } }],
          messages: [{
            role: 'user',
            content: [{
              type: 'text',
              text: [
                '<system-reminder>',
                'Intro wrapper',
                '```bash',
                'echo hello',
                '```',
                'Contents of /Users/link/.claude/CLAUDE.md',
                '',
                'global memory',
                'Contents of /Users/link/project/.claude/CLAUDE.md',
                '',
                'project memory',
                '# currentDate',
                '2026-06-26',
                '</system-reminder>',
              ].join('\n'),
            }],
          }],
        },
      },
      response: { body: '{"input_tokens":42}' },
    };
    writeFileSync(logPath, JSON.stringify(entry) + '\n');

    const extracted = extractConstants(logPath);

    assert.equal(extracted?.source, 'claude');
    assert.equal(extracted?.summary.categories.sysPrompt?.chars, extracted?.systemBlocks.total);
    assert.equal(extracted?.summary.categories.tool_defs?.chars, extracted?.toolsChars);
    assert.equal(extracted?.summary.categories.userMsgs?.chars, extracted?.userMessage.chrome);
    assert.equal(extracted?.summary.categories.memoryGlobal?.chars, 'global memory'.length);
    assert.equal(extracted?.summary.categories.memoryProject?.chars, 'project memory'.length);

    assert.ok(extracted?.details);
    const sysPrompt = extracted.details['claude.sysPrompt'];
    const toolDefs = extracted.details['claude.tool_defs'];
    const userMsgs = extracted.details['claude.userMsgs'];
    const memoryGlobal = extracted.details['claude.memory.global'];
    const memoryProject = extracted.details['claude.memory.project'];
    assert.ok(sysPrompt);
    assert.ok(toolDefs);
    assert.ok(userMsgs);
    assert.ok(memoryGlobal);
    assert.ok(memoryProject);
    assert.doesNotMatch(sysPrompt, /```text/);
    assert.match(sysPrompt, /Harness prompt text/);
    assert.match(sysPrompt, /```json\n\{"example":true\}\n```/);
    assert.match(toolDefs, /```json/);
    assert.match(toolDefs, /"name": "Read"/);
    assert.doesNotMatch(userMsgs, /```text/);
    assert.match(userMsgs, /Intro wrapper/);
    assert.match(userMsgs, /```bash\necho hello\n```/);
    assert.match(memoryGlobal, /global memory/);
    assert.match(memoryProject, /project memory/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
