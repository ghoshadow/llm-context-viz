import { SEMANTIC } from '../../styles/theme';
import { CHARS_PER_TOKEN } from '../../pipeline/utils';
import { MarkdownBlock } from '../shared/MarkdownBlock';
import type { CalibrationCategoryRow } from './calibrationCategories';
import type { CalibrationDetailDisplay, CalibrationDetailLayout } from './calibrationDetailModal';

const S = SEMANTIC;
const MONO = "'IBM Plex Mono', monospace";
const SANS = "'IBM Plex Sans', system-ui, sans-serif";

export interface CalibrationDetailModalState {
  key: string;
  title: string;
  text: string;
}

export function estimateCalibrationTokens(chars: number): number {
  return Math.round(chars / CHARS_PER_TOKEN);
}

export function CalibrationStatCard({
  label,
  value,
  unit,
  accent,
}: {
  label: string;
  value: string;
  unit?: string;
  accent?: string;
}) {
  return (
    <div style={{
      border: `1px solid ${S.borderColor}`, borderRadius: 11, padding: '14px 16px',
      background: 'oklch(0.20 0.01 265 / 0.5)',
      display: 'flex', flexDirection: 'column', gap: 4, minWidth: 120,
    }}>
      <div style={{ fontSize: 11, color: S.textMuted, fontFamily: SANS }}>{label}</div>
      <div style={{ fontFamily: MONO, fontSize: 16, fontWeight: 600, color: accent ?? S.textPrimary3 }}>
        {value}
      </div>
      {unit && <div style={{ fontFamily: MONO, fontSize: 10, color: S.textMuted2 }}>{unit}</div>}
    </div>
  );
}

export function CalibrationErrorNotice({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      marginTop: 2, padding: '10px 14px', borderRadius: 8,
      background: 'oklch(0.50 0.14 25 / 0.15)',
      border: '1px solid oklch(0.50 0.14 25 / 0.3)',
      color: 'oklch(0.72 0.14 25)', fontSize: 13,
    }}>
      {children}
    </div>
  );
}

export function CalibrationCategoryRows({
  rows,
  valueSize,
  withTokens = false,
  onOpenDetail,
}: {
  rows: CalibrationCategoryRow[];
  valueSize: number;
  withTokens?: boolean;
  onOpenDetail: (key: string, text: string | undefined, title: string) => void;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
      {rows.map((row) => (
        <div key={row.key}>
          <div style={{ fontFamily: MONO, fontSize: 10, color: S.textMuted }}>{row.label}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ fontFamily: MONO, fontSize: valueSize, fontWeight: 600 }}>{row.chars.toLocaleString()}</div>
            <button
              disabled={!row.detail}
              onClick={() => onOpenDetail(row.detailKey, row.detail, row.label)}
              style={{
                border: `1px solid ${!row.detail ? S.borderSubtle2 : S.borderColor}`,
                borderRadius: 7,
                padding: '4px 8px',
                background: !row.detail ? 'oklch(0.19 0.008 265)' : 'oklch(0.22 0.012 265)',
                color: !row.detail ? S.textMuted2 : S.textSecondary,
                fontSize: 11,
                fontFamily: SANS,
                cursor: !row.detail ? 'not-allowed' : 'pointer',
              }}
            >
              查看
            </button>
          </div>
          <div style={{ fontFamily: MONO, fontSize: 10, color: S.textMuted2 }}>
            {withTokens ? `${row.detailKey} · ≈ ${estimateCalibrationTokens(row.chars)} tok` : row.detailKey}
          </div>
        </div>
      ))}
    </div>
  );
}

export function CalibrationDetailDialog({
  modal,
  layout,
  display,
  translatedDisplay,
  translatedText,
  translating,
  copied,
  error,
  onClose,
  onCopy,
  onTranslate,
}: {
  modal: CalibrationDetailModalState;
  layout: CalibrationDetailLayout;
  display?: CalibrationDetailDisplay;
  translatedDisplay?: CalibrationDetailDisplay;
  translatedText?: string;
  translating: boolean;
  copied: boolean;
  error: string | null;
  onClose: () => void;
  onCopy: () => void;
  onTranslate: () => void;
}) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1200,
        background: 'oklch(0.10 0.006 265 / 0.74)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 'min(980px, 96vw)', maxHeight: '88vh', overflow: 'hidden',
          background: 'oklch(0.155 0.008 265)',
          border: `1px solid ${S.borderColor}`, borderRadius: 14,
          boxShadow: '0 34px 90px oklch(0 0 0 / 0.58)',
          display: 'flex', flexDirection: 'column',
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '13px 18px', borderBottom: `1px solid ${S.borderColor}`, background: 'oklch(0.185 0.009 265)' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 650, color: S.textPrimary3 }}>{modal.title}</div>
            <div style={{ fontSize: 11, color: S.textMuted, fontFamily: MONO }}>{modal.key}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <button
              onClick={onCopy}
              style={{
                border: `1px solid ${copied ? 'oklch(0.45 0.08 150 / 0.42)' : S.borderColor}`,
                borderRadius: 7,
                padding: '5px 10px',
                background: copied ? 'oklch(0.55 0.08 150 / 0.12)' : 'oklch(0.22 0.01 265)',
                color: copied ? S.textGreen : S.textSecondary,
                cursor: 'pointer',
                fontSize: 12,
                fontFamily: SANS,
              }}
            >
              {copied ? '已复制' : '复制'}
            </button>
            <button
              onClick={onTranslate}
              disabled={translating || Boolean(translatedText)}
              style={{
                border: `1px solid ${translatedText ? 'oklch(0.45 0.08 150 / 0.35)' : 'oklch(0.45 0.10 60 / 0.18)'}`,
                borderRadius: 7,
                padding: '5px 10px',
                background: translatedText ? 'oklch(0.55 0.08 150 / 0.10)' : 'oklch(0.45 0.10 60 / 0.08)',
                color: translatedText ? S.textGreen : S.textAccent2,
                cursor: translating ? 'wait' : translatedText ? 'default' : 'pointer',
                opacity: translating ? 0.65 : 1,
                fontSize: 12,
                fontFamily: SANS,
              }}
            >
              {translating ? '翻译中...' : translatedText ? '已翻译' : '翻译'}
            </button>
            <button
              onClick={onClose}
              style={{ border: `1px solid ${S.borderColor}`, borderRadius: 8, width: 30, height: 30, background: 'oklch(0.22 0.01 265)', color: S.textSecondary, cursor: 'pointer', fontSize: 14 }}
            >
              x
            </button>
          </div>
        </div>
        {error && (
          <div style={{ padding: '10px 18px 0', fontSize: 12, color: 'oklch(0.72 0.14 25)' }}>
            {error}
          </div>
        )}
        <div style={{ padding: '16px 18px', overflow: 'auto' }}>
          {layout === 'side-by-side' ? (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
              gap: 14,
              minWidth: 760,
              alignItems: 'start',
            }}>
              <div>
                <div style={{ marginBottom: 8, fontSize: 11, color: S.textMuted, fontFamily: MONO }}>原文</div>
                {display && <DetailContent text={display.text} markdown={display.markdown} />}
              </div>
              <div>
                <div style={{ marginBottom: 8, fontSize: 11, color: S.textMuted, fontFamily: MONO }}>译文</div>
                {translatedDisplay && (
                  <DetailContent text={translatedDisplay.text} markdown={translatedDisplay.markdown} />
                )}
              </div>
            </div>
          ) : (
            display && <DetailContent text={display.text} markdown={display.markdown} />
          )}
        </div>
      </div>
    </div>
  );
}

function DetailContent({ text, markdown }: { text: string; markdown: boolean }) {
  if (markdown) {
    return <MarkdownBlock text={text} variant="markdown" preserveNewlines />;
  }

  return (
    <pre style={{
      margin: 0,
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      fontFamily: MONO,
      fontSize: 12,
      lineHeight: 1.65,
      color: S.textPrimary3,
    }}>
      {text}
    </pre>
  );
}
