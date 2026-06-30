import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, writeFileSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { readModelConfig, writeModelConfig } from './env-file';

const ENV_PATH = join(homedir(), '.llm-context-viz', '.env');

// 保存原始 .env
let originalEnv = '';
try { originalEnv = readFileSync(ENV_PATH, 'utf-8'); } catch {}

function clean() { try { unlinkSync(ENV_PATH); } catch {} }
function ensureDir() { mkdirSync(dirname(ENV_PATH), { recursive: true }); }
function write(content: string) { ensureDir(); writeFileSync(ENV_PATH, content, 'utf-8'); }
function read(): string { return existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf-8') : ''; }

test.after(() => {
  if (originalEnv) { ensureDir(); writeFileSync(ENV_PATH, originalEnv, 'utf-8'); }
  else { clean(); }
});

test('掩码：长 key 显示 sk-...xxxx', () => {
  clean();
  writeModelConfig({ LLM_API_KEY: 'sk-ant-api03-testkey1234', LLM_MODEL: 'claude-sonnet' });
  const cfg = readModelConfig();
  assert.equal(cfg.hasApiKey, true);
  assert.equal(cfg.LLM_API_KEY, 'sk-a...1234');
  assert.equal(cfg.LLM_MODEL, 'claude-sonnet');
});

test('掩码：短 key 显示 ***', () => {
  clean();
  writeModelConfig({ LLM_API_KEY: 'abc123' });
  assert.equal(readModelConfig().LLM_API_KEY, '***');
});

test('掩码：空 key 返回空或掩码形式', () => {
  clean();
  writeModelConfig({ LLM_MODEL: 'test-model' });
  const key = readModelConfig().LLM_API_KEY;
  // 可能因环境变量被设置而为掩码，或为空
  assert.ok(key === '' || key === '***' || key.includes('...'), `非预期值: ${key}`);
});

test('保留注释和未修改字段', () => {
  clean();
  write('# LLM 模型配置\nLLM_MODEL=gpt-5\n# 翻译配置\nTRANSLATION_MODEL=gpt-mini\n');
  writeModelConfig({ LLM_MODEL: 'claude-sonnet' });

  const out = read();
  assert.ok(out.includes('# LLM 模型配置'), `注释丢失: ${out}`);
  assert.ok(out.includes('# 翻译配置'), `注释丢失: ${out}`);
  assert.ok(out.includes('LLM_MODEL=claude-sonnet'), `更新失败: ${out}`);
  assert.ok(out.includes('TRANSLATION_MODEL=gpt-mini'), `未改字段丢失: ${out}`);
});

test('追加缺失字段到末尾', () => {
  clean();
  write('LLM_MODEL=deepseek-v4\n');
  writeModelConfig({ LLM_BASE_URL: 'https://api.openai.com/v1' });

  const out = read();
  assert.ok(out.includes('LLM_MODEL=deepseek-v4'), `原字段丢失: ${out}`);
  assert.ok(out.includes('LLM_BASE_URL=https://api.openai.com/v1'), `新字段缺失: ${out}`);
});

test('writeModelConfig 同步更新 process.env', () => {
  clean();
  writeModelConfig({ LLM_MODEL: 'test-process-env' });
  assert.equal(process.env.LLM_MODEL, 'test-process-env');
});
