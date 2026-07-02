import { SEMANTIC } from '../../styles/theme';
import { MarkdownBlock } from '../shared/MarkdownBlock';
import type { CardSummaryStatus } from './useEntitySummary';

export function EntitySummarySection({
  sessionId,
  summaryNodeCount,
  summaryStatus,
  summaryChecking,
  summaryEditing,
  summaryDraft,
  setSummaryDraft,
  summarySaving,
  summarySaveError,
  summaryRunning,
  summaryDone,
  summaryFailed,
  onGenerateSummary,
  onEditSummary,
  onCancelSummaryEdit,
  onSaveSummary,
}: {
  sessionId: string | null;
  summaryNodeCount: number;
  summaryStatus: CardSummaryStatus;
  summaryChecking: boolean;
  summaryEditing: boolean;
  summaryDraft: string;
  setSummaryDraft: (draft: string) => void;
  summarySaving: boolean;
  summarySaveError: string | null;
  summaryRunning: boolean;
  summaryDone: boolean;
  summaryFailed: boolean;
  onGenerateSummary: () => void;
  onEditSummary: () => void;
  onCancelSummaryEdit: () => void;
  onSaveSummary: () => void;
}) {
  const summaryLabel = summaryRunning
    ? '知识总结 总结中'
    : summaryDone
      ? '知识总结 已总结'
      : summaryFailed
        ? '知识总结 总结失败'
        : '知识总结 未总结';
  const summaryHint = summaryFailed
    ? `点击再次总结 ${summaryNodeCount}节点`
    : summaryDone || summaryRunning
      ? `${summaryNodeCount}节点`
      : `点击进行总结 ${summaryNodeCount}节点`;

  if (summaryNodeCount <= 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={onGenerateSummary}
        disabled={!sessionId || summaryDone || summaryRunning || summaryChecking}
        style={{
          width: '100%',
          border: summaryFailed ? '1px solid oklch(0.66 0.17 25 / 0.5)' : '1px solid oklch(0.45 0.09 165 / 0.55)',
          borderRadius: 8,
          padding: '8px 11px',
          background: summaryFailed
            ? 'oklch(0.66 0.17 25 / 0.10)'
            : summaryDone
              ? 'oklch(0.74 0.12 165 / 0.16)'
              : SEMANTIC.innerCardBg,
          color: summaryFailed
            ? 'oklch(0.76 0.13 45)'
            : summaryDone
              ? 'oklch(0.84 0.10 165)'
              : 'oklch(0.78 0.01 265)',
          cursor: !sessionId || summaryDone || summaryRunning || summaryChecking ? 'default' : 'pointer',
          fontFamily: 'inherit',
          fontSize: 12.5,
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
        }}
      >
        <span>{summaryChecking ? '知识总结 检查中' : summaryLabel}</span>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: SEMANTIC.textMuted }}>
          {summaryChecking ? `${summaryNodeCount}节点` : summaryHint}
        </span>
      </button>

      {(summaryStatus.summary || summaryStatus.error || summaryRunning) && (
        <div style={{
          marginTop: 9,
          border: summaryFailed ? '1px solid oklch(0.66 0.17 25 / 0.4)' : '1px solid oklch(0.32 0.014 265)',
          borderRadius: 10,
          background: summaryFailed ? 'oklch(0.66 0.17 25 / 0.10)' : 'oklch(0.19 0.01 265 / 0.46)',
          padding: '11px 12px',
        }}>
          {summaryRunning && (
            <div style={{ fontSize: 12, color: SEMANTIC.textMuted, lineHeight: 1.55 }}>
              正在生成当前知识卡片总结。刷新页面后会自动恢复这个状态。
            </div>
          )}
          {summaryStatus.error && (
            <div style={{ fontSize: 12, color: 'oklch(0.76 0.13 45)', lineHeight: 1.55 }}>
              {summaryStatus.error}
            </div>
          )}
          {summaryStatus.summary && !summaryEditing && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
                <span style={{ fontSize: 11, color: SEMANTIC.textMuted, fontFamily: "'IBM Plex Mono', monospace" }}>
                  Markdown · 已保存
                </span>
                <span style={{ flex: 1 }} />
                <button
                  type="button"
                  onClick={onEditSummary}
                  disabled={summarySaving}
                  style={{
                    border: '1px solid oklch(0.45 0.09 165 / 0.45)',
                    borderRadius: 7,
                    padding: '4px 9px',
                    background: 'oklch(0.24 0.012 265)',
                    color: 'oklch(0.82 0.10 165)',
                    cursor: summarySaving ? 'default' : 'pointer',
                    fontFamily: 'inherit',
                    fontSize: 11,
                  }}
                >
                  编辑
                </button>
              </div>
              <MarkdownBlock text={summaryStatus.summary} />
            </>
          )}
          {summaryStatus.summary && summaryEditing && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <textarea
                value={summaryDraft}
                onChange={(event) => setSummaryDraft(event.target.value)}
                disabled={summarySaving}
                rows={12}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  resize: 'vertical',
                  border: '1px solid oklch(0.34 0.014 265)',
                  borderRadius: 8,
                  padding: '9px 10px',
                  background: 'oklch(0.16 0.008 265)',
                  color: SEMANTIC.textPrimary,
                  outline: 'none',
                  fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
                  fontSize: 12.5,
                  lineHeight: 1.6,
                }}
              />
              {summarySaveError && (
                <div style={{ fontSize: 11.5, color: 'oklch(0.76 0.13 45)', lineHeight: 1.45 }}>
                  {summarySaveError}
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button
                  type="button"
                  onClick={onCancelSummaryEdit}
                  disabled={summarySaving}
                  style={{
                    border: '1px solid oklch(0.30 0.014 265)',
                    borderRadius: 7,
                    padding: '5px 10px',
                    background: 'oklch(0.22 0.01 265)',
                    color: 'oklch(0.76 0.01 265)',
                    cursor: summarySaving ? 'default' : 'pointer',
                    fontFamily: 'inherit',
                    fontSize: 11.5,
                  }}
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={onSaveSummary}
                  disabled={summarySaving}
                  style={{
                    border: '1px solid oklch(0.45 0.09 165 / 0.55)',
                    borderRadius: 7,
                    padding: '5px 11px',
                    background: 'oklch(0.30 0.06 165 / 0.45)',
                    color: 'oklch(0.86 0.10 165)',
                    cursor: summarySaving ? 'default' : 'pointer',
                    fontFamily: 'inherit',
                    fontSize: 11.5,
                    fontWeight: 600,
                  }}
                >
                  {summarySaving ? '保存中' : '保存'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
