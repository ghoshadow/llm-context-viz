import { useCallback, useEffect, useState } from 'react';
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
  const [obsidianStatus, setObsidianStatus] = useState<ObsidianSyncStatus>(() => initialObsidianStatus(nodeId));
  const [obsidianConfig, setObsidianConfig] = useState<ObsidianConfigStatus | null>(null);
  const [obsidianConfigOpen, setObsidianConfigOpen] = useState(false);
  const [obsidianVaultPath, setObsidianVaultPath] = useState('');
  const [obsidianNotesDir, setObsidianNotesDir] = useState('LLM知识卡片');
  const [obsidianBusy, setObsidianBusy] = useState(false);
  const [obsidianError, setObsidianError] = useState<string | null>(null);

  const loadObsidianStatus = useCallback(async () => {
    if (!sessionId || nodeType !== 'topic') return;
    try {
      const [config, status] = await Promise.all([
        get<ObsidianConfigStatus>('/obsidian/config'),
        get<ObsidianSyncStatus>(`/sessions/${sessionId}/ontology/obsidian-card/${encodeURIComponent(nodeId)}`),
      ]);
      setObsidianConfig(config);
      setObsidianStatus(status);
      setObsidianVaultPath(config.vaultPath || '');
      setObsidianNotesDir(config.notesDir || 'LLM知识卡片');
      setObsidianError(status.error || config.error);
    } catch (err) {
      setObsidianError(err instanceof Error ? err.message : '获取 Obsidian 状态失败');
    }
  }, [nodeId, nodeType, sessionId]);

  const handleSaveObsidianConfig = useCallback(async () => {
    setObsidianBusy(true);
    setObsidianError(null);
    try {
      const config = await put<ObsidianConfigStatus>('/obsidian/config', {
        vaultPath: obsidianVaultPath,
        notesDir: obsidianNotesDir || 'LLM知识卡片',
      });
      setObsidianConfig(config);
      setObsidianConfigOpen(false);
      await loadObsidianStatus();
    } catch (err) {
      setObsidianError(err instanceof Error ? err.message : '保存 Obsidian 配置失败');
    } finally {
      setObsidianBusy(false);
    }
  }, [loadObsidianStatus, obsidianNotesDir, obsidianVaultPath]);

  const handleSyncObsidian = useCallback(async () => {
    if (!sessionId || nodeType !== 'topic') return;
    if (!obsidianConfig?.configured) {
      setObsidianConfigOpen(true);
      return;
    }

    setObsidianBusy(true);
    setObsidianError(null);
    try {
      const status = await post<ObsidianSyncStatus>(
        `/sessions/${sessionId}/ontology/obsidian-card/${encodeURIComponent(nodeId)}`,
      );
      setObsidianStatus(status);
      setObsidianError(status.error);
    } catch (err) {
      setObsidianStatus((prev) => ({ ...prev, status: 'error' }));
      setObsidianError(err instanceof Error ? err.message : '同步到 Obsidian 失败');
    } finally {
      setObsidianBusy(false);
    }
  }, [nodeId, nodeType, obsidianConfig?.configured, sessionId]);

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
