import { SEMANTIC } from '../../styles/theme';
import type { ObsidianConfigStatus, ObsidianSyncStatus } from './useObsidianCardSync';

export function ObsidianActionsSection({
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
  onSaveObsidianConfig,
  onSyncObsidian,
}: {
  obsidianStatus: ObsidianSyncStatus;
  obsidianConfig: ObsidianConfigStatus | null;
  obsidianConfigOpen: boolean;
  setObsidianConfigOpen: (updater: (open: boolean) => boolean) => void;
  obsidianVaultPath: string;
  setObsidianVaultPath: (vaultPath: string) => void;
  obsidianNotesDir: string;
  setObsidianNotesDir: (notesDir: string) => void;
  obsidianBusy: boolean;
  obsidianError: string | null;
  onSaveObsidianConfig: () => void;
  onSyncObsidian: () => void;
}) {
  return (
    <div style={{
      marginTop: 9,
      border: '1px solid oklch(0.32 0.014 265)',
      borderRadius: 9,
      padding: '9px 10px',
      background: 'oklch(0.19 0.01 265 / 0.46)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          onClick={onSyncObsidian}
          disabled={obsidianBusy}
          style={{
            border: obsidianStatus.status === 'error' ? '1px solid oklch(0.66 0.17 25 / 0.48)' : '1px solid oklch(0.45 0.09 165 / 0.55)',
            borderRadius: 7,
            padding: '6px 10px',
            background: obsidianStatus.status === 'synced'
              ? 'oklch(0.74 0.12 165 / 0.16)'
              : obsidianStatus.status === 'error'
                ? 'oklch(0.66 0.17 25 / 0.10)'
                : 'oklch(0.24 0.012 265)',
            color: obsidianStatus.status === 'synced'
              ? 'oklch(0.84 0.10 165)'
              : obsidianStatus.status === 'error'
                ? 'oklch(0.76 0.13 45)'
                : 'oklch(0.78 0.01 265)',
            cursor: obsidianBusy ? 'default' : 'pointer',
            fontFamily: 'inherit',
            fontSize: 11.5,
            fontWeight: 600,
          }}
        >
          {obsidianBusy
            ? '同步中'
            : obsidianStatus.status === 'synced'
              ? '再次同步'
              : obsidianStatus.status === 'error'
                ? '同步失败'
                : obsidianConfig?.configured
                  ? '同步到 Obsidian'
                  : '配置 Obsidian'}
        </button>
        {(obsidianConfig?.configured || obsidianConfigOpen) && (
          <button
            type="button"
            onClick={() => setObsidianConfigOpen((open) => !open)}
            style={{
              border: '1px solid oklch(0.30 0.014 265)',
              borderRadius: 7,
              padding: '6px 9px',
              background: 'transparent',
              color: SEMANTIC.textMuted,
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 11,
            }}
          >
            {obsidianConfigOpen ? '收起' : '设置'}
          </button>
        )}
        {obsidianStatus.lastSyncedAt && (
          <span style={{ marginLeft: 'auto', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: SEMANTIC.textMuted }}>
            {obsidianStatus.skipped ? '未变更' : '已写入'}
          </span>
        )}
      </div>

      {obsidianStatus.notePath && (
        <div style={{ marginTop: 6, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: SEMANTIC.textMuted, wordBreak: 'break-all' }}>
          {obsidianStatus.notePath}
        </div>
      )}

      {obsidianError && (
        <div style={{ marginTop: 6, fontSize: 11.5, color: 'oklch(0.76 0.13 45)', lineHeight: 1.45 }}>
          {obsidianError}
        </div>
      )}

      {obsidianConfigOpen && (
        <div style={{ marginTop: 9, display: 'flex', flexDirection: 'column', gap: 7 }}>
          <input
            value={obsidianVaultPath}
            onChange={(event) => setObsidianVaultPath(event.target.value)}
            placeholder="/Users/you/Documents/ObsidianVault"
            style={{
              width: '100%',
              boxSizing: 'border-box',
              border: '1px solid oklch(0.30 0.014 265)',
              borderRadius: 7,
              padding: '7px 9px',
              background: 'oklch(0.16 0.008 265)',
              color: SEMANTIC.textPrimary,
              outline: 'none',
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11.5,
            }}
          />
          <input
            value={obsidianNotesDir}
            onChange={(event) => setObsidianNotesDir(event.target.value)}
            placeholder="LLM知识卡片"
            style={{
              width: '100%',
              boxSizing: 'border-box',
              border: '1px solid oklch(0.30 0.014 265)',
              borderRadius: 7,
              padding: '7px 9px',
              background: 'oklch(0.16 0.008 265)',
              color: SEMANTIC.textPrimary,
              outline: 'none',
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11.5,
            }}
          />
          <button
            type="button"
            onClick={onSaveObsidianConfig}
            disabled={obsidianBusy}
            style={{
              alignSelf: 'flex-end',
              border: '1px solid oklch(0.45 0.09 165 / 0.55)',
              borderRadius: 7,
              padding: '5px 11px',
              background: 'oklch(0.30 0.06 165 / 0.45)',
              color: 'oklch(0.86 0.10 165)',
              cursor: obsidianBusy ? 'default' : 'pointer',
              fontFamily: 'inherit',
              fontSize: 11.5,
              fontWeight: 600,
            }}
          >
            保存配置
          </button>
        </div>
      )}
    </div>
  );
}
