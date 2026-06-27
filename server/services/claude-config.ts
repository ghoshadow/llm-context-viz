import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const DEFAULT_CLAUDE_BASE_URL = 'https://api.deepseek.com/anthropic';

interface ParsedClaudeSettings {
  baseUrl?: string;
}

export function resolveClaudeSettingsPath(home = homedir()): string {
  return join(home, '.claude', 'settings.json');
}

export function parseClaudeSettings(text: string): ParsedClaudeSettings {
  try {
    const parsed = JSON.parse(text);
    const baseUrl = parsed?.env?.ANTHROPIC_BASE_URL;
    return typeof baseUrl === 'string' && baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {};
  } catch {
    return {};
  }
}

export function resolveClaudeBaseUrlFromSettingsText(text: string): string {
  return parseClaudeSettings(text).baseUrl || DEFAULT_CLAUDE_BASE_URL;
}

export function readClaudeBaseUrl(settingsPath = resolveClaudeSettingsPath()): string {
  if (!existsSync(settingsPath)) return DEFAULT_CLAUDE_BASE_URL;
  return resolveClaudeBaseUrlFromSettingsText(readFileSync(settingsPath, 'utf-8'));
}
