import { SEMANTIC } from '../../styles/theme';
import { getCommandParts } from './commandMessage';
import { MarkdownBlock } from './MarkdownBlock';
import { parseStructuredTextSegments } from './structuredText';

interface StructuredTextBlockProps {
  text: string;
  fontFamily: string;
  fontSize?: number;
  maxHeight?: number | string;
  overflowY?: 'auto' | 'visible';
}

function CommandCard({ message, name, args }: { message: string; name: string; args: string }) {
  const parts = getCommandParts(name || message);

  return (
    <div
      style={{
        margin: '0 0 10px',
        border: '1px solid oklch(0.42 0.10 165 / 0.45)',
        borderRadius: 8,
        background: 'oklch(0.18 0.025 180 / 0.72)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 10px',
          borderBottom: '1px solid oklch(0.42 0.10 165 / 0.28)',
          background: 'oklch(0.22 0.035 180 / 0.72)',
        }}
      >
        <span
          style={{
            width: 20,
            height: 20,
            borderRadius: 6,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 12,
            fontWeight: 700,
            color: 'oklch(0.88 0.10 165)',
            background: 'oklch(0.38 0.10 165 / 0.28)',
          }}
        >
          /
        </span>
        <span style={{ fontSize: 12.5, fontWeight: 650, color: 'oklch(0.88 0.05 180)' }}>
          插件命令调用
        </span>
        <span style={{ flex: 1 }} />
        <span
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 10.5,
            color: 'oklch(0.72 0.09 165)',
          }}
        >
          {parts.plugin}
        </span>
      </div>
      <div style={{ padding: '10px 12px' }}>
        <div
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 12.5,
            color: 'oklch(0.86 0.09 165)',
            marginBottom: args ? 8 : 0,
            wordBreak: 'break-word',
          }}
        >
          /{parts.plugin}:{parts.command}
        </div>
        {args && (
          <div
            style={{
              padding: '8px 10px',
              borderRadius: 6,
              background: 'oklch(0.13 0.010 265 / 0.70)',
              color: SEMANTIC.textSecondary,
              fontSize: 12.5,
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {args}
          </div>
        )}
      </div>
    </div>
  );
}

function LocalCommandCaveatCard() {
  return (
    <div
      style={{
        margin: '0 0 10px',
        border: '1px solid oklch(0.64 0.10 80 / 0.34)',
        borderRadius: 8,
        background: 'oklch(0.22 0.026 80 / 0.40)',
        padding: '9px 11px',
        display: 'flex',
        alignItems: 'center',
        gap: 9,
      }}
    >
      <span
        style={{
          width: 22,
          height: 22,
          borderRadius: 6,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 12,
          fontWeight: 700,
          color: 'oklch(0.85 0.13 80)',
          background: 'oklch(0.64 0.10 80 / 0.18)',
        }}
      >
        !
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 650, color: 'oklch(0.86 0.10 80)' }}>
          本地命令输出提示
        </span>
        <span style={{ display: 'block', marginTop: 1, fontSize: 12, color: SEMANTIC.textMuted2 }}>
          由本地命令生成的消息
        </span>
      </span>
    </div>
  );
}

function PluginReferenceCard({
  label,
  source,
}: {
  label: string;
  source: string;
}) {
  return (
    <div
      style={{
        margin: '0 0 10px',
        border: '1px solid oklch(0.50 0.10 285 / 0.38)',
        borderRadius: 8,
        background: 'oklch(0.20 0.030 285 / 0.46)',
        padding: '9px 11px',
        display: 'flex',
        alignItems: 'center',
        gap: 9,
      }}
    >
      <span
        style={{
          width: 22,
          height: 22,
          borderRadius: 6,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 12,
          fontWeight: 700,
          color: 'oklch(0.82 0.09 285)',
          background: 'oklch(0.50 0.10 285 / 0.20)',
        }}
      >
        @
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 650, color: 'oklch(0.86 0.08 285)' }}>
          {label}
        </span>
        {source && (
          <span style={{ display: 'block', marginTop: 1, fontSize: 12, color: SEMANTIC.textMuted2 }}>
            {source}
          </span>
        )}
      </span>
    </div>
  );
}

export function StructuredTextBlock({
  text,
  fontFamily,
  fontSize = 13,
  maxHeight = 'none',
  overflowY = 'visible',
}: StructuredTextBlockProps) {
  const segments = parseStructuredTextSegments(text);

  return (
    <div
      className="block-body thin-scrollbar"
      style={{
        fontFamily,
        fontSize,
        maxHeight,
        overflowY,
      }}
    >
      {segments.map((segment, index) => {
        if (segment.type === 'command') {
          return <CommandCard key={`cmd-${index}`} message={segment.message} name={segment.name} args={segment.args} />;
        }
        if (segment.type === 'local-command-caveat') {
          return <LocalCommandCaveatCard key={`caveat-${index}`} />;
        }
        if (segment.type === 'plugin-reference') {
          return <PluginReferenceCard key={`plugin-${index}`} label={segment.label} source={segment.source} />;
        }
        if (!segment.text.trim()) return null;
        return <MarkdownBlock key={`text-${index}`} text={segment.text} fontSize={fontSize} variant="tool-output" />;
      })}
    </div>
  );
}
