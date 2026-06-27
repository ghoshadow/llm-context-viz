import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTranslationPrompt } from './translation-prompt';

test('asks flash model to translate prose while preserving only literal technical tokens', () => {
  const prompt = buildTranslationPrompt(['You are a Claude agent. Keep `npm run build`.']);

  assert.match(prompt, /普通英文说明必须翻译为中文/);
  assert.match(prompt, /不要整句或整段保留英文原文/);
  assert.match(prompt, /反引号内代码、命令、URL、文件路径、变量名、API 名称/);
  assert.match(prompt, /\[0\] You are a Claude agent\. Keep `npm run build`\./);
});
