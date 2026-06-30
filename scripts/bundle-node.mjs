#!/usr/bin/env node
/**
 * scripts/bundle-node.mjs — 下载便携 Node.js 到 src-tauri/binaries/
 *
 * Tauri sidecar: 二进制命名为 node-<target-triple>
 * macOS arm64 → node-aarch64-apple-darwin
 */

import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { chmod, copyFile, readdir, rename, rm } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { pipeline } from 'stream/promises';
import { spawnSync } from 'child_process';
import { get } from 'https';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BINARIES_DIR = join(__dirname, '..', 'src-tauri', 'binaries');

const NODE_VERSION = '22.12.0';
const p = process.platform;
const a = process.arch;
const target = process.env.TAURI_TARGET;

const MAP = {
  'darwin-arm64': { p: 'darwin', a: 'arm64',  triple: 'aarch64-apple-darwin',  ext: 'tar.gz' },
  'darwin-x64':   { p: 'darwin', a: 'x64',    triple: 'x86_64-apple-darwin',   ext: 'tar.gz' },
  'linux-x64':    { p: 'linux',  a: 'x64',    triple: 'x86_64-unknown-linux-gnu', ext: 'tar.gz' },
  'win32-x64':    { p: 'win',    a: 'x64',    triple: 'x86_64-pc-windows-msvc', ext: 'zip' },
};

const cfg = target ? Object.values(MAP).find((item) => item.triple === target) : MAP[`${p}-${a}`];
if (!cfg) { console.error(`不支持平台: ${target || `${p}-${a}`}`); process.exit(1); }

const BIN_NAME = `node-${cfg.triple}${cfg.ext === 'zip' ? '.exe' : ''}`;
const binPath = join(BINARIES_DIR, BIN_NAME);

if (existsSync(binPath)) { console.log(`[bundle-node] 复用: ${binPath}`); process.exit(0); }

mkdirSync(BINARIES_DIR, { recursive: true });
const url = `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-${cfg.p}-${cfg.a}.${cfg.ext}`;
const tmp = join(BINARIES_DIR, `node-tmp.${cfg.ext}`);

console.log(`[bundle-node] 下载 ${url}`);
await downloadFile(url, tmp);

if (cfg.ext === 'tar.gz') {
  const extractDir = join(BINARIES_DIR, 'node-extract');
  mkdirSync(extractDir, { recursive: true });
  spawnSync('tar', ['-xzf', tmp, '-C', extractDir], { stdio: 'inherit' });
  const entries = await readdir(extractDir);
  const top = entries.find(e => e.startsWith('node-'));
  if (!top) throw new Error('tar 中未找到 node 目录');
  await copyFile(join(extractDir, top, 'bin', 'node'), binPath);
  await chmod(binPath, 0o755);
  await rm(extractDir, { recursive: true });
} else {
  // Windows: use unzip
  spawnSync('unzip', [tmp, '-d', BINARIES_DIR], { stdio: 'inherit' });
  const entries = await readdir(BINARIES_DIR);
  const top = entries.find(e => e.startsWith('node-'));
  if (!top) throw new Error('zip 中未找到 node 目录');
  await rename(join(BINARIES_DIR, top, 'node.exe'), binPath);
  await rm(join(BINARIES_DIR, top), { recursive: true });
}

await rm(tmp);
console.log(`[bundle-node] → ${binPath}`);

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    get(url, (res) => {
      if (res.statusCode >= 300 && res.headers.location)
        return downloadFile(res.headers.location, dest).then(resolve, reject);
      pipeline(res, createWriteStream(dest)).then(resolve, reject);
    }).on('error', reject);
  });
}
