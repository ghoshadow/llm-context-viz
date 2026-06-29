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
      plugin: normalized || 'plugin',
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

function decodeEntity(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function parseCommandMessageSegments(text: string): ParsedCommandMessageSegment[] {
  const pattern = /<command-message>([\s\S]*?)<\/command-message>\s*<command-name>([\s\S]*?)<\/command-name>\s*<command-args>([\s\S]*?)<\/command-args>/g;
  const segments: ParsedCommandMessageSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', text: text.slice(lastIndex, match.index) });
    }

    segments.push({
      type: 'command',
      message: decodeEntity(match[1] ?? '').trim(),
      name: decodeEntity(match[2] ?? '').trim(),
      args: decodeEntity(match[3] ?? '').trim(),
      raw: match[0],
    });
    lastIndex = match.index + match[0].length;
  }

  if (segments.length === 0) return [{ type: 'text', text }];
  if (lastIndex < text.length) segments.push({ type: 'text', text: text.slice(lastIndex) });
  return segments;
}

export function hasCommandMessage(text: string): boolean {
  return /<command-message>[\s\S]*?<\/command-message>\s*<command-name>[\s\S]*?<\/command-name>\s*<command-args>[\s\S]*?<\/command-args>/.test(text);
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
    displayName: `/${parts.plugin}:${parts.command}`,
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
