import { SEMANTIC, SELECTED_ITEM, UNSELECTED_ITEM } from '../../../styles/theme';
import { fmtK } from '../../../utils/format';
import { getStructuredTextPreview } from '../../shared/structuredText';

interface TurnListItemProps {
  turnIndex: number;
  turnNum: string;
  asstReqs: number;
  maxInput: number;
  cumTotal: number;
  contextLimit: number;
  prompt: string;
  isSelected: boolean;
  compressionReset: boolean;
  onClick: () => void;
}

export function TurnListItem({
  turnNum,
  asstReqs,
  maxInput,
  cumTotal,
  contextLimit: ctxLimit,
  prompt,
  isSelected,
  compressionReset,
  onClick,
}: TurnListItemProps) {
  const loadPct = ctxLimit > 0 ? Math.max(2, (cumTotal / ctxLimit) * 100) : 100;
  const peakColor = maxInput >= 120000 ? 'oklch(0.76 0.13 60)' : SEMANTIC.textDesc2;
  const structuredPreview = getStructuredTextPreview(prompt);
  const isCommandPreview = structuredPreview?.kind === 'command';
  const isPluginPreview = structuredPreview?.kind === 'plugin-reference';
  const previewIcon = isCommandPreview ? '/' : isPluginPreview ? '@' : '!';
  const previewAccent = isCommandPreview
    ? 'oklch(0.86 0.09 165)'
    : isPluginPreview
      ? 'oklch(0.86 0.08 285)'
      : 'oklch(0.86 0.10 80)';
  const previewIconBg = isCommandPreview
    ? 'oklch(0.38 0.10 165 / 0.22)'
    : isPluginPreview
      ? 'oklch(0.50 0.10 285 / 0.18)'
      : 'oklch(0.64 0.10 80 / 0.16)';

  return (
    <button
      onClick={onClick}
      style={{
        textAlign: 'left',
        border: `1px solid ${isSelected ? SELECTED_ITEM.border : UNSELECTED_ITEM.border}`,
        borderRadius: 11,
        padding: '11px 13px',
        background: isSelected ? SELECTED_ITEM.bg : UNSELECTED_ITEM.bg,
        cursor: 'pointer',
        fontFamily: 'inherit',
        color: 'inherit',
        transition: 'background .14s ease, border-color .14s ease',
        display: 'block',
        width: '100%',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11,
            fontWeight: 600,
            color: isSelected ? SEMANTIC.textAccent3 : SEMANTIC.textMiniLabel,
            width: 26,
            flexShrink: 0,
          }}
        >
          {turnNum}
        </span>
        <span
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 10,
            color: SEMANTIC.textMiniLabel,
            border: `1px solid ${SEMANTIC.borderColor}`,
            borderRadius: 5,
            padding: '1px 5px',
          }}
        >
          {asstReqs} 请求
        </span>
        {compressionReset && (
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 9.5,
              fontWeight: 600,
              color: 'oklch(0.85 0.14 80)',
              background: 'oklch(0.85 0.14 80 / 0.12)',
              border: '1px solid oklch(0.85 0.14 80 / 0.35)',
              borderRadius: 5,
              padding: '1px 6px',
              letterSpacing: '0.02em',
            }}
          >
            压缩后
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 10.5,
            color: peakColor,
          }}
        >
          {fmtK(maxInput)}
        </span>
      </div>
      <div
        style={{
          fontSize: 12.5,
          lineHeight: 1.45,
          color: isSelected ? SEMANTIC.textPrimary : SEMANTIC.textSecondary,
          display: structuredPreview ? 'flex' : '-webkit-box',
          alignItems: structuredPreview ? 'center' : undefined,
          gap: structuredPreview ? 7 : undefined,
          minHeight: structuredPreview ? 35 : undefined,
          WebkitLineClamp: structuredPreview ? undefined : 2,
          WebkitBoxOrient: structuredPreview ? undefined : 'vertical',
          overflow: 'hidden',
        }}
      >
        {structuredPreview ? (
          <>
            <span
              style={{
                width: 20,
                height: 20,
                borderRadius: 6,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 11,
                fontWeight: 700,
                color: previewAccent,
                background: previewIconBg,
              }}
            >
              {previewIcon}
            </span>
            <span style={{ minWidth: 0 }}>
              <span
                style={{
                  display: 'block',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontFamily: "'IBM Plex Mono', monospace",
                  color: previewAccent,
                  fontWeight: 650,
                }}
              >
                {structuredPreview.label}
              </span>
              {structuredPreview.detail && (
                <span
                  style={{
                    display: 'block',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontSize: 11,
                    color: SEMANTIC.textMiniLabel,
                    marginTop: 1,
                  }}
                >
                  {structuredPreview.detail}
                </span>
              )}
            </span>
          </>
        ) : prompt}
      </div>
      <div
        style={{
          height: 3,
          borderRadius: 2,
          marginTop: 9,
          background: 'oklch(0.26 0.01 265)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${loadPct}%`,
            borderRadius: 2,
            background: isSelected ? SELECTED_ITEM.loadColor : UNSELECTED_ITEM.loadColor,
          }}
        />
      </div>
    </button>
  );
}
