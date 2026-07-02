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

export function CodeBlock({ code, lang }: { code: string; lang: string }) {
  // If a language is specified, use syntax highlighting.
  if (lang && lang.length > 0) {
    try {
      return (
        <SyntaxHighlighter
          className="thin-scrollbar"
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
    <pre className="thin-scrollbar" style={{ ...CODE_BLOCK_STYLE, padding: '9px 10px', background: 'oklch(0.15 0.008 265)', color: 'oklch(0.82 0.01 265)', fontFamily: "'IBM Plex Mono', monospace" }}>
      <code>{code}</code>
    </pre>
  );
}
