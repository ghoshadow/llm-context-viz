import React from 'react';

// ---------------------------------------------------------------------------
// Inline Markdown Renderer
// Handles: **bold**, `code`, [links](url)
// ---------------------------------------------------------------------------

export function renderInlineMarkdown(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${match.index}`;

    if (token.startsWith('**')) {
      nodes.push(
        <strong key={key} style={{ color: 'oklch(0.90 0.01 265)', fontWeight: 650 }}>
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith('`')) {
      nodes.push(
        <code
          key={key}
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: '0.92em',
            color: 'oklch(0.84 0.10 165)',
            background: 'oklch(0.24 0.012 265)',
            borderRadius: 4,
            padding: '1px 4px',
          }}
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      const linkMatch = token.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
      if (linkMatch) {
        nodes.push(
          <a
            key={key}
            href={linkMatch[2]}
            target="_blank"
            rel="noreferrer"
            style={{ color: 'oklch(0.78 0.12 165)', textDecoration: 'none' }}
          >
            {linkMatch[1]}
          </a>,
        );
      }
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}
