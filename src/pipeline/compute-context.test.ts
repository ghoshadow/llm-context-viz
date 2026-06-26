import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TurnGroup } from '../types/session';
import {
  computeContext,
  loadCalibratedConstants,
  resetCalibratedConstants,
} from './compute-context';

const estimator = { estimate: (text: string) => text.length };

function group(cwd: string): TurnGroup {
  return {
    turnIndex: 1,
    userLine: {
      type: 'user',
      uuid: 'u1',
      timestamp: '2026-06-26T00:00:00.000Z',
      sessionId: 's1',
      cwd,
      message: { role: 'user', content: 'hi' },
    },
    asstLines: [],
    systemLines: [],
    toolResultLines: [],
    startTs: '2026-06-26T00:00:00.000Z',
    endTs: '2026-06-26T00:00:00.000Z',
  };
}

test('loads project constants and resets when missing for next project', () => {
  const projectA = mkdtempSync(join(tmpdir(), 'cal-project-a-'));
  const projectB = mkdtempSync(join(tmpdir(), 'cal-project-b-'));
  try {
    loadCalibratedConstants({
      SYS_PROMPT_FALLBACK_CHARS: 111,
      TOOL_DEFS_FALLBACK_CHARS: 222,
      SYSTEM_REMINDER_CHROME_CHARS: 333,
    });

    const a = computeContext([group(projectA)], estimator)[0]!;
    assert.equal(a.sysPrompt, 111);
    assert.equal(a.tool_defs, 222);
    assert.equal(a.userMsgs, 333 + 2);

    loadCalibratedConstants(null);
    const b = computeContext([group(projectB)], estimator)[0]!;
    assert.equal(b.sysPrompt, 5768);
    assert.equal(b.tool_defs, 98949);
    assert.equal(b.userMsgs, 612 + 2);
  } finally {
    resetCalibratedConstants();
    rmSync(projectA, { recursive: true, force: true });
    rmSync(projectB, { recursive: true, force: true });
  }
});
