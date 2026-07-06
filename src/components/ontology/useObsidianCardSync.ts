import { useCallback, useEffect, useRef, useState } from 'react';
import { get, post, put } from '../../api/client';

export interface ObsidianConfigStatus {
  vaultPath: string | null;
  notesDir: string;
  filenameTemplate: string;
  configured: boolean;
  error: string | null;
}

export interface ObsidianSyncStatus {
  topicId: string;
  configured: boolean;
  status: 'not_synced' | 'synced' | 'error';
  notePath: string | null;
  error: string | null;
  lastSyncedAt: string | null;
  updatedAt?: string | null;
  skipped?: boolean;
}

function initialObsidianStatus(topicId: string): ObsidianSyncStatus {
  return {
    topicId,
    configured: false,
    status: 'not_synced',
    notePath: null,
    error: null,
    lastSyncedAt: null,
  };
}

export function useObsidianCardSync({
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
  const isCurrentKey = useCallback((key: { sessionId: string | null; nodeId: string; nodeType: string }) => {
    const latest = latestKeyRef.current;
    return latest.sessionId === key.sessionId && latest.nodeId === key.nodeId && latest.nodeType === key.nodeType;
  }, []);

  const [obsidianStatus, setObsidianStatus] = useState<ObsidianSyncStatus>(() => initialObsidianStatus(nodeId));
  const [obsidianConfig, setObsidianConfig] = useState<ObsidianConfigStatus | null>(null);
  const [obsidianConfigOpen, setObsidianConfigOpen] = useState(false);
  const [obsidianVaultPath, setObsidianVaultPath] = useState('');
  const [obsidianNotesDir, setObsidianNotesDir] = useState('LLM知识卡片');
  const [obsidianBusy, setObsidianBusy] = useState(false);
  const [obsidianError, setObsidianError] = useState<string | null>(null);

  const loadObsidianStatus = useCallback(async () => {
    if (!sessionId || nodeType !== 'topic') return;
    const key = { sessionId, nodeId, nodeType };
    try {
      const [config, status] = await Promise.all([
        get<ObsidianConfigStatus>('/obsidian/config'),
        get<ObsidianSyncStatus>(`/sessions/${sessionId}/ontology/obsidian-card/${encodeURIComponent(nodeId)}`),
      ]);
      if (!isCurrentKey(key)) return;
      setObsidianConfig(config);
      setObsidianStatus(status);
      setObsidianVaultPath(config.vaultPath || '');
      setObsidianNotesDir(config.notesDir || 'LLM知识卡片');
      setObsidianError(status.error || config.error);
    } catch (err) {
      if (!isCurrentKey(key)) return;
      setObsidianError(err instanceof Error ? err.message : '获取 Obsidian 状态失败');
    }
  }, [isCurrentKey, nodeId, nodeType, sessionId]);

  const handleSaveObsidianConfig = useCallback(async () => {
    const key = { sessionId, nodeId, nodeType };
    setObsidianBusy(true);
    setObsidianError(null);
    try {
      const config = await put<ObsidianConfigStatus>('/obsidian/config', {
        vaultPath: obsidianVaultPath,
        notesDir: obsidianNotesDir || 'LLM知识卡片',
      });
      if (!isCurrentKey(key)) return;
      setObsidianConfig(config);
      setObsidianConfigOpen(false);
      await loadObsidianStatus();
    } catch (err) {
      if (!isCurrentKey(key)) return;
      setObsidianError(err instanceof Error ? err.message : '保存 Obsidian 配置失败');
    } finally {
      if (isCurrentKey(key)) setObsidianBusy(false);
    }
  }, [isCurrentKey, loadObsidianStatus, nodeId, nodeType, obsidianNotesDir, obsidianVaultPath, sessionId]);

  const handleSyncObsidian = useCallback(async () => {
    if (!sessionId || nodeType !== 'topic') return;
    if (!obsidianConfig?.configured) {
      setObsidianConfigOpen(true);
      return;
    }

    const key = { sessionId, nodeId, nodeType };
    setObsidianBusy(true);
    setObsidianError(null);
    try {
      const status = await post<ObsidianSyncStatus>(
        `/sessions/${sessionId}/ontology/obsidian-card/${encodeURIComponent(nodeId)}`,
      );
      if (!isCurrentKey(key)) return;
      setObsidianStatus(status);
      setObsidianError(status.error);
    } catch (err) {
      if (!isCurrentKey(key)) return;
      setObsidianStatus((prev) => ({ ...prev, status: 'error' }));
      setObsidianError(err instanceof Error ? err.message : '同步到 Obsidian 失败');
    } finally {
      if (isCurrentKey(key)) setObsidianBusy(false);
    }
  }, [isCurrentKey, nodeId, nodeType, obsidianConfig?.configured, sessionId]);

  useEffect(() => {
    setObsidianStatus(initialObsidianStatus(nodeId));
    setObsidianConfig(null);
    setObsidianConfigOpen(false);
    setObsidianVaultPath('');
    setObsidianNotesDir('LLM知识卡片');
    setObsidianBusy(false);
    setObsidianError(null);
    loadObsidianStatus();
  }, [loadObsidianStatus, nodeId]);

  return {
    obsidianStatus,
    obsidianConfig,
    obsidianConfigOpen,
    setObsidianConfigOpen,
    obsidianVaultPath,
    setObsidianVaultPath,
    obsidianNotesDir,
    setObsidianNotesDir,
    obsidianBusy,
    obsidianError,
    loadObsidianStatus,
    handleSaveObsidianConfig,
    handleSyncObsidian,
  };
}
