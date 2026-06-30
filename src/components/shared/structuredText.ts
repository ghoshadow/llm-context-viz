import {
  getCommandMessagePreview,
  parseCommandMessageSegments,
  type CommandMessageSegment,
  type CommandTextSegment,
} from './commandMessage';

export interface LocalCommandCaveatSegment {
  type: 'local-command-caveat';
  body: string;
  raw: string;
}

export interface PluginReferenceSegment {
  type: 'plugin-reference';
  label: string;
  plugin: string;
  source: string;
  url: string;
  raw: string;
}

export type StructuredTextSegment =
  | CommandMessageSegment
  | CommandTextSegment
  | LocalCommandCaveatSegment
  | PluginReferenceSegment;

export type StructuredTextPreview =
  | { kind: 'command'; label: string; detail: string; tooltip: string; plugin: string }
  | { kind: 'local-command-caveat'; label: string; detail: string; tooltip: string }
  | { kind: 'plugin-reference'; label: string; detail: string; tooltip: string; plugin: string; source: string };

const LOCAL_COMMAND_CAVEAT_LABEL = '本地命令输出提示';
const LOCAL_COMMAND_CAVEAT_DETAIL = '由本地命令生成的消息';

function decodeEntity(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function parseStructuredTextSegments(text: string): StructuredTextSegment[] {
  const commandSegments = parseCommandMessageSegments(text);
  const commandOnly = commandSegments.some((segment) => segment.type === 'command');
  if (commandOnly) return commandSegments;

  const pluginSegments = parsePluginReferenceSegments(text);
  if (pluginSegments.some((segment) => segment.type === 'plugin-reference')) return pluginSegments;

  return parseLocalCommandCaveatSegments(text);
}

function parseLocalCommandCaveatSegments(text: string): StructuredTextSegment[] {
  const pattern = /<local-command-caveat>([\s\S]*?)<\/local-command-caveat>/g;
  const segments: StructuredTextSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', text: text.slice(lastIndex, match.index) });
    }

    segments.push({
      type: 'local-command-caveat',
      body: decodeEntity(match[1] ?? '').trim(),
      raw: match[0],
    });
    lastIndex = match.index + match[0].length;
  }

  if (segments.length === 0) return [{ type: 'text', text }];
  if (lastIndex < text.length) segments.push({ type: 'text', text: text.slice(lastIndex) });
  return segments;
}

export function hasStructuredText(text: string): boolean {
  return getStructuredTextPreview(text) !== null;
}

export function getStructuredTextPreview(text: string): StructuredTextPreview | null {
  const commandPreview = getCommandMessagePreview(text);
  if (commandPreview) {
    return {
      kind: 'command',
      label: commandPreview.displayName,
      detail: commandPreview.args,
      tooltip: [commandPreview.displayName, commandPreview.args].filter(Boolean).join(' · '),
      plugin: commandPreview.plugin,
    };
  }

  const pluginReference = parseLoosePluginReference(text);
  if (pluginReference) {
    return {
      kind: 'plugin-reference',
      label: pluginReference.label,
      detail: pluginReference.source,
      tooltip: [pluginReference.label, pluginReference.source].filter(Boolean).join(' · '),
      plugin: pluginReference.plugin,
      source: pluginReference.source,
    };
  }

  if (/<local-command-caveat>([\s\S]*?)(?:<\/local-command-caveat>|$)/.test(text)) {
    return {
      kind: 'local-command-caveat',
      label: LOCAL_COMMAND_CAVEAT_LABEL,
      detail: LOCAL_COMMAND_CAVEAT_DETAIL,
      tooltip: `${LOCAL_COMMAND_CAVEAT_LABEL} · ${LOCAL_COMMAND_CAVEAT_DETAIL}`,
    };
  }

  return null;
}

function parsePluginReferenceSegments(text: string): StructuredTextSegment[] {
  const pattern = /\[(@[^\]]+)\]\((plugin:\/\/([A-Za-z0-9_-]+)@([A-Za-z0-9._-]+))(?:\)|$)/g;
  const segments: StructuredTextSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', text: text.slice(lastIndex, match.index) });
    }

    segments.push({
      type: 'plugin-reference',
      label: decodeEntity(match[1] ?? '').trim(),
      plugin: decodeEntity(match[3] ?? '').trim(),
      source: decodeEntity(match[4] ?? '').trim(),
      url: decodeEntity(match[2] ?? '').trim(),
      raw: match[0],
    });
    lastIndex = match.index + match[0].length;
  }

  if (segments.length === 0) return [{ type: 'text', text }];
  if (lastIndex < text.length) segments.push({ type: 'text', text: text.slice(lastIndex) });
  return segments;
}

function parseLoosePluginReference(text: string): PluginReferenceSegment | null {
  const match = text.match(/\[(@[^\]]+)\]\((plugin:\/\/([A-Za-z0-9_-]+)@([A-Za-z0-9._-]+))(?:\)|$)/);
  if (!match) return null;

  return {
    type: 'plugin-reference',
    label: decodeEntity(match[1] ?? '').trim(),
    plugin: decodeEntity(match[3] ?? '').trim(),
    source: decodeEntity(match[4] ?? '').trim(),
    url: decodeEntity(match[2] ?? '').trim(),
    raw: match[0],
  };
}
