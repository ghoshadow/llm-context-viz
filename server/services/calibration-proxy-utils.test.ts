import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { buildSourceChildArgs, resolveSourceCliCommand } = require('../../scripts/calibration-proxy-utils.cjs') as {
  buildSourceChildArgs: (source: string, options: {
    captureMode: string;
    proxyUrl: string;
    cwd: string;
    promptArgs: string[];
  }) => string[];
  resolveSourceCliCommand: (source: string, env?: NodeJS.ProcessEnv) => { cliPath: string; prefixArgs: string[] };
};

test('builds source-specific calibration CLI args', () => {
  const base = { captureMode: 'connect', proxyUrl: 'http://127.0.0.1:18443', cwd: '/repo', promptArgs: ['probe'] };

  assert.deepEqual(buildSourceChildArgs('claude', { ...base, promptArgs: ['-p', 'probe'] }), ['-p', 'probe']);
  assert.deepEqual(buildSourceChildArgs('codex', base), [
    'exec', '--json', '--skip-git-repo-check',
    '-c', 'model_providers.OpenAI.base_url="http://127.0.0.1:18443"',
    '-s', 'read-only', '-C', '/repo',
    'probe',
  ]);
  assert.deepEqual(buildSourceChildArgs('opencode', base), ['run', '--format', 'json', 'probe']);
  assert.deepEqual(buildSourceChildArgs('pi', base), ['--no-session', '--mode', 'json', '-p', 'probe']);
  assert.deepEqual(buildSourceChildArgs('openclaw', base), ['agent', '--local', '--json', '--agent', 'main', '--message', 'probe']);
});

test('builds OpenClaw args with profile inferred from profile workspace cwd', () => {
  assert.deepEqual(
    buildSourceChildArgs('openclaw', {
      captureMode: 'connect',
      proxyUrl: 'http://127.0.0.1:18443',
      cwd: '/Users/link/.openclaw-autoclaw/workspace',
      promptArgs: ['probe'],
    }),
    ['--profile', 'autoclaw', 'agent', '--local', '--json', '--agent', 'main', '--message', 'probe'],
  );
});

test('bundled OpenClaw command loads the plugin SDK resolver', () => {
  const command = resolveSourceCliCommand('openclaw', { PATH: '' });

  assert.equal(command.cliPath, '/Applications/AutoClaw.app/Contents/Resources/node/node');
  assert.equal(command.prefixArgs[0], '--loader');
  assert.match(command.prefixArgs[1], /openclaw-plugin-sdk-loader\.mjs$/);
  assert.equal(command.prefixArgs[2], '/Applications/AutoClaw.app/Contents/Resources/gateway/openclaw/openclaw.mjs');
});
