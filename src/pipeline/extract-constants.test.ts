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
            { text: 'Harness prompt text' },
          ],
          tools: [{ name: 'Read', input_schema: { type: 'object' } }],
          messages: [{
            role: 'user',
            content: [{
              type: 'text',
              text: [
                '<system-reminder>',
                'Intro wrapper',
                'Contents of /Users/link/.claude/CLAUDE.md',
                '',
                'global memory',
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

    assert.ok(extracted?.details);
    assert.match(extracted.details.SYS_PROMPT_FALLBACK_CHARS, /```text/);
    assert.match(extracted.details.SYS_PROMPT_FALLBACK_CHARS, /Harness prompt text/);
    assert.match(extracted.details.TOOL_DEFS_FALLBACK_CHARS, /```json/);
    assert.match(extracted.details.TOOL_DEFS_FALLBACK_CHARS, /"name": "Read"/);
    assert.match(extracted.details.SYSTEM_REMINDER_CHROME_CHARS, /```text/);
    assert.match(extracted.details.SYSTEM_REMINDER_CHROME_CHARS, /Intro wrapper/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
