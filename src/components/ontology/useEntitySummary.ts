import { useCallback, useEffect, useState } from 'react';
import { get, post, put } from '../../api/client';

export type SummaryStatus = 'not_started' | 'running' | 'done' | 'error';

export interface CardSummaryStatus {
  topicId: string;
  status: SummaryStatus;
  summary: string | null;
  error: string | null;
  updatedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

function initialSummaryStatus(topicId: string): CardSummaryStatus {
  return {
    topicId,
    status: 'not_started',
    summary: null,
    error: null,
    updatedAt: null,
    startedAt: null,
    completedAt: null,
  };
}

export function useEntitySummary({
  sessionId,
  nodeId,
  nodeType,
}: {
  sessionId: string | null;
  nodeId: string;
  nodeType: string;
}) {
  const [summaryStatus, setSummaryStatus] = useState<CardSummaryStatus>(() => initialSummaryStatus(nodeId));
  const [summaryChecking, setSummaryChecking] = useState(false);
  const [summaryEditing, setSummaryEditing] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState('');
  const [summarySaving, setSummarySaving] = useState(false);
  const [summarySaveError, setSummarySaveError] = useState<string | null>(null);
  const summaryRunning = summaryStatus.status === 'running';
  const summaryDone = summaryStatus.status === 'done' && Boolean(summaryStatus.summary);
  const summaryFailed = summaryStatus.status === 'error';

  const loadSummaryStatus = useCallback(async () => {
    if (!sessionId || nodeType !== 'topic') return;
    setSummaryChecking(true);
    try {
      const result = await get<CardSummaryStatus>(
        `/sessions/${sessionId}/ontology/summarize-card/${encodeURIComponent(nodeId)}`,
      );
      setSummaryStatus(result);
    } catch (err) {
      setSummaryStatus({
        topicId: nodeId,
        status: 'error',
        summary: null,
        error: err instanceof Error ? err.message : '获取知识总结状态失败',
        updatedAt: null,
        startedAt: null,
        completedAt: null,
      });
    } finally {
      setSummaryChecking(false);
    }
  }, [nodeId, nodeType, sessionId]);

  const handleGenerateSummary = useCallback(async () => {
    if (!sessionId || summaryRunning || summaryDone) return;
    setSummaryEditing(false);
    setSummarySaveError(null);
    setSummaryStatus((prev) => ({ ...prev, topicId: nodeId, status: 'running', error: null }));
    try {
      const result = await post<CardSummaryStatus>(`/sessions/${sessionId}/ontology/summarize-card`, {
        topicId: nodeId,
      });
      setSummaryStatus(result);
    } catch (err) {
      setSummaryStatus({
        topicId: nodeId,
        status: 'error',
        summary: null,
        error: err instanceof Error ? err.message : '生成知识总结失败',
        updatedAt: null,
        startedAt: null,
        completedAt: null,
      });
    }
  }, [nodeId, sessionId, summaryDone, summaryRunning]);

  const handleEditSummary = useCallback(() => {
    setSummaryDraft(summaryStatus.summary || '');
    setSummarySaveError(null);
    setSummaryEditing(true);
  }, [summaryStatus.summary]);

  const handleCancelSummaryEdit = useCallback(() => {
    setSummaryEditing(false);
    setSummaryDraft('');
    setSummarySaveError(null);
  }, []);

  const handleSaveSummary = useCallback(async () => {
    if (!sessionId || summarySaving) return;
    if (!summaryDraft.trim()) {
      setSummarySaveError('知识总结内容不能为空');
      return;
    }

    setSummarySaving(true);
    setSummarySaveError(null);
    try {
      const result = await put<CardSummaryStatus>(
        `/sessions/${sessionId}/ontology/summarize-card/${encodeURIComponent(nodeId)}`,
        { summary: summaryDraft.trim() },
      );
      setSummaryStatus(result);
      setSummaryEditing(false);
      setSummaryDraft('');
    } catch (err) {
      setSummarySaveError(err instanceof Error ? err.message : '保存知识总结失败');
    } finally {
      setSummarySaving(false);
    }
  }, [nodeId, sessionId, summaryDraft, summarySaving]);

  useEffect(() => {
    setSummaryStatus(initialSummaryStatus(nodeId));
    setSummaryEditing(false);
    setSummaryDraft('');
    setSummarySaveError(null);
    setSummarySaving(false);
    loadSummaryStatus();
  }, [loadSummaryStatus, nodeId]);

  useEffect(() => {
    if (summaryStatus.status !== 'running') return;
    const timer = window.setInterval(() => {
      loadSummaryStatus();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [loadSummaryStatus, summaryStatus.status]);

  return {
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
    loadSummaryStatus,
    handleGenerateSummary,
    handleEditSummary,
    handleCancelSummaryEdit,
    handleSaveSummary,
  };
}
