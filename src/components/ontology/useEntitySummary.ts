import { useCallback, useEffect, useRef, useState } from 'react';
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
  const latestKeyRef = useRef({ sessionId, nodeId, nodeType });
  latestKeyRef.current = { sessionId, nodeId, nodeType };
  const isCurrentKey = useCallback((key: { sessionId: string; nodeId: string; nodeType: string }) => {
    const latest = latestKeyRef.current;
    return latest.sessionId === key.sessionId && latest.nodeId === key.nodeId && latest.nodeType === key.nodeType;
  }, []);

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
    const key = { sessionId, nodeId, nodeType };
    setSummaryChecking(true);
    try {
      const result = await get<CardSummaryStatus>(
        `/sessions/${sessionId}/ontology/summarize-card/${encodeURIComponent(nodeId)}`,
      );
      if (!isCurrentKey(key)) return;
      setSummaryStatus(result);
    } catch (err) {
      if (!isCurrentKey(key)) return;
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
      if (isCurrentKey(key)) setSummaryChecking(false);
    }
  }, [isCurrentKey, nodeId, nodeType, sessionId]);

  const handleGenerateSummary = useCallback(async () => {
    if (!sessionId || summaryRunning || summaryDone) return;
    const key = { sessionId, nodeId, nodeType };
    setSummaryEditing(false);
    setSummarySaveError(null);
    setSummaryStatus((prev) => ({ ...prev, topicId: nodeId, status: 'running', error: null }));
    try {
      const result = await post<CardSummaryStatus>(`/sessions/${sessionId}/ontology/summarize-card`, {
        topicId: nodeId,
      });
      if (!isCurrentKey(key)) return;
      setSummaryStatus(result);
    } catch (err) {
      if (!isCurrentKey(key)) return;
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
  }, [isCurrentKey, nodeId, nodeType, sessionId, summaryDone, summaryRunning]);

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

    const key = { sessionId, nodeId, nodeType };
    setSummarySaving(true);
    setSummarySaveError(null);
    try {
      const result = await put<CardSummaryStatus>(
        `/sessions/${sessionId}/ontology/summarize-card/${encodeURIComponent(nodeId)}`,
        { summary: summaryDraft.trim() },
      );
      if (!isCurrentKey(key)) return;
      setSummaryStatus(result);
      setSummaryEditing(false);
      setSummaryDraft('');
    } catch (err) {
      if (!isCurrentKey(key)) return;
      setSummarySaveError(err instanceof Error ? err.message : '保存知识总结失败');
    } finally {
      if (isCurrentKey(key)) setSummarySaving(false);
    }
  }, [isCurrentKey, nodeId, nodeType, sessionId, summaryDraft, summarySaving]);

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
