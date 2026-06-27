import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import type { CalibrationUsage, NormalizedCalibrationSummary } from './calibration-types';

type JsonObject = Record<string, any>;

export interface ExtractedCodexConstants {
  source: 'codex';
  sourceFile: string;
  cliVersion: string;
  model: string;
  wireApi: 'responses';
  instructionsChars: number;
  toolsChars: number;
  developerChars: number;
  runtimeChars: number;
  skillsChars: number;
  pluginsChars: number;
  summary: NormalizedCalibrationSummary;
  details?: Record<string, string>;
}

export function extractCodexConstants(logPath: string): ExtractedCodexConstants | null {
  const raw = readFileSync(logPath, 'utf-8');
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let entry: JsonObject;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.request?.method !== 'POST') continue;
    const url = String(entry.request?.url || entry.request?.upstream_url || '');
    if (!url.includes('/responses')) continue;
    const body = entry.request?.body;
    if (!body || typeof body !== 'object') continue;
    if (typeof body.instructions !== 'string' || !Array.isArray(body.input)) continue;

    const instructions = body.instructions;
    const tools = Array.isArray(body.tools) ? body.tools : [];
    const toolsJsonCompact = JSON.stringify(tools);
    const toolsJsonPretty = JSON.stringify(tools, null, 2);
    const developer = classifyDeveloperInput(body.input);
    const usage = parseResponsesSseUsage(entry.response?.body);
    const toolNames = tools
      .map((tool: any) => typeof tool?.name === 'string' ? tool.name : typeof tool?.function?.name === 'string' ? tool.function.name : '')
      .filter(Boolean)
      .sort();
    const cliVersion = parseCodexVersion(entry.request?.headers?.['user-agent']);

    return {
      source: 'codex',
      sourceFile: logPath.split('/').pop() || logPath,
      cliVersion,
      model: typeof body.model === 'string' ? body.model : 'unknown',
      wireApi: 'responses',
      instructionsChars: instructions.length,
      toolsChars: toolsJsonCompact.length,
      developerChars: developer.total,
      runtimeChars: developer.runtime,
      skillsChars: developer.skills,
      pluginsChars: developer.plugins,
      summary: {
        categories: {
          sysPrompt: { chars: instructions.length, detailKey: 'codex.instructions', origin: 'capture' },
          tool_defs: { chars: toolsJsonCompact.length, detailKey: 'codex.tools', origin: 'capture' },
          reminders: { chars: developer.runtime, detailKey: 'codex.runtime', origin: 'capture' },
          skills: { chars: developer.skills, detailKey: 'codex.skills', origin: 'capture' },
          mcp: { chars: developer.plugins, detailKey: 'codex.plugins', origin: 'capture' },
        },
        usage,
        toolNames,
        hashes: {
          instructions: sha256(instructions),
          tools: sha256(toolsJsonCompact),
        },
      },
      details: {
        'codex.instructions': ['# codex.instructions', '', `字符数: ${instructions.length}`, '', instructions].join('\n'),
        'codex.tools': ['# codex.tools', '', `字符数: ${toolsJsonCompact.length}`, '', '```json', toolsJsonPretty, '```'].join('\n'),
        'codex.runtime': ['# codex.runtime', '', `字符数: ${developer.runtime}`, '', developer.runtimeText].join('\n'),
        'codex.skills': ['# codex.skills', '', `字符数: ${developer.skills}`, '', developer.skillsText].join('\n'),
        'codex.plugins': ['# codex.plugins', '', `字符数: ${developer.plugins}`, '', developer.pluginsText].join('\n'),
      },
    };
  }
  return null;
}

export function parseResponsesSseUsage(body: unknown): CalibrationUsage {
  const text = typeof body === 'string' ? body : JSON.stringify(body ?? '');
  let usage: any = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const parsed = JSON.parse(payload);
      usage = parsed.response?.usage || parsed.usage || usage;
    } catch {
      continue;
    }
  }
  return {
    firstRequestInputTokens: numberOrUndefined(usage?.input_tokens),
    firstRequestCachedTokens: numberOrUndefined(usage?.input_tokens_details?.cached_tokens ?? usage?.cached_input_tokens),
    firstRequestOutputTokens: numberOrUndefined(usage?.output_tokens),
    firstRequestReasoningTokens: numberOrUndefined(usage?.output_tokens_details?.reasoning_tokens ?? usage?.reasoning_output_tokens),
  };
}

function classifyDeveloperInput(input: unknown[]): {
  total: number;
  runtime: number;
  skills: number;
  plugins: number;
  runtimeText: string;
  skillsText: string;
  pluginsText: string;
} {
  const parts = { runtime: [] as string[], skills: [] as string[], plugins: [] as string[] };
  for (const item of input) {
    if (!isObject(item)) continue;
    if (item?.role !== 'developer') continue;
    for (const text of contentTexts(item.content)) {
      if (text.includes('<skills_instructions>')) parts.skills.push(text);
      else if (text.includes('<plugins_instructions>')) parts.plugins.push(text);
      else parts.runtime.push(text);
    }
  }
  const runtimeText = parts.runtime.join('\n\n');
  const skillsText = parts.skills.join('\n\n');
  const pluginsText = parts.plugins.join('\n\n');
  return {
    total: runtimeText.length + skillsText.length + pluginsText.length,
    runtime: runtimeText.length,
    skills: skillsText.length,
    plugins: pluginsText.length,
    runtimeText,
    skillsText,
    pluginsText,
  };
}

function contentTexts(content: unknown): string[] {
  if (typeof content === 'string') return [content];
  if (!Array.isArray(content)) return [];
  return content
    .map((block: any) => typeof block?.text === 'string' ? block.text : '')
    .filter(Boolean);
}

function parseCodexVersion(userAgent: unknown): string {
  const text = String(userAgent || '');
  return text.match(/codex(?:-cli)?\/([\d.]+)/)?.[1] || 'unknown';
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
