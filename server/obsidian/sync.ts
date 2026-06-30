import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'fs';
import path from 'path';
import type { KnowledgeCardContext } from './card-context';
import { ensureOntologyGraphColorGroups } from './graph-config';
import {
  MANAGED_END,
  MANAGED_START,
  contentHash,
  mergeManagedFrontmatter,
  renderFilename,
  renderFullNoteMarkdown,
  renderManagedFrontmatter,
  renderManagedCardMarkdown,
  topicHash,
} from './markdown';

export interface ObsidianConfig {
  vaultPath: string | null;
  notesDir: string;
  filenameTemplate: string;
}

export interface ObsidianWriteResult {
  relativePath: string;
  hash: string;
  skipped: boolean;
}

type ObsidianConfigValidation =
  | { ok: true; vaultRoot: string; notesDir: string; filenameTemplate: string }
  | { ok: false; error: string };

type ObsidianNotePathResolution =
  | { ok: true; absolutePath: string; vaultRoot: string }
  | { ok: false; error: string };

export const DEFAULT_FILENAME_TEMPLATE = '第{{startTurn}}-{{endTurn}}轮 - {{title}} - {{topicHash}}.md';

export function normalizeFilenameTemplate(template: string | null | undefined): string {
  const value = template && template.trim() ? template.trim() : DEFAULT_FILENAME_TEMPLATE;
  if (/\{\{\s*topicHash\s*\}\}/.test(value)) return value;
  return value.replace(/\.md$/i, ' - {{topicHash}}.md');
}

export function validateConfig(config: ObsidianConfig): ObsidianConfigValidation {
  if (!config.vaultPath || !config.vaultPath.trim()) {
    return { ok: false, error: '尚未配置 Obsidian Vault 路径' };
  }

  const requestedVault = path.resolve(config.vaultPath);
  if (!existsSync(requestedVault)) return { ok: false, error: 'Obsidian Vault 路径不存在' };
  const vaultRoot = realpathSync(requestedVault);
  if (!statSync(vaultRoot).isDirectory()) return { ok: false, error: 'Obsidian Vault 路径不是目录' };
  if (!existsSync(path.join(vaultRoot, '.obsidian')) || !statSync(path.join(vaultRoot, '.obsidian')).isDirectory()) {
    return { ok: false, error: '请选择包含 .obsidian 目录的真实 Obsidian Vault' };
  }

  const notesDir = config.notesDir || 'LLM知识卡片';
  const normalizedNotesDir = path.normalize(notesDir);
  if (
    path.isAbsolute(notesDir)
    || normalizedNotesDir === '.'
    || normalizedNotesDir === '..'
    || normalizedNotesDir.startsWith(`..${path.sep}`)
  ) {
    return { ok: false, error: '笔记目录必须是 Vault 内的相对路径' };
  }

  const filenameTemplate = normalizeFilenameTemplate(config.filenameTemplate);
  return { ok: true, vaultRoot, notesDir: normalizedNotesDir, filenameTemplate };
}

function ensureInside(root: string, target: string): void {
  const resolvedRoot = realpathSync(root);
  const resolvedTarget = existsSync(target) ? realpathSync(target) : path.resolve(target);
  const rel = path.relative(resolvedRoot, resolvedTarget);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('目标路径超出 Obsidian Vault');
  }
}

export function resolveObsidianNotePath(config: ObsidianConfig, relativePath: string): ObsidianNotePathResolution {
  const validation = validateConfig(config);
  if (validation.ok === false) return { ok: false, error: validation.error };
  if (!relativePath || path.isAbsolute(relativePath)) {
    return { ok: false, error: 'Obsidian 笔记路径必须是 Vault 内的相对路径' };
  }

  const absolutePath = path.resolve(validation.vaultRoot, relativePath);
  ensureInside(validation.vaultRoot, absolutePath);
  return { ok: true, absolutePath, vaultRoot: validation.vaultRoot };
}

function ensureExistingParentInside(root: string, target: string): void {
  let current = path.dirname(target);
  while (!existsSync(current) && path.dirname(current) !== current) {
    current = path.dirname(current);
  }
  ensureInside(root, current);
}

function replaceManagedBlock(existing: string, managed: string): string | null {
  const start = existing.indexOf(MANAGED_START);
  const end = existing.indexOf(MANAGED_END);
  if (start === -1 || end === -1 || end < start) return null;

  const before = existing.slice(0, start);
  const after = existing.slice(end + MANAGED_END.length).replace(/^(?:[ \t]*\r?\n)+/, '\n\n');
  return `${before}${managed.trimEnd()}${after.startsWith('\n') ? after : `\n${after}`}`;
}

function isPathInNotesDir(relativePath: string, notesDir: string): boolean {
  const normalizedRelative = path.normalize(relativePath);
  const normalizedNotesDir = path.normalize(notesDir);
  const rel = path.relative(normalizedNotesDir, normalizedRelative);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function writeObsidianCard(params: {
  config: ObsidianConfig;
  sessionId: string;
  topicId: string;
  context: KnowledgeCardContext;
  summary: string | null;
  previousRelativePath?: string | null;
}): ObsidianWriteResult {
  const validation = validateConfig(params.config);
  if (validation.ok === false) throw new Error(validation.error);
  ensureOntologyGraphColorGroups(validation.vaultRoot);

  const syncedAt = new Date().toISOString();
  const notesRoot = path.resolve(validation.vaultRoot, validation.notesDir);
  ensureInside(validation.vaultRoot, notesRoot);
  ensureExistingParentInside(validation.vaultRoot, notesRoot);
  mkdirSync(notesRoot, { recursive: true });
  ensureInside(validation.vaultRoot, notesRoot);

  const baseFilename = renderFilename(
    params.context,
    params.sessionId,
    params.topicId,
    validation.filenameTemplate,
  );
  let absolutePath = path.resolve(notesRoot, baseFilename);
  ensureInside(validation.vaultRoot, absolutePath);

  const fullNote = renderFullNoteMarkdown({ ...params, syncedAt });
  const managed = renderManagedCardMarkdown({ ...params, syncedAt });
  const managedFrontmatter = renderManagedFrontmatter({ ...params, syncedAt });
  let nextContent = fullNote;

  if (params.previousRelativePath && isPathInNotesDir(params.previousRelativePath, validation.notesDir)) {
    const resolvedPrevious = resolveObsidianNotePath(params.config, params.previousRelativePath);
    if (resolvedPrevious.ok === false) throw new Error(resolvedPrevious.error);

    if (existsSync(resolvedPrevious.absolutePath)) {
      const existing = readFileSync(resolvedPrevious.absolutePath, 'utf-8');
      const replaced = replaceManagedBlock(existing, managed);
      if (!replaced) throw new Error('已同步笔记缺少受管理区块，请检查 Obsidian 文件');
      absolutePath = resolvedPrevious.absolutePath;
      nextContent = mergeManagedFrontmatter(replaced, managedFrontmatter);
    }
  }

  if (nextContent === fullNote && existsSync(absolutePath)) {
    const existing = readFileSync(absolutePath, 'utf-8');
    const replaced = replaceManagedBlock(existing, managed);

    if (replaced) {
      nextContent = mergeManagedFrontmatter(replaced, managedFrontmatter);
    } else {
      const parsed = path.parse(baseFilename);
      absolutePath = path.resolve(notesRoot, `${parsed.name}-${topicHash(params.sessionId, params.topicId)}${parsed.ext}`);
      ensureInside(validation.vaultRoot, absolutePath);

      if (existsSync(absolutePath)) {
        const existingAlt = readFileSync(absolutePath, 'utf-8');
        const replacedAlt = replaceManagedBlock(existingAlt, managed);
        if (!replacedAlt) throw new Error('目标文件已存在且不是受管理的知识卡片笔记');
        nextContent = mergeManagedFrontmatter(replacedAlt, managedFrontmatter);
      }
    }
  }

  const hash = contentHash(nextContent);
  if (existsSync(absolutePath) && contentHash(readFileSync(absolutePath, 'utf-8')) === hash) {
    return { relativePath: path.relative(validation.vaultRoot, absolutePath), hash, skipped: true };
  }

  writeFileSync(absolutePath, nextContent, 'utf-8');
  return { relativePath: path.relative(validation.vaultRoot, absolutePath), hash, skipped: false };
}
