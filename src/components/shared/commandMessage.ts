export interface CommandMessageSegment {
  type: 'command';
  message: string;
  name: string;
  args: string;
  raw: string;
}

export interface CommandTextSegment {
  type: 'text';
  text: string;
}

export type ParsedCommandMessageSegment = CommandMessageSegment | CommandTextSegment;

export interface CommandMessagePreview {
  message: string;
  name: string;
  args: string;
  plugin: string;
  command: string;
  displayName: string;
}

export function getCommandParts(name: string): { plugin: string; command: string } {
  const normalized = name.startsWith('/') ? name.slice(1) : name;
  const separatorIndex = normalized.indexOf(':');
  if (separatorIndex === -1) {
    return {
      plugin: '',
      command: normalized || 'command',
    };
  }

  const plugin = normalized.slice(0, separatorIndex);
  const command = normalized.slice(separatorIndex + 1);
  return {
    plugin: plugin || 'plugin',
    command: command || normalized || 'command',
  };
}

export function getCommandDisplayName(name: string): string {
  const parts = getCommandParts(name);
  return parts.plugin ? `/${parts.plugin}:${parts.command}` : `/${parts.command}`;
}

function decodeEntity(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function parseCommandMessageSegments(text: string): ParsedCommandMessageSegment[] {
  const pattern = /<command-(message|name|args)>[\s\S]*?<\/command-\1>(?:\s*<command-(message|name|args)>[\s\S]*?<\/command-\2>)*/g;
  const segments: ParsedCommandMessageSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const command = parseCommandTagBlock(match[0]);
    if (!command) continue;

    if (match.index > lastIndex) {
      segments.push({ type: 'text', text: text.slice(lastIndex, match.index) });
    }

    segments.push(command);
    lastIndex = match.index + match[0].length;
  }

  if (segments.length === 0) return [{ type: 'text', text }];
  if (lastIndex < text.length) segments.push({ type: 'text', text: text.slice(lastIndex) });
  return segments;
}

export function hasCommandMessage(text: string): boolean {
  return parseCommandMessageSegments(text).some((segment) => segment.type === 'command');
}

export function getCommandMessagePreview(text: string): CommandMessagePreview | null {
  const command = parseCommandMessageSegments(text).find((segment) => segment.type === 'command');
  const looseMatch = command || parseLooseCommandMessagePreview(text);
  if (!looseMatch || looseMatch.type !== 'command') return null;

  const name = looseMatch.name || looseMatch.message;
  const parts = getCommandParts(name);

  return {
    message: looseMatch.message,
    name: looseMatch.name,
    args: looseMatch.args,
    plugin: parts.plugin,
    command: parts.command,
    displayName: getCommandDisplayName(name),
  };
}

function parseCommandTagBlock(raw: string): CommandMessageSegment | null {
  const tags = new Map<string, string>();
  const tagPattern = /<command-(message|name|args)>([\s\S]*?)<\/command-\1>/g;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(raw)) !== null) {
    tags.set(match[1] ?? '', decodeEntity(match[2] ?? '').trim());
  }

  const message = tags.get('message') ?? '';
  const name = tags.get('name') ?? '';
  if (!message || !name) return null;

  return {
    type: 'command',
    message,
    name,
    args: tags.get('args') ?? '',
    raw,
  };
}

function parseLooseCommandMessagePreview(text: string): CommandMessageSegment | null {
  const messageMatch = text.match(/<command-message>([\s\S]*?)<\/command-message>/);
  const nameMatch = text.match(/<command-name>([\s\S]*?)<\/command-name>/);
  if (!messageMatch && !nameMatch) return null;

  const message = decodeEntity(messageMatch?.[1] ?? '').trim();
  const name = decodeEntity(nameMatch?.[1] ?? '').trim();
  const argsMatch = text.match(/<command-args>([\s\S]*?)(?:<\/command-args>|$)/);
  const args = decodeEntity(argsMatch?.[1] ?? '').trim();

  if (!message && !name) return null;
  return {
    type: 'command',
    message,
    name,
    args,
    raw: text,
  };
}
