import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import type { AgentSource, CalibrationUsage, NormalizedCalibrationSummary } from './calibration-types';

type JsonObject = Record<string, unknown>;
export type AgentWireApi = 'responses' | 'chat.completions' | 'anthropic.messages';

export interface ExtractedAgentWireConstants {
  source: AgentSource;
  sourceFile: string;
  cliVersion: string;
  model: string;
  wireApi: AgentWireApi;
  summary: NormalizedCalibrationSummary;
  details?: Record<string, string>;
}

interface ProxyLogEntry {
  request?: {
    method?: string;
    url?: string;
    upstream_url?: string;
    body?: JsonObject;
    headers?: JsonObject;
  };
  response?: {
    body?: unknown;
  };
}

interface ExtractOptions {
  source: AgentSource;
  detailPrefix: string;
}

interface DeveloperParts {
  reminders: string;
  skills: string;
  mcp: string;
}

export function extractAgentWireConstants(logPath: string, options: ExtractOptions): ExtractedAgentWireConstants | null {
  const raw = readFileSync(logPath, 'utf-8');
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let entry: ProxyLogEntry;
    try { entry = JSON.parse(line) as ProxyLogEntry; } catch { continue; }
    if (entry.request?.method !== 'POST') continue;
    const body = entry.request.body;
    if (!isObject(body)) continue;

    const url = String(entry.request.url || entry.request.upstream_url || '');
    const extracted = extractBody(body, url);
    if (!extracted) continue;

    const tools = Array.isArray(body.tools) ? body.tools : [];
    const toolsJson = JSON.stringify(tools);
    const toolsPretty = JSON.stringify(tools, null, 2);
    const usage = parseUsage(entry.response?.body);
    const toolNames = extractToolNames(tools);
    const prefix = options.detailPrefix;

    return {
      source: options.source,
      sourceFile: logPath.split('/').pop() || logPath,
      cliVersion: parseCliVersion(entry.request.headers?.['user-agent'], options.source),
      model: typeof body.model === 'string' ? body.model : 'unknown',
      wireApi: extracted.wireApi,
      summary: {
        categories: {
          sysPrompt: { chars: extracted.sysPrompt.length, detailKey: `${prefix}.sysPrompt`, origin: 'capture' },
          tool_defs: { chars: toolsJson.length, detailKey: `${prefix}.tools`, origin: 'capture' },
          reminders: { chars: extracted.developer.reminders.length, detailKey: `${prefix}.runtime`, origin: 'capture' },
          skills: { chars: extracted.developer.skills.length, detailKey: `${prefix}.skills`, origin: 'capture' },
          mcp: { chars: extracted.developer.mcp.length, detailKey: `${prefix}.plugins`, origin: 'capture' },
        },
        usage,
        toolNames,
        hashes: {
          sysPrompt: sha256(extracted.sysPrompt),
          tools: sha256(toolsJson),
        },
      },
      details: {
        [`${prefix}.sysPrompt`]: detail(`${prefix}.sysPrompt`, extracted.sysPrompt),
        [`${prefix}.tools`]: [`# ${prefix}.tools`, '', `字符数: ${toolsJson.length}`, '', '```json', toolsPretty, '```'].join('\n'),
        [`${prefix}.runtime`]: detail(`${prefix}.runtime`, extracted.developer.reminders),
        [`${prefix}.skills`]: detail(`${prefix}.skills`, extracted.developer.skills),
        [`${prefix}.plugins`]: detail(`${prefix}.plugins`, extracted.developer.mcp),
      },
    };
  }
  return null;
}

function extractBody(body: JsonObject, url: string): { wireApi: AgentWireApi; sysPrompt: string; developer: DeveloperParts } | null {
  if (typeof body.instructions === 'string' && Array.isArray(body.input)) {
    return { wireApi: 'responses', sysPrompt: body.instructions, developer: classifyMessages(body.input, ['developer']) };
  }
  if (Array.isArray(body.messages) && (url.includes('/chat/completions') || !body.system)) {
    return {
      wireApi: 'chat.completions',
      sysPrompt: messageTexts(body.messages, ['system']).join('\n\n'),
      developer: classifyMessages(body.messages, ['developer']),
    };
  }
  if (body.system != null && Array.isArray(body.messages)) {
    return { wireApi: 'anthropic.messages', sysPrompt: anthropicSystemText(body.system), developer: emptyDeveloperParts() };
  }
  return null;
}

function classifyMessages(items: unknown[], roles: string[]): DeveloperParts {
  const parts = { reminders: [] as string[], skills: [] as string[], mcp: [] as string[] };
  for (const item of items) {
    if (!isObject(item) || !roles.includes(String(item.role || ''))) continue;
    for (const text of contentTexts(item.content)) {
      if (text.includes('<skills_instructions>')) parts.skills.push(text);
      else if (text.includes('<plugins_instructions>') || text.includes('# MCP Server Instructions')) parts.mcp.push(text);
      else parts.reminders.push(text);
    }
  }
  return {
    reminders: parts.reminders.join('\n\n'),
    skills: parts.skills.join('\n\n'),
    mcp: parts.mcp.join('\n\n'),
  };
}

function messageTexts(items: unknown[], roles: string[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    if (!isObject(item) || !roles.includes(String(item.role || ''))) continue;
    out.push(...contentTexts(item.content));
  }
  return out;
}

function anthropicSystemText(system: unknown): string {
  if (typeof system === 'string') return system;
  if (!Array.isArray(system)) return '';
  return system
    .map((block) => isObject(block) && typeof block.text === 'string' ? block.text : '')
    .filter(Boolean)
    .join('\n\n');
}

function contentTexts(content: unknown): string[] {
  if (typeof content === 'string') return [content];
  if (!Array.isArray(content)) return [];
  return content
    .map((block) => {
      if (!isObject(block)) return '';
      if (typeof block.text === 'string') return block.text;
      if (typeof block.content === 'string') return block.content;
      return '';
    })
    .filter(Boolean);
}

function parseUsage(body: unknown): CalibrationUsage {
  const usage = usageObject(body);
  return {
    firstRequestInputTokens: numberOrUndefined(usage?.input_tokens ?? usage?.prompt_tokens),
    firstRequestCachedTokens: numberOrUndefined(
      (usage?.input_tokens_details as JsonObject | undefined)?.cached_tokens
      ?? (usage?.prompt_tokens_details as JsonObject | undefined)?.cached_tokens
      ?? usage?.cached_input_tokens
      ?? usage?.cache_read_input_tokens,
    ),
    firstRequestOutputTokens: numberOrUndefined(usage?.output_tokens ?? usage?.completion_tokens),
    firstRequestReasoningTokens: numberOrUndefined(
      (usage?.output_tokens_details as JsonObject | undefined)?.reasoning_tokens
      ?? (usage?.completion_tokens_details as JsonObject | undefined)?.reasoning_tokens
      ?? usage?.reasoning_output_tokens,
    ),
  };
}

function usageObject(body: unknown): JsonObject | null {
  if (typeof body === 'string') {
    let usage: JsonObject | null = null;
    for (const line of body.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const parsed = JSON.parse(payload);
        const parsedObj = objectValue(parsed);
        usage = objectValue(objectValue(parsedObj?.response)?.usage) || objectValue(parsedObj?.usage) || usage;
      } catch { /* ignore invalid SSE line */ }
    }
    if (usage) return usage;
    try { return usageObject(JSON.parse(body)); } catch { return null; }
  }
  if (!isObject(body)) return null;
  return objectValue(objectValue(body.response)?.usage) || objectValue(body.usage);
}

function extractToolNames(tools: unknown[]): string[] {
  return tools
    .map((tool) => {
      if (!isObject(tool)) return '';
      if (typeof tool.name === 'string') return tool.name;
      const fn = objectValue(tool.function);
      return typeof fn?.name === 'string' ? fn.name : '';
    })
    .filter((name): name is string => name.length > 0)
    .sort();
}

function parseCliVersion(userAgent: unknown, source: AgentSource): string {
  const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return String(userAgent || '').match(new RegExp(`${escaped}(?:-cli)?/([\\w.-]+)`))?.[1] || 'unknown';
}

function detail(key: string, text: string): string {
  return ['# ' + key, '', `字符数: ${text.length}`, '', text].join('\n');
}

function emptyDeveloperParts(): DeveloperParts {
  return { reminders: '', skills: '', mcp: '' };
}

function objectValue(value: unknown): JsonObject | null {
  return isObject(value) ? value : null;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
