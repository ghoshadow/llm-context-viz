import { useCallback, useEffect, useState } from 'react';
import { get, post } from '../../api/client';
import {
  getCalibrationDetailTranslationBlockReason,
  type CalibrationDetailDisplay,
  type CalibrationDetailTranslationSlot,
} from './calibrationDetailModal';
import type { CalibrationDetailModalState } from './calibrationPagePanels';

export function useCalibrationDetailTranslation({
  detailModal,
  detailDisplay,
  detailTranslatedText,
  detailTranslatedDisplay,
  onDetailTranslated,
  currentSessionId,
  currentTurnIndex,
  detailTranslationSlot,
}: {
  detailModal: CalibrationDetailModalState | null;
  detailDisplay: CalibrationDetailDisplay | undefined;
  detailTranslatedText: string | undefined;
  detailTranslatedDisplay: CalibrationDetailDisplay | undefined;
  onDetailTranslated: (key: string, text: string) => void;
  currentSessionId: string | null | undefined;
  currentTurnIndex: number | null | undefined;
  detailTranslationSlot: CalibrationDetailTranslationSlot | undefined;
}) {
  const [detailTranslating, setDetailTranslating] = useState(false);
  const [detailTranslateError, setDetailTranslateError] = useState<string | null>(null);
  const [detailCopied, setDetailCopied] = useState(false);
  const detailKey = detailModal?.key;
  const stepIndex = detailTranslationSlot?.stepIndex;
  const sectionIndex = detailTranslationSlot?.sectionIndex;

  useEffect(() => {
    if (detailKey == null || stepIndex == null || sectionIndex == null || !currentSessionId || currentTurnIndex == null) return;
    if (detailTranslatedText) return;
    let cancelled = false;
    get<{ translations: Record<string, Record<string, string>> }>(
      `/sessions/${currentSessionId}/translations/${currentTurnIndex}?constantSections=${sectionIndex}`,
    )
      .then((res) => {
        const translated = res.translations?.[String(stepIndex)]?.[String(sectionIndex)];
        if (!cancelled && translated) {
          onDetailTranslated(detailKey, translated);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [currentSessionId, currentTurnIndex, detailKey, detailTranslatedText, onDetailTranslated, sectionIndex, stepIndex]);

  const resetDetailFeedback = useCallback(() => {
    setDetailCopied(false);
    setDetailTranslateError(null);
  }, []);

  const handleDetailCopy = useCallback(async () => {
    if (!detailDisplay) return;
    const text = detailTranslatedText
      ? `原文\n\n${detailDisplay.text}\n\n译文\n\n${detailTranslatedDisplay?.text ?? detailTranslatedText}`
      : detailDisplay.text;
    try {
      await navigator.clipboard.writeText(text);
      setDetailCopied(true);
      window.setTimeout(() => setDetailCopied(false), 2000);
    } catch {
      setDetailTranslateError('复制失败：浏览器剪贴板不可用。');
    }
  }, [detailDisplay, detailTranslatedDisplay, detailTranslatedText]);

  const handleDetailTranslate = useCallback(async () => {
    if (detailKey == null || !detailDisplay || stepIndex == null || sectionIndex == null || detailTranslating) return;
    if (detailTranslatedText) return;
    const blockReason = getCalibrationDetailTranslationBlockReason(detailKey, detailDisplay);
    if (blockReason) {
      setDetailTranslateError(blockReason);
      return;
    }
    if (!currentSessionId || currentTurnIndex == null) {
      setDetailTranslateError('请先打开一个会话和轮次，再使用翻译。');
      return;
    }
    setDetailTranslateError(null);
    setDetailTranslating(true);
    try {
      const res = await post<{ translated: string }>(`/sessions/${currentSessionId}/translate`, {
        text: detailDisplay.text,
        turnIndex: currentTurnIndex,
        stepIndex,
        sectionIndex,
      });
      onDetailTranslated(detailKey, res.translated);
    } catch (err) {
      setDetailTranslateError((err as Error).message);
    } finally {
      setDetailTranslating(false);
    }
  }, [
    currentSessionId,
    currentTurnIndex,
    detailDisplay,
    detailKey,
    detailTranslating,
    detailTranslatedText,
    onDetailTranslated,
    sectionIndex,
    stepIndex,
  ]);

  return {
    detailTranslatedText,
    detailTranslating,
    detailTranslateError,
    detailCopied,
    resetDetailFeedback,
    handleDetailCopy,
    handleDetailTranslate,
  };
}
