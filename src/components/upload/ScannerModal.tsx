import { useState, useCallback, useEffect, useMemo } from 'react';
import { useSessionStore } from '../../store/sessionStore';
import { useUIStore } from '../../store/uiStore';
import { SEMANTIC } from '../../styles/theme';
import { fmtK, fmtDateShort } from '../../utils/format';
import { API_BASE } from '../../api/client';
import { filterScannerFiles } from './scannerFileFilters';
import { getScannerFileTitleDisplay, type ScannerFileTitleDisplay } from './scannerFileTitle';

interface FoundFile {
  path: string;
  name: string;
  size: number;
  modified: string;
  source?: 'claude' | 'codex';
  hash: string;
  imported: boolean;
  title?: string;
  model?: string;
  requests?: number;
  peakTokens?: number;
  turnCount?: number;
}

const S = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 1000,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'oklch(0 0 0 / 0.55)', backdropFilter: 'blur(6px)',
  } as React.CSSProperties,
  card: {
    width: 560, maxWidth: 'calc(100vw - 48px)', maxHeight: '80vh',
    padding: '28px 28px 20px', borderRadius: 12,
    background: SEMANTIC.cardBg, border: `1px solid ${SEMANTIC.borderColor}`,
    boxShadow: '0 16px 48px oklch(0 0 0 / 0.45)',
    display: 'flex', flexDirection: 'column',
  } as React.CSSProperties,
  closeBtn: {
    position: 'absolute', top: 12, right: 14,
    background: 'none', border: 'none', cursor: 'pointer',
    color: SEMANTIC.textMuted, fontSize: 20, lineHeight: 1, padding: '4px 6px', borderRadius: 4,
  } as React.CSSProperties,
  title: { margin: 0, fontSize: 18, fontWeight: 600, color: SEMANTIC.textPrimary } as React.CSSProperties,
  scanBtn: {
    marginTop: 16, padding: '10px 20px', fontSize: 13, fontWeight: 500,
    color: SEMANTIC.textAccent2, background: 'oklch(0.74 0.13 60 / 0.12)',
    border: `1px solid oklch(0.50 0.10 60 / 0.4)`, borderRadius: 6, cursor: 'pointer',
    alignSelf: 'center',
  } as React.CSSProperties,
  list: {
    marginTop: 16, overflowY: 'auto', flex: 1,
    display: 'flex', flexDirection: 'column', gap: 6,
  } as React.CSSProperties,
  fileItem: {
    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
    borderRadius: 8, border: `1px solid ${SEMANTIC.borderColor}`,
    background: 'oklch(0.18 0.008 265 / 0.5)',
  } as React.CSSProperties,
  fileName: { flex: 1, fontSize: 12.5, color: SEMANTIC.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as React.CSSProperties,
  structuredTitle: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
    gap: 7,
  } as React.CSSProperties,
  structuredIcon: {
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
  } as React.CSSProperties,
  structuredIconCommand: {
    color: 'oklch(0.88 0.10 165)',
    background: 'oklch(0.38 0.10 165 / 0.22)',
  },
  structuredIconWarning: {
    color: 'oklch(0.85 0.13 80)',
    background: 'oklch(0.64 0.10 80 / 0.16)',
  },
  structuredIconPlugin: {
    color: 'oklch(0.82 0.09 285)',
    background: 'oklch(0.50 0.10 285 / 0.18)',
  },
  structuredTextWrap: {
    minWidth: 0,
    flex: 1,
  } as React.CSSProperties,
  structuredName: {
    display: 'block',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    fontWeight: 650,
  } as React.CSSProperties,
  structuredNameCommand: {
    color: 'oklch(0.86 0.09 165)',
  },
  structuredNameWarning: {
    color: 'oklch(0.86 0.10 80)',
  },
  structuredNamePlugin: {
    color: 'oklch(0.86 0.08 285)',
  },
  structuredDetail: {
    display: 'block',
    marginTop: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 10.5,
    color: SEMANTIC.textMuted,
  } as React.CSSProperties,
  meta: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: SEMANTIC.textMuted, whiteSpace: 'nowrap' } as React.CSSProperties,
  importBtn: {
    padding: '5px 14px', fontSize: 11.5, fontWeight: 500, borderRadius: 5,
    background: 'oklch(0.74 0.13 60 / 0.15)', color: SEMANTIC.textAccent2,
    border: `1px solid oklch(0.50 0.10 60 / 0.35)`, cursor: 'pointer',
  } as React.CSSProperties,
  importedTag: {
    padding: '4px 10px', fontSize: 11, borderRadius: 5,
    background: 'oklch(0.26 0.01 265)', color: SEMANTIC.textMuted,
    border: `1px solid ${SEMANTIC.borderColor}`,
  } as React.CSSProperties,
  sourceTag: {
    padding: '2px 7px',
    fontSize: 10,
    borderRadius: 5,
    background: 'oklch(0.22 0.01 265)',
    color: SEMANTIC.textMuted,
    border: `1px solid ${SEMANTIC.borderColor}`,
    whiteSpace: 'nowrap',
  } as React.CSSProperties,
  spinner: {
    width: 24, height: 24, border: '3px solid oklch(0.30 0.014 265)',
    borderTopColor: 'oklch(0.74 0.13 60)', borderRadius: '50%',
    animation: 'spin 0.7s linear infinite',
  } as React.CSSProperties,
  status: { textAlign: 'center', fontSize: 13, color: SEMANTIC.textSecondary, marginTop: 12 } as React.CSSProperties,
  tabs: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 4,
    padding: 4,
    marginTop: 14,
    borderRadius: 8,
    background: 'oklch(0.15 0.008 265)',
    border: `1px solid ${SEMANTIC.borderColor}`,
  } as React.CSSProperties,
  tabBtn: {
    border: 'none',
    borderRadius: 6,
    padding: '7px 10px',
    background: 'transparent',
    color: SEMANTIC.textMuted,
    cursor: 'pointer',
    fontSize: 12,
    fontFamily: "'IBM Plex Mono', monospace",
  } as React.CSSProperties,
  tabBtnActive: {
    background: 'oklch(0.74 0.13 60 / 0.14)',
    color: SEMANTIC.textAccent2,
  } as React.CSSProperties,
  filterRow: {
    display: 'flex',
    justifyContent: 'flex-end',
    marginTop: 10,
  } as React.CSSProperties,
  filterToggle: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    fontSize: 11.5,
    color: SEMANTIC.textMuted,
    cursor: 'pointer',
    userSelect: 'none',
    fontFamily: "'IBM Plex Mono', monospace",
  } as React.CSSProperties,
  filterCheckbox: {
    width: 13,
    height: 13,
    accentColor: 'oklch(0.74 0.13 60)',
    cursor: 'pointer',
  } as React.CSSProperties,
};

function StructuredScannerTitle({ title }: { title: Extract<ScannerFileTitleDisplay, { kind: 'structured' }> }) {
  const toneSuffix = title.tone === 'command' ? 'Command' : title.tone === 'plugin' ? 'Plugin' : 'Warning';
  const iconStyle = S[`structuredIcon${toneSuffix}` as const];
  const nameStyle = S[`structuredName${toneSuffix}` as const];

  return (
    <div style={S.structuredTitle} title={title.tooltip}>
      <span style={{ ...S.structuredIcon, ...iconStyle }}>{title.icon}</span>
      <span style={S.structuredTextWrap}>
        <span style={{ ...S.structuredName, ...nameStyle }}>{title.label}</span>
        {title.detail && <span style={S.structuredDetail}>{title.detail}</span>}
      </span>
    </div>
  );
}

export default function ScannerModal() {
  const [scanning, setScanning] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const [activeSource, setActiveSource] = useState<'claude' | 'codex'>('claude');
  const [hideShortSessions, setHideShortSessions] = useState(false);

  const files = useSessionStore(s => s.scanFiles);
  const status = useSessionStore(s => s.scanStatus);
  const closeScanner = useSessionStore(s => s.closeScanner);
  const setScanFiles = useSessionStore(s => s.setScanFiles);
  const fetchSessions = useSessionStore(s => s.fetchSessions);
  const setPage = useUIStore(s => s.setPage);
  const selectSession = useSessionStore(s => s.selectSession);

  const claudeFiles = useMemo(
    () => files.filter((f) => f.source !== 'codex'),
    [files],
  );
  const codexFiles = useMemo(
    () => files.filter((f) => f.source === 'codex'),
    [files],
  );
  const sourceFiles = activeSource === 'codex' ? codexFiles : claudeFiles;
  const visibleFiles = useMemo(
    () => filterScannerFiles(files, { source: activeSource, hideShortSessions }),
    [files, activeSource, hideShortSessions],
  );

  const doScan = useCallback(async (force?: boolean) => {
    setScanning(true);
    setScanFiles(files, '正在扫描本地会话目录…');
    try {
      const url = force ? `${API_BASE}/scanner/scan?force=1` : `${API_BASE}/scanner/scan`;
      const resp = await fetch(url);
      const data = await resp.json();
      const cachedNote = data.cached > 0 ? `（${data.cached} 个命中缓存）` : '';
      const codexCount = Array.isArray(data.files) ? data.files.filter((f: FoundFile) => f.source === 'codex').length : 0;
      const sourceNote = codexCount > 0 ? `，包含 ${codexCount} 个 Codex 日志` : '';
      setScanFiles(data.files || [], `发现 ${data.totalFiles} 个有效文件，其中 ${data.importedCount} 个已导入${sourceNote}${cachedNote}`);
    } catch (e) {
      setScanFiles(files, '扫描失败: ' + (e as Error).message);
    } finally {
      setScanning(false);
    }
  }, [setScanFiles, files]);

  // Auto-load every time the modal opens
  useEffect(() => {
    doScan();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const doImport = useCallback(async (file: FoundFile) => {
    setImporting(file.path);
    try {
      const resp = await fetch(`${API_BASE}/scanner/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: file.path }),
      });
      const data = await resp.json();
      if (data.imported || data.sessionId) {
        closeScanner();
        await fetchSessions();
        setPage('inspector');
        await selectSession(data.sessionId);
      }
    } catch (e) {
      setScanFiles(files, '导入失败: ' + (e as Error).message);
    } finally {
      setImporting(null);
    }
  }, [fetchSessions, setPage, selectSession, files, status, setScanFiles]);

  return (
    <div style={S.overlay} onClick={(e) => { if (e.target === e.currentTarget) closeScanner(); }}>
      <div style={{ ...S.card, position: 'relative' } as React.CSSProperties}>
        <button style={S.closeBtn} onClick={closeScanner} title="关闭">✕</button>

        <h2 style={S.title}>扫描本地会话</h2>

        {files.length === 0 && !scanning && (
          <p style={{ fontSize: 13, color: SEMANTIC.textSecondary, marginTop: 8, textAlign: 'center' }}>
            扫描 Claude Code 与 Codex 的本地 JSONL 会话记录
          </p>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginTop: 16 }}>
          <button style={S.scanBtn} onClick={() => doScan(false)} disabled={scanning}>
            {scanning ? '扫描中…' : '🔍 扫描本地会话'}
          </button>
          {files.length > 0 && (
            <span
              style={{ fontSize: 11, color: SEMANTIC.textMuted, cursor: 'pointer', textDecoration: 'underline' }}
              onClick={() => doScan(true)}
            >
              强制重新扫描
            </span>
          )}
        </div>

        {status && <div style={S.status}>{status}</div>}

        {files.length > 0 && (
          <>
            <div style={S.tabs} role="tablist" aria-label="日志来源">
              {([
                ['claude', `Claude Code (${claudeFiles.length})`],
                ['codex', `Codex (${codexFiles.length})`],
              ] as const).map(([source, label]) => {
                const active = activeSource === source;
                return (
                  <button
                    key={source}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    style={{ ...S.tabBtn, ...(active ? S.tabBtnActive : {}) }}
                    onClick={() => setActiveSource(source)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div style={S.filterRow}>
              <label style={S.filterToggle}>
                <input
                  type="checkbox"
                  checked={hideShortSessions}
                  onChange={(event) => setHideShortSessions(event.currentTarget.checked)}
                  style={S.filterCheckbox}
                />
                隐藏少于 5 轮
              </label>
            </div>
          </>
        )}

        {scanning && (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
            <div style={S.spinner} />
          </div>
        )}

        {files.length > 0 && visibleFiles.length === 0 && !scanning && (
          <div style={{ ...S.status, marginTop: 18 }}>
            {sourceFiles.length === 0
              ? activeSource === 'codex' ? '未发现 Codex 日志' : '未发现 Claude Code 日志'
              : '当前筛选条件下没有会话'}
          </div>
        )}

        {visibleFiles.length > 0 && (
          <div className="tl" style={S.list}>
            {visibleFiles.map((f) => {
              const titleDisplay = getScannerFileTitleDisplay(f.title, f.name);

              return (
                <div key={f.path} style={S.fileItem}>
                  <span style={{ fontSize: 16, flexShrink: 0 }}>📄</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                      <span style={S.sourceTag}>{f.source === 'codex' ? 'Codex' : 'Claude'}</span>
                      {titleDisplay.kind === 'structured' ? (
                        <StructuredScannerTitle title={titleDisplay} />
                      ) : (
                        <div style={S.fileName} title={f.path}>{titleDisplay.text}</div>
                      )}
                    </div>
                    {f.title && <div style={{ fontSize: 10, color: SEMANTIC.textMuted, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.path}>{f.name}</div>}
                    {!f.imported && f.requests != null && (
                      <div style={{ display: 'flex', gap: 10, marginTop: 3 }}>
                        <span style={{ fontSize: 11, color: SEMANTIC.textMuted }}>{f.model || 'unknown'}</span>
                        <span style={{ fontSize: 11, color: SEMANTIC.textMuted }}>{f.requests} 请求</span>
                        <span style={{ fontSize: 11, color: 'oklch(0.74 0.13 60)' }}>峰值 {fmtK(f.peakTokens ?? 0)}</span>
                        <span style={{ fontSize: 11, color: SEMANTIC.textMuted }}>{f.turnCount} 轮</span>
                      </div>
                    )}
                  </div>
                  <span style={S.meta}>{fmtK(f.size)}B</span>
                  <span style={S.meta}>{fmtDateShort(f.modified)}</span>
                  {f.imported ? (
                    <span style={S.importedTag}>已导入</span>
                  ) : (
                    <button
                      style={S.importBtn}
                      disabled={importing === f.path}
                      onClick={() => doImport(f)}
                    >
                      {importing === f.path ? '导入中…' : '导入'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
