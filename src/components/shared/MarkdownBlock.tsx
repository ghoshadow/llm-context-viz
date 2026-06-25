import React from 'react';
import { Light as SyntaxHighlighter } from 'react-syntax-highlighter';
import { atomOneDark } from 'react-syntax-highlighter/dist/esm/styles/hljs';
import js from 'react-syntax-highlighter/dist/esm/languages/hljs/javascript';
import ts from 'react-syntax-highlighter/dist/esm/languages/hljs/typescript';
import py from 'react-syntax-highlighter/dist/esm/languages/hljs/python';
import bash from 'react-syntax-highlighter/dist/esm/languages/hljs/bash';
import json from 'react-syntax-highlighter/dist/esm/languages/hljs/json';
import css from 'react-syntax-highlighter/dist/esm/languages/hljs/css';
import xml from 'react-syntax-highlighter/dist/esm/languages/hljs/xml';
import sql from 'react-syntax-highlighter/dist/esm/languages/hljs/sql';
import yaml from 'react-syntax-highlighter/dist/esm/languages/hljs/yaml';
import md from 'react-syntax-highlighter/dist/esm/languages/hljs/markdown';
import sh from 'react-syntax-highlighter/dist/esm/languages/hljs/shell';
import diff from 'react-syntax-highlighter/dist/esm/languages/hljs/diff';
import { SEMANTIC } from '../../styles/theme';

SyntaxHighlighter.registerLanguage('javascript', js);
SyntaxHighlighter.registerLanguage('js', js);
SyntaxHighlighter.registerLanguage('typescript', ts);
SyntaxHighlighter.registerLanguage('ts', ts);
SyntaxHighlighter.registerLanguage('python', py);
SyntaxHighlighter.registerLanguage('py', py);
SyntaxHighlighter.registerLanguage('bash', bash);
SyntaxHighlighter.registerLanguage('sh', sh);
SyntaxHighlighter.registerLanguage('shell', sh);
SyntaxHighlighter.registerLanguage('json', json);
SyntaxHighlighter.registerLanguage('css', css);
SyntaxHighlighter.registerLanguage('html', xml);
SyntaxHighlighter.registerLanguage('xml', xml);
SyntaxHighlighter.registerLanguage('sql', sql);
SyntaxHighlighter.registerLanguage('yaml', yaml);
SyntaxHighlighter.registerLanguage('yml', yaml);
SyntaxHighlighter.registerLanguage('markdown', md);
SyntaxHighlighter.registerLanguage('md', md);
SyntaxHighlighter.registerLanguage('diff', diff);

// ---------------------------------------------------------------------------
// Inline Markdown Renderer
// Handles: **bold**, `code`, [links](url)
// ---------------------------------------------------------------------------

function renderInlineMarkdown(text: string, keyPrefix: string): React.ReactNode[] {
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

// ---------------------------------------------------------------------------
// Code Block (with syntax highlighting when language is specified)
// ---------------------------------------------------------------------------

const CODE_BLOCK_STYLE: React.CSSProperties = {
  margin: '0 0 10px',
  borderRadius: 8,
  overflowX: 'auto' as const,
  border: '1px solid oklch(0.28 0.012 265)',
  fontSize: 11.5,
  lineHeight: 1.55,
};

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  // If a language is specified, use syntax highlighting.
  if (lang && lang.length > 0) {
    try {
      return (
        <SyntaxHighlighter
          language={lang}
          style={atomOneDark}
          customStyle={{
            margin: '0 0 10px',
            borderRadius: 8,
            border: '1px solid oklch(0.28 0.012 265)',
            fontSize: 11.5,
            lineHeight: 1.55,
            background: 'oklch(0.15 0.008 265)',
          }}
        >
          {code}
        </SyntaxHighlighter>
      );
    } catch {
      // Fallback to plain code block
    }
  }

  // Plain code block — no syntax highlighting.
  return (
    <pre style={{ ...CODE_BLOCK_STYLE, padding: '9px 10px', background: 'oklch(0.15 0.008 265)', color: 'oklch(0.82 0.01 265)', fontFamily: "'IBM Plex Mono', monospace" }}>
      <code>{code}</code>
    </pre>
  );
}

// ---------------------------------------------------------------------------
// MarkdownBlock — block-level Markdown renderer
//
// Supported syntax:
//   - # / ## / ### headings
//   - Blank-line-separated paragraphs
//   - ``` fenced code blocks (with optional language for highlighting)
//   - > blockquotes
//   - Unordered lists (- / *)
//   - Ordered lists (1. / 2.)
//   - Inline: **bold**, `code`, [links](url)
// ---------------------------------------------------------------------------

interface MarkdownBlockProps {
  text: string;
  /** Font size override. Defaults to 12.5px. */
  fontSize?: number;
  /**
   * When true, consecutive non-empty lines are treated as separate lines
   * (joined with \n + whiteSpace: pre-wrap) rather than merged into a
   * markdown paragraph.  Useful for tool results / log output where each
   * line carries independent meaning.
   */
  preserveNewlines?: boolean;
}

export function MarkdownBlock({ text, fontSize = 12.5, preserveNewlines = false }: MarkdownBlockProps) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let paragraph: string[] = [];
  let list: Array<{ ordered: boolean; text: string }> = [];
  let code: string[] | null = null;
  let codeLang = '';
  let codeFence = '';

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const sep = preserveNewlines ? '\n' : ' ';
    const content = paragraph.join(sep).trim();
    if (content) {
      blocks.push(
        <p
          key={`p-${blocks.length}`}
          style={{
            margin: '0 0 10px',
            lineHeight: 1.68,
            ...(preserveNewlines ? { whiteSpace: 'pre-wrap' } : {}),
          }}
        >
          {renderInlineMarkdown(content, `p-${blocks.length}`)}
        </p>,
      );
    }
    paragraph = [];
  };

  const flushList = () => {
    if (list.length === 0) return;
    const ordered = list[0]!.ordered;
    const Tag = ordered ? 'ol' : 'ul';
    blocks.push(
      <Tag key={`list-${blocks.length}`} style={{ margin: '0 0 10px', paddingLeft: 18, lineHeight: 1.6 }}>
        {list.map((item, idx) => (
          <li key={idx} style={{ marginBottom: 5 }}>
            {renderInlineMarkdown(item.text, `li-${blocks.length}-${idx}`)}
          </li>
        ))}
      </Tag>,
    );
    list = [];
  };

  lines.forEach((rawLine) => {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    // Fenced code block (supports 3+ backticks: ```, ````, etc.)
    const fenceMatch = trimmed.match(/^(`{3,})/);
    if (fenceMatch) {
      flushParagraph();
      flushList();
      const fence = fenceMatch[1]!;
      if (code) {
        // Closing fence — must use at least as many backticks as the opening fence
        if (fence.length >= codeFence.length) {
          blocks.push(<CodeBlock key={`code-${blocks.length}`} code={code.join('\n')} lang={codeLang} />);
          code = null;
          codeLang = '';
          codeFence = '';
        } else {
          // Shorter fence inside a code block — include as content
          code.push(rawLine);
        }
      } else {
        // Opening fence — extract language tag
        codeLang = trimmed.slice(fence.length).trim();
        codeFence = fence;
        code = [];
      }
      return;
    }

    if (code) {
      code.push(rawLine);
      return;
    }

    if (!trimmed) {
      flushParagraph();
      flushList();
      return;
    }

    // Headings
    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1]!.length;
      const headingSizes = { 1: 14.5, 2: 13.5, 3: 12.5 };
      const size = headingSizes[level as keyof typeof headingSizes] ?? 12.5;
      blocks.push(
        <div
          key={`h-${blocks.length}`}
          style={{
            margin: blocks.length === 0 ? '0 0 8px' : '13px 0 8px',
            fontSize: size,
            fontWeight: 700,
            color: 'oklch(0.88 0.01 265)',
          }}
        >
          {renderInlineMarkdown(heading[2]!, `h-${blocks.length}`)}
        </div>,
      );
      return;
    }

    // Blockquote
    const quote = trimmed.match(/^>\s?(.+)$/);
    if (quote) {
      flushParagraph();
      flushList();
      blocks.push(
        <blockquote
          key={`q-${blocks.length}`}
          style={{
            margin: '0 0 10px',
            padding: '5px 0 5px 10px',
            borderLeft: '2px solid oklch(0.45 0.09 165)',
            color: SEMANTIC.textMuted,
            lineHeight: 1.6,
          }}
        >
          {renderInlineMarkdown(quote[1]!, `q-${blocks.length}`)}
        </blockquote>,
      );
      return;
    }

    // Lists
    const unordered = trimmed.match(/^[-*]\s+(.+)$/);
    const ordered = trimmed.match(/^\d+\.\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      const isOrdered = Boolean(ordered);
      if (list.length > 0 && list[0]!.ordered !== isOrdered) flushList();
      list.push({ ordered: isOrdered, text: (unordered?.[1] || ordered?.[1] || '').trim() });
      return;
    }

    flushList();
    paragraph.push(trimmed);
  });

  flushParagraph();
  flushList();

  // Unclosed code block
  const openCode = code as string[] | null;
  if (openCode) {
    blocks.push(<CodeBlock key={`code-${blocks.length}`} code={openCode.join('\n')} lang={codeLang} />);
    codeLang = '';
    codeFence = '';
  }

  return <div style={{ fontSize, color: 'oklch(0.82 0.01 265)' }}>{blocks}</div>;
}

export { renderInlineMarkdown };
