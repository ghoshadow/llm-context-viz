import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

interface ParsedCodexProvider {
  baseUrl?: string;
}

interface ParsedCodexConfig {
  modelProvider?: string;
  modelProviders: Record<string, ParsedCodexProvider>;
}

export function resolveCodexConfigPath(home = homedir()): string {
  return join(home, '.codex', 'config.toml');
}

export function parseCodexConfig(text: string): ParsedCodexConfig {
  const out: ParsedCodexConfig = { modelProviders: {} };
  let section = '';
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const sectionMatch = /^\[([^\]]+)\]$/.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1]!;
      continue;
    }
    const kv = /^([A-Za-z0-9_.-]+)\s*=\s*"([^"]*)"$/.exec(line);
    if (!kv) continue;
    const key = kv[1]!;
    const value = kv[2]!;
    if (!section && key === 'model_provider') {
      out.modelProvider = value;
      continue;
    }
    const providerMatch = /^model_providers\.([A-Za-z0-9_.-]+)$/.exec(section);
    if (providerMatch && key === 'base_url') {
      const provider = providerMatch[1]!;
      out.modelProviders[provider] = { ...out.modelProviders[provider], baseUrl: value };
    }
  }
  return out;
}

export function resolveCodexBaseUrlFromConfigText(text: string): string {
  const parsed = parseCodexConfig(text);
  const active = parsed.modelProvider;
  if (active && parsed.modelProviders[active]?.baseUrl) return parsed.modelProviders[active]!.baseUrl!;
  if (parsed.modelProviders.OpenAI?.baseUrl) return parsed.modelProviders.OpenAI.baseUrl;
  const first = Object.values(parsed.modelProviders).find((provider) => provider.baseUrl);
  if (first?.baseUrl) return first.baseUrl;
  return 'https://api.openai.com/v1';
}

export function readCodexBaseUrl(configPath = resolveCodexConfigPath()): string {
  if (!existsSync(configPath)) return 'https://api.openai.com/v1';
  return resolveCodexBaseUrlFromConfigText(readFileSync(configPath, 'utf-8'));
}
