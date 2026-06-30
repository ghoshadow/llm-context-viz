import React from 'react';
import { DiffView } from './DiffView';
import { CodeBlock, MarkdownBlock } from './MarkdownBlock';
import { decideContentRender, formatSyntaxBody } from './contentRenderStrategy';

export interface ContentRendererProps {
  text: string;
  fontFamily: string;
  fontSize?: number;
  maxHeight?: number | string;
  overflowY?: 'auto' | 'visible';
  markdown?: boolean;
  language?: string;
  toolName?: string;
  preserveNewlines?: boolean;
  tone?: 'default' | 'warning';
}

export function ContentRenderer({
  text,
  fontFamily,
  fontSize = 12,
  maxHeight = 'none',
  overflowY = 'visible',
  markdown = false,
  language,
  toolName,
  preserveNewlines = false,
  tone = 'default',
}: ContentRendererProps) {
  const decision = decideContentRender({ text, markdown, language, toolName });
  const baseClassName = decision.kind === 'syntax' || decision.kind === 'edit-diff' || decision.kind === 'plain'
    ? 'block-body mono'
    : 'block-body';
  const className = `${baseClassName} thin-scrollbar`;

  const wrapStyle: React.CSSProperties = {
    fontFamily,
    maxHeight,
    overflowY,
  };

  if (decision.kind === 'edit-diff') {
    return (
      <div className={className} style={wrapStyle}>
        <DiffView body={text} />
      </div>
    );
  }

  if (decision.kind === 'syntax') {
    const body = formatSyntaxBody(text, decision.language);
    return (
      <div className={className} style={wrapStyle}>
        <CodeBlock code={body} lang={decision.language ?? ''} />
      </div>
    );
  }

  if (decision.kind === 'markdown') {
    return (
      <div className={className} style={wrapStyle}>
        <MarkdownBlock fontSize={fontSize} text={text} preserveNewlines={preserveNewlines} variant="tool-output" />
      </div>
    );
  }

  return (
    <div
      className={className}
      style={{
        ...wrapStyle,
        ...(tone === 'warning'
          ? {
              padding: '8px 12px',
              borderRadius: 6,
              border: '1px solid oklch(0.50 0.10 60 / 0.25)',
              background: 'oklch(0.50 0.10 60 / 0.05)',
              fontSize,
              lineHeight: 1.6,
              color: 'oklch(0.74 0.13 60)',
            }
          : {}),
      }}
    >
      {text}
    </div>
  );
}
