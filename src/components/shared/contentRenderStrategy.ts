export type ContentRenderKind = 'edit-diff' | 'syntax' | 'markdown' | 'plain';

export interface ContentRenderOptions {
  text: string;
  markdown?: boolean;
  language?: string;
  toolName?: string;
}

export interface ContentRenderDecision {
  kind: ContentRenderKind;
  language?: string;
}

export function isEditToolName(name: string | undefined): boolean {
  return name === 'Edit' || name === 'Write';
}

export function looksLikeCode(text: string): boolean {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return false;

  let numbered = 0;
  let codeIndicators = 0;
  for (const line of lines) {
    if (/^\s*\d+:\s*\S/.test(line)) numbered++;
    if (/\b(import|export|const|let|var|function|class|return|if|for|while|async|await|def|from|require)\b/.test(line)) codeIndicators++;
  }

  const pct = numbered / lines.length;
  const kwPct = codeIndicators / lines.length;
  if (pct >= 0.6) return true;
  if (pct >= 0.3 && codeIndicators >= 2) return true;
  if (kwPct >= 0.3 || codeIndicators >= 5) return true;
  return false;
}

export function looksLikeDiffToolOutput(text: string): boolean {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines.some(l => l.trim().startsWith('diff --git '))) return true;

  return lines.some((line, idx) =>
    /^[+\- ]\|.*\|$/.test(line.trimEnd()) &&
    /^\s?\|[\s\-:|]+\|$/.test((lines[idx + 1] ?? '').trimEnd())
  );
}

export function decideContentRender(options: ContentRenderOptions): ContentRenderDecision {
  if (options.language === 'json' && isEditToolName(options.toolName)) {
    return { kind: 'edit-diff' };
  }

  if (options.language) {
    return { kind: 'syntax', language: options.language };
  }

  if (options.markdown) {
    if (looksLikeDiffToolOutput(options.text)) return { kind: 'markdown' };
    if (looksLikeCode(options.text)) return { kind: 'syntax', language: 'typescript' };
    return { kind: 'markdown' };
  }

  return { kind: 'plain' };
}

export function formatSyntaxBody(text: string, language: string | undefined): string {
  if (language !== 'json') return text;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}
