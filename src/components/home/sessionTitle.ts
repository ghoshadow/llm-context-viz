import { getStructuredTextPreview } from '../shared/structuredText';

export type SessionCardTitleDisplay =
  | { kind: 'text'; text: string }
  | { kind: 'structured'; label: string; detail: string; icon: string; tone: 'command' | 'warning' | 'plugin'; tooltip: string };

export function getSessionCardTitleDisplay(
  aiTitle: string | null | undefined,
  model: string | null | undefined,
): SessionCardTitleDisplay {
  const title = aiTitle?.trim() || model?.trim() || '';
  const structuredPreview = title ? getStructuredTextPreview(title) : null;

  if (structuredPreview) {
    return {
      kind: 'structured',
      label: structuredPreview.label,
      detail: structuredPreview.detail,
      icon: structuredPreview.kind === 'command' ? '/' : structuredPreview.kind === 'plugin-reference' ? '@' : '!',
      tone: structuredPreview.kind === 'command'
        ? 'command'
        : structuredPreview.kind === 'plugin-reference'
          ? 'plugin'
          : 'warning',
      tooltip: structuredPreview.tooltip,
    };
  }

  return {
    kind: 'text',
    text: title || 'unknown',
  };
}
