#!/usr/bin/env node
/**
 * scripts/tauri-build.mjs — Tauri 构建前置脚本。
 *
 * 1. 下载便携 Node.js 到 src-tauri/binaries/
 * 2. esbuild 打包 server TS → dist-server/server.js
 * 3. 安装生产依赖到 dist-server/（仅 better-sqlite3 等原生模块）
 */

import { spawnSync } from 'child_process';
import { cp, mkdir, rm, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST_SERVER = join(ROOT, 'dist-server');

// Step 1: 下载 Node.js 二进制
console.log('[tauri-build] 下载便携 Node.js...');
spawnSync('node', ['scripts/bundle-node.mjs'], { cwd: ROOT, stdio: 'inherit' });

// Step 2: 清理
if (existsSync(DIST_SERVER)) await rm(DIST_SERVER, { recursive: true });
await mkdir(DIST_SERVER, { recursive: true });

// Step 3: esbuild 打包 server TypeScript → 单个 JS 文件
// 只打包应用层代码（server/ + src/ + shared/），node_modules 全部外部保留
console.log('[tauri-build] esbuild 打包 server...');
await esbuild.build({
  entryPoints: [join(ROOT, 'server', 'index.ts')],
  outfile: join(DIST_SERVER, 'server.js'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  external: ['better-sqlite3'],
  packages: 'external',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
});
console.log('[tauri-build] server.js 打包完成');

// Step 4: 生成最小 package.json（只含生产依赖）
const rootPkg = JSON.parse(
  await (await import('fs/promises')).readFile(join(ROOT, 'package.json'), 'utf-8')
);

// 只保留 server 运行时需要的依赖
const serverDeps = ['better-sqlite3', 'express', 'dotenv', 'zod', 'zod-to-json-schema',
  '@anthropic-ai/claude-agent-sdk'];
const deps = {};
for (const name of serverDeps) {
  if (rootPkg.dependencies[name]) deps[name] = rootPkg.dependencies[name];
}

await writeFile(
  join(DIST_SERVER, 'package.json'),
  JSON.stringify({ name: 'llm-context-viz-server', type: 'module', dependencies: deps }, null, 2)
);

// Step 5: 安装生产依赖（仅 better-sqlite3 等原生模块）
console.log('[tauri-build] 安装生产依赖...');
spawnSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], {
  cwd: DIST_SERVER,
  stdio: 'inherit',
});

// 不复制 .env — 生产环境 API key 由用户自行配置，防止泄露
// CJS 脚本（校准代理需要）
await mkdir(join(DIST_SERVER, 'scripts'), { recursive: true });
for (const f of ['calibration-proxy-utils.cjs', 'calibration-proxy.cjs']) {
  const src = join(ROOT, 'scripts', f);
  if (existsSync(src)) await cp(src, join(DIST_SERVER, 'scripts', f));
}

console.log('[tauri-build] dist-server 构建完成');
