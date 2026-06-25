import React, { useMemo } from 'react';
import { diffLines } from 'diff';
import { SEMANTIC } from '../../styles/theme';

interface DiffViewProps {
  /** JSON input body from an Edit tool call. */
  body: string;
}

export function DiffView({ body }: DiffViewProps) {
  const data = useMemo(() => {
    try {
      const input = JSON.parse(body) as { file_path?: string; old_string?: string; new_string?: string };
      if (!input.old_string && !input.new_string) return null;
      const hunks = diffLines(input.old_string ?? '', input.new_string ?? '', { ignoreWhitespace: false });

      let oldLine = 1;
      let newLine = 1;
      const lines: Array<{ num?: number; added?: boolean; removed?: boolean; text: string }> = [];

      for (const hunk of hunks) {
        const parts = hunk.value.replace(/\n$/, '').split('\n');
        for (const part of parts) {
          if (hunk.added) {
            lines.push({ added: true, text: part });
            newLine++;
          } else if (hunk.removed) {
            lines.push({ num: oldLine++, removed: true, text: part });
          } else {
            lines.push({ num: newLine++, text: part });
            oldLine++;
          }
        }
      }
      return { filePath: input.file_path, lines };
    } catch {
      return null;
    }
  }, [body]);

  if (!data) return null;

  const GUTTER_W = 40;

  return (
    <div style={{
      fontFamily: "'IBM Plex Mono', monospace",
      fontSize: 11,
      lineHeight: 1.6,
      background: 'oklch(0.14 0.005 265)',
      borderRadius: 6,
      border: '1px solid oklch(0.28 0.012 265)',
      overflow: 'auto',
    }}>
      {data.filePath && (
        <div style={{
          padding: '3px 10px',
          borderBottom: '1px solid oklch(0.22 0.012 265)',
          color: SEMANTIC.textMuted2,
          fontSize: 10,
        }}>
          {data.filePath}
        </div>
      )}
      {data.lines.map((line, i) => {
        const bg = line.added
          ? 'oklch(0.22 0.06 150 / 0.25)'
          : line.removed
          ? 'oklch(0.22 0.06 15 / 0.25)'
          : 'transparent';

        const fg = line.added
          ? 'oklch(0.74 0.06 150)'
          : line.removed
          ? 'oklch(0.74 0.06 15)'
          : 'oklch(0.78 0.01 265)';

        return (
          <div
            key={i}
            style={{
              background: bg,
              padding: '0 10px 0 4px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              minHeight: '1.6em',
              display: 'flex',
            }}
          >
            <span style={{
              width: GUTTER_W, minWidth: GUTTER_W, textAlign: 'right', paddingRight: 8,
              color: SEMANTIC.textMuted3, userSelect: 'none',
            }}>
              {line.num ?? ''}
            </span>
            <span style={{
              color: line.added
                ? 'oklch(0.72 0.08 150)'
                : line.removed
                ? 'oklch(0.72 0.08 15)'
                : 'transparent',
              marginRight: 6,
              userSelect: 'none',
              width: 14,
            }}>
              {line.added ? '+' : line.removed ? '-' : ''}
            </span>
            <span style={{ color: fg }}>
              {line.text}
            </span>
          </div>
        );
      })}
    </div>
  );
}
